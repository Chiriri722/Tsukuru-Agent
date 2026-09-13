import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as asar from '@electron/asar';
import { extractContainer, inspectContainer, packContainer, verifyContainerOutput } from '../../core/container';
import {
    CONTAINER_PROVENANCE_FILE,
    ContainerProvenance,
    readContainerProvenance,
} from '../../core/containerProvenance';
import { AgentRequest, AgentResult } from '../../core/schema';
import { inspectElectronRuntime, runLaunchProbe } from '../../core/runtimeDiagnostics';
import { loadRpgTranslationDictionary, TranslationDictionaryOutcome } from '../../core/translationDictionary';
import { ErrorCodes, OperationError } from '../../core/types';
import { diffFileMaps, isProtectedPath, snapshotDirectory } from '../../core/validator';
import { WorkspaceTransaction } from '../../core/workspaceTransaction';
import { GDevelopService } from '../../js/gdevelop/GDevelopService';
import { RpgMakerService, assertRpgApplyOutputSafe } from '../../js/rpgmv/RpgMakerService';
import { TyranoService } from '../../js/tyrano/TyranoService';
import { WolfService } from '../../js/wolf/WolfService';
import { extractionWorkspacePath, gdevelopProjectRoot, tyranoProjectRoot } from '../enginePaths';
import { selectEngineAdapter } from '../engineRegistry';
import { DetectedProject } from '../formatDetect';
import { buildOperationContext } from '../operationContext';
import { applyPatches, PatchOutcome } from '../patcher';
import { isWithinPath, pathsOverlap } from '../workspacePathPolicy';
import { OperationRuntime, throwIfOperationAborted } from '../../core/operationRuntime';
import { makeStagingDir, removePathBestEffortSync } from '../../core/atomic';
import { resolveContainedPathWithoutLinks } from '../../core/pathSafety';
import { attachTranslationQuality } from './translationQuality';

function cleanupTemporaryPath(target: string, label: string, result?: AgentResult): void {
    const error = removePathBestEffortSync(target, { recursive: true, force: true });
    if (error && result) {
        const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
        result.warnings.push(`${label} 정리에 실패했습니다(${code}); 복구 가능한 임시 파일이 남을 수 있습니다`);
    }
}

function sha256File(filePath: string): string {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const handle = fs.openSync(filePath, 'r');
    try {
        let bytesRead = 0;
        do {
            bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
            if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
        return hash.digest('hex');
    } finally {
        fs.closeSync(handle);
    }
}

function normalizeRelative(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function equalPathLists(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    const sortedLeft = [...left].map(normalizeRelative).sort();
    const sortedRight = [...right].map(normalizeRelative).sort();
    return sortedLeft.every((entry, index) => entry === sortedRight[index]);
}

function assertNoSymbolicLinkInPath(root: string, relative: string): string {
    let current = path.resolve(root);
    if (fs.lstatSync(current).isSymbolicLink()) {
        throw new OperationError(
            ErrorCodes.CONTAINER_PROVENANCE_INVALID,
            'ASAR 작업본 루트는 심볼릭 링크/정션일 수 없습니다',
            { root },
        );
    }
    for (const segment of normalizeRelative(relative).split('/')) {
        current = path.join(current, segment);
        if (!fs.existsSync(current)) {
            throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'ASAR 작업본에서 원본 파일이 누락되었습니다', { relative });
        }
        if (fs.lstatSync(current).isSymbolicLink()) {
            throw new OperationError(
                ErrorCodes.CONTAINER_PROVENANCE_INVALID,
                'ASAR 작업본에 심볼릭 링크/정션을 사용할 수 없습니다',
                { relative },
            );
        }
    }
    return current;
}

function copyArchiveWorkingFiles(
    workingRoot: string,
    stagingRoot: string,
    provenance: ContainerProvenance,
): void {
    fs.mkdirSync(stagingRoot, { recursive: true });
    for (const relative of provenance.archiveFiles) {
        const source = assertNoSymbolicLinkInPath(workingRoot, relative);
        if (!fs.lstatSync(source).isFile()) {
            throw new OperationError(
                ErrorCodes.SOURCE_CHANGED,
                'ASAR 작업본의 원본 파일이 일반 파일이 아닙니다',
                { relative },
            );
        }
        const target = path.join(stagingRoot, ...relative.split('/'));
        if (!isWithinPath(stagingRoot, target)) {
            throw new OperationError(
                ErrorCodes.CONTAINER_PROVENANCE_INVALID,
                'ASAR staging 경로가 안전하지 않습니다',
                { relative },
            );
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        fs.chmodSync(target, fs.statSync(source).mode);
    }
}

function copyTreeWithoutLinks(source: string, target: string, excludedRoots: readonly string[] = []): void {
    const exclusions = excludedRoots.map((candidate) => path.resolve(candidate));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, {
        recursive: true,
        preserveTimestamps: true,
        filter: (candidate) => {
            const stat = fs.lstatSync(candidate);
            if (stat.isSymbolicLink()) {
                throw new OperationError(
                    ErrorCodes.VERIFY_FAILED,
                    '심볼릭 링크/정션이 있는 게임 복사본은 만들 수 없습니다',
                    { path: candidate },
                );
            }
            if (!stat.isDirectory() && !stat.isFile()) {
                throw new OperationError(
                    ErrorCodes.VERIFY_FAILED,
                    '일반 파일/디렉터리가 아닌 항목이 있는 게임 복사본은 만들 수 없습니다',
                    { path: candidate },
                );
            }
            if (exclusions.some((excluded) => isWithinPath(excluded, candidate))) return false;
            return true;
        },
    });
}

function copyApplyArtifacts(workingData: string, stagingData: string): void {
    for (const name of ['Extract', 'Backup', '.extracteddata']) {
        const source = path.join(workingData, name);
        if (!fs.existsSync(source)) {
            throw new OperationError(
                ErrorCodes.PATH_NOT_FOUND,
                `RPG 작업본에 apply 필수 산출물이 없습니다: ${name}`,
                { source },
            );
        }
        copyTreeWithoutLinks(source, path.join(stagingData, name));
    }
}

function applyRpgTranslationDirectory(
    extractDir: string,
    translationDirectory: string,
    result: AgentResult,
): { dictionary: TranslationDictionaryOutcome; patch: PatchOutcome } {
    const dictionary = loadRpgTranslationDictionary(extractDir, translationDirectory);
    result.warnings.push(...dictionary.warnings);
    if (dictionary.patches.length === 0) {
        throw new OperationError(ErrorCodes.PATCH_EMPTY, '적용 가능한 번역 사전 항목이 없습니다');
    }
    return {
        dictionary,
        patch: applyPatches(extractDir, 'rpgmv', dictionary.patches),
    };
}

function overlayDirectory(source: string, target: string): void {
    if (!fs.existsSync(source)) return;
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
        copyTreeWithoutLinks(path.join(source, entry), path.join(target, entry));
    }
}

function verifyProtectedWorkingFiles(
    workingRoot: string,
    sourceArchive: string,
    provenance: ContainerProvenance,
): void {
    const changed: string[] = [];
    for (const relative of provenance.archiveFiles.filter(isProtectedPath)) {
        const workingFile = assertNoSymbolicLinkInPath(workingRoot, relative);
        const archiveEntry = relative.split('/').join(path.sep);
        const original = asar.extractFile(sourceArchive, archiveEntry, false);
        if (!original.equals(fs.readFileSync(workingFile))) changed.push(relative);
    }
    if (changed.length > 0) {
        throw new OperationError(
            ErrorCodes.VERIFY_FAILED,
            'ASAR 작업본의 보호 스크립트가 원본과 다릅니다',
            { changed },
        );
    }
}

function containerApplyOutputPath(request: AgentRequest, sourceRoot: string, workingRoot: string): string {
    const source = path.resolve(sourceRoot);
    const working = path.resolve(workingRoot);
    const output = path.resolve(
        request.outputPath ?? path.join(path.dirname(source), path.basename(source) + '_Completed'),
    );
    if (pathsOverlap(source, output) || pathsOverlap(working, output)) {
        throw new OperationError(
            ErrorCodes.OUTPUT_CONFLICT,
            '컨테이너 출력은 원본과 작업본 양쪽 경로 바깥이어야 합니다',
            { outputPath: output },
        );
    }
    if (fs.existsSync(output) && request.options.force !== true) {
        throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 이미 존재합니다', { outputPath: output });
    }
    return output;
}

async function verifyProtectedNwWorkingFiles(
    workingRoot: string,
    sourceInfo: ReturnType<typeof inspectContainer>,
    provenance: ContainerProvenance,
): Promise<void> {
    const originalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-agent-nw-protected-'));
    try {
        await extractContainer(sourceInfo, originalRoot);
        const changed: string[] = [];
        for (const relative of provenance.archiveFiles.filter(isProtectedPath)) {
            const workingFile = assertNoSymbolicLinkInPath(workingRoot, relative);
            const originalFile = assertNoSymbolicLinkInPath(originalRoot, relative);
            if (!fs.readFileSync(originalFile).equals(fs.readFileSync(workingFile))) changed.push(relative);
        }
        if (changed.length > 0) {
            throw new OperationError(
                ErrorCodes.VERIFY_FAILED,
                'NW.js 작업본의 보호 스크립트가 원본과 다릅니다',
                { changed },
            );
        }
    } finally {
        cleanupTemporaryPath(originalRoot, 'NW.js 보호 파일 검증 임시 경로');
    }
}

async function applyNwWorking(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    provenance: ContainerProvenance,
    operationRuntime: OperationRuntime,
): Promise<void> {
    if (detected.format !== 'gdevelop' || provenance.engine.type !== 'gdevelop') {
        throw new OperationError(
            ErrorCodes.FORMAT_MISMATCH,
            'NW.js 작업본은 현재 GDevelop 엔진만 적용할 수 있습니다',
            { format: detected.format },
        );
    }
    const sourcePath = request.options.containerSourcePath;
    if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
        throw new OperationError(
            ErrorCodes.REQUEST_INVALID,
            'NW.js apply에는 options.containerSourcePath 원본 경로가 필요합니다',
        );
    }
    const sourceInfo = inspectContainer(sourcePath);
    if (sourceInfo.type !== 'nwjs-package' || !sourceInfo.archive || !sourceInfo.archivePath || !sourceInfo.packagePath) {
        throw new OperationError(
            ErrorCodes.FORMAT_MISMATCH,
            'containerSourcePath에서 package.nw를 찾지 못했습니다',
            { sourcePath },
        );
    }
    if (sourceInfo.engine.features.includes('nwjs-directory-form')
        && request.options.experimentalNwDirectory !== true) {
        throw new OperationError(
            ErrorCodes.EXPERIMENTAL_FEATURE_DISABLED,
            'directory-form package.nw 적용은 options.experimentalNwDirectory=true가 필요합니다',
        );
    }
    if (sourceInfo.engine.features.includes('nwjs-appended-zip')
        && request.options.experimentalNwAppendedZip !== true) {
        throw new OperationError(
            ErrorCodes.EXPERIMENTAL_FEATURE_DISABLED,
            'appended ZIP NW.js 적용은 options.experimentalNwAppendedZip=true가 필요합니다',
        );
    }
    if (sourceInfo.engine.features.includes('nwjs-appended-zip')
        && sourceInfo.archive?.appendedZip?.safeToRepack !== true) {
        throw new OperationError(
            ErrorCodes.EXPERIMENTAL_FEATURE_UNSAFE,
            sourceInfo.archive?.appendedZip?.reason ?? 'appended ZIP NW.js 실행 파일은 안전하게 변경할 수 없습니다',
        );
    }
    const sourceArchiveRelative = normalizeRelative(path.relative(sourceInfo.rootPath, sourceInfo.packagePath));
    if (sourceArchiveRelative !== provenance.archiveRelativePath
        || sourceInfo.archive.sha256 !== provenance.archiveSha256) {
        throw new OperationError(
            ErrorCodes.SOURCE_CHANGED,
            '지정한 원본 package.nw가 작업본 provenance와 일치하지 않습니다',
            {
                expectedPath: provenance.archiveRelativePath,
                actualPath: sourceArchiveRelative,
                expectedSha256: provenance.archiveSha256,
                actualSha256: sourceInfo.archive.sha256,
            },
        );
    }
    if (sourceInfo.engine.type !== provenance.engine.type || sourceInfo.engine.root !== provenance.engine.root
        || !equalPathLists(sourceInfo.archive.fileEntries, provenance.archiveFiles)) {
        throw new OperationError(
            ErrorCodes.SOURCE_CHANGED,
            '원본 package.nw 엔진 또는 파일 목록이 provenance와 일치하지 않습니다',
        );
    }

    const workingRoot = path.resolve(request.projectPath);
    const output = containerApplyOutputPath(request, sourceInfo.rootPath, workingRoot);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-agent-nw-pack-'));
    const archiveWorking = path.join(tempRoot, 'archive-working');
    const engineOutput = path.join(tempRoot, 'engine-output');
    const repackRoot = path.join(tempRoot, 'repack');
    const transaction = new WorkspaceTransaction({
        outputPath: output,
        force: request.options.force === true,
        signal: operationRuntime.signal,
    });
    const outputStaging = transaction.stagingPath;
    try {
        copyArchiveWorkingFiles(workingRoot, archiveWorking, provenance);
        await verifyProtectedNwWorkingFiles(workingRoot, sourceInfo, provenance);
        const engineSegments = provenance.engine.root.split('/').filter(Boolean);
        const workingEngineRoot = path.join(workingRoot, ...engineSegments);
        const archiveEngineRoot = path.join(archiveWorking, ...engineSegments);
        const extractArtifacts = path.join(workingEngineRoot, '_Extract');
        if (!fs.existsSync(extractArtifacts)) {
            throw new OperationError(
                ErrorCodes.PATH_NOT_FOUND,
                'NW.js GDevelop 작업본에 _Extract가 없습니다',
                { extractArtifacts },
            );
        }
        copyTreeWithoutLinks(extractArtifacts, path.join(archiveEngineRoot, '_Extract'));
        const before = snapshotDirectory(archiveWorking);
        const applied = new GDevelopService().applyToCopy({
            projectRoot: archiveEngineRoot,
            outputRoot: engineOutput,
            experimentalGdevelopCodeStrings: request.options.experimentalGdevelopCodeStrings === true,
        });
        let packageRoot = engineOutput;
        if (engineSegments.length > 0) {
            copyTreeWithoutLinks(archiveWorking, repackRoot);
            const repackEngineRoot = path.join(repackRoot, ...engineSegments);
            fs.rmSync(repackEngineRoot, { recursive: true, force: true });
            copyTreeWithoutLinks(engineOutput, repackEngineRoot);
            packageRoot = repackRoot;
        }
        const approvedProtectedPaths = new Set(applied.approvedCodeFiles.map((file) => normalizeRelative(
            path.posix.join(provenance.engine.root, file),
        )));
        const change = diffFileMaps(before, snapshotDirectory(packageRoot), approvedProtectedPaths);
        if (change.protectedScriptDamage > 0) {
            throw new OperationError(
                ErrorCodes.VERIFY_FAILED,
                'NW.js apply 과정에서 보호 스크립트가 변경되었습니다',
                { change },
            );
        }

        copyTreeWithoutLinks(sourceInfo.rootPath, outputStaging);
        const outputArchive = path.join(outputStaging, ...provenance.archiveRelativePath.split('/'));
        fs.rmSync(outputArchive, { recursive: true, force: true });
        await packContainer(sourceInfo, packageRoot, outputArchive);
        const verified = verifyContainerOutput(outputArchive, provenance.requiredEntries);
        if (!verified.archive || verified.archive.invalidEntryCount > 0 || verified.archive.unsafeLinkCount > 0
            || verified.engine.type !== provenance.engine.type || verified.engine.root !== provenance.engine.root
            || !equalPathLists(verified.archive.fileEntries, provenance.archiveFiles)) {
            throw new OperationError(ErrorCodes.VERIFY_FAILED, '재포장한 package.nw 구조 검증에 실패했습니다', { verified });
        }
        const freshSource = inspectContainer(sourceInfo.archivePath);
        if (!freshSource.archive || freshSource.archive.sha256 !== provenance.archiveSha256) {
            throw new OperationError(
                ErrorCodes.SOURCE_CHANGED,
                '작업 도중 원본 package.nw가 변경되었습니다',
                { source: sourceInfo.archivePath },
            );
        }
        throwIfOperationAborted(operationRuntime, 'apply-nw-commit');
        transaction.commit();
        const finalArchive = path.join(output, ...provenance.archiveRelativePath.split('/'));
        result.container = {
            type: 'nwjs-package',
            path: provenance.archiveRelativePath,
            root: verified.engine.root,
            confidence: verified.engine.confidence,
            integrity: verified.archive.integrity,
            invalidEntryCount: verified.archive.invalidEntryCount,
        };
        result.engine = {
            type: verified.engine.type,
            wrapper: verified.engine.wrapper,
            features: verified.engine.features,
            confidence: verified.engine.confidence,
        };
        result.change = {
            filesChanged: change.filesChanged,
            bytesChanged: change.bytesChanged,
            textBytesChanged: change.textBytesChanged,
            protectedFilesChanged: change.protectedFilesChanged,
            protectedScriptDamage: change.protectedScriptDamage,
        };
        result.validation = applied.validation;
        result.artifacts = [output, finalArchive];
        result.stats = { files: applied.appliedFiles, entries: applied.appliedEntries };
        result.ok = true;
    } finally {
        cleanupTemporaryPath(tempRoot, 'NW.js 적용 임시 경로', result);
        transaction.dispose();
    }
}

interface AsarEngineApplyResult {
    appliedFiles: number;
    elapsedMs?: number;
    validation: AgentResult['validation'];
    approvedProtectedPaths: Set<string>;
    dictionaryOutcome?: ReturnType<typeof applyRpgTranslationDirectory>;
}

async function applyAsarEngine(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    provenance: ContainerProvenance,
    operationRuntime: OperationRuntime,
    engineRoot: string,
    workingEngineRoot: string,
    engineOutput: string,
): Promise<AsarEngineApplyResult> {
    if (detected.format === 'gdevelop') {
        const extractArtifacts = path.join(workingEngineRoot, '_Extract');
        if (!fs.existsSync(extractArtifacts)) {
            throw new OperationError(
                ErrorCodes.PATH_NOT_FOUND,
                'ASAR GDevelop 작업본에서 _Extract를 찾지 못했습니다',
                { extractArtifacts },
            );
        }
        copyTreeWithoutLinks(extractArtifacts, path.join(engineRoot, '_Extract'));
        const applied = new GDevelopService().applyToCopy({
            projectRoot: engineRoot,
            outputRoot: engineOutput,
            experimentalGdevelopCodeStrings: request.options.experimentalGdevelopCodeStrings === true,
        });
        overlayDirectory(engineOutput, engineRoot);
        fs.rmSync(path.join(engineRoot, '_Extract'), { recursive: true, force: true });
        return {
            appliedFiles: applied.appliedFiles,
            validation: applied.validation,
            approvedProtectedPaths: new Set(applied.approvedCodeFiles.map((file) => normalizeRelative(
                path.posix.join(provenance.engine.root, file),
            ))),
        };
    }

    const dataDir = path.join(engineRoot, 'data');
    copyApplyArtifacts(path.join(workingEngineRoot, 'data'), dataDir);
    const translationDirectory = typeof request.options.translationDirectory === 'string'
        ? request.options.translationDirectory
        : undefined;
    const dictionaryOutcome = translationDirectory
        ? applyRpgTranslationDirectory(path.join(dataDir, 'Extract'), translationDirectory, result)
        : undefined;
    const report = await new RpgMakerService(buildOperationContext(operationRuntime)).apply({
        dir: dataDir,
        instantapply: false,
        autoline: request.options.autoline === true,
        isComment: request.options.isComment === true,
        useYaml: request.options.useYaml === true,
    });
    const completed = path.join(dataDir, 'Completed');
    attachTranslationQuality(result, report.translationQuality);
    overlayDirectory(path.join(completed, 'data'), dataDir);
    overlayDirectory(path.join(completed, 'js'), path.join(engineRoot, 'js'));
    for (const artifact of ['Extract', 'Backup', 'Completed', '.extracteddata']) {
        fs.rmSync(path.join(dataDir, artifact), { recursive: true, force: true });
    }
    return {
        appliedFiles: report.appliedFiles.length,
        elapsedMs: report.elapsedMs,
        validation: report.validation,
        approvedProtectedPaths: new Set<string>(),
        dictionaryOutcome,
    };
}

type ElectronRuntimeReport = Awaited<ReturnType<typeof inspectElectronRuntime>>;

async function runElectronApplyLaunchProbe(
    request: AgentRequest,
    runtime: ElectronRuntimeReport,
    outputStaging: string,
    result: AgentResult,
): Promise<void> {
    if (request.options.launchProbe !== true) return;
    if (!runtime.executable) {
        throw new OperationError(
            ErrorCodes.LAUNCH_PROBE_FAILED,
            '실행 프로브에 사용할 Electron 실행 파일을 찾지 못했습니다',
            runtime,
        );
    }
    const executableRelative = path.relative(outputStaging, runtime.executable);
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-agent-launch-'));
    const probePayload = path.join(probeRoot, 'payload');
    try {
        copyTreeWithoutLinks(outputStaging, probePayload);
        runtime.launchProbe = await runLaunchProbe(
            path.join(probePayload, executableRelative),
            [],
            { timeoutMs: request.options.launchTimeoutMs as number | undefined },
        );
        if (runtime.launchProbe.status === 'failed' || runtime.launchProbe.status === 'exited-error') {
            throw new OperationError(
                ErrorCodes.LAUNCH_PROBE_FAILED,
                '재포장 게임의 실행 프로브가 실패했습니다',
                runtime.launchProbe,
            );
        }
    } finally {
        cleanupTemporaryPath(probeRoot, 'Electron 실행 프로브 임시 경로', result);
    }
}

async function applyAsarWorking(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    provenance: ContainerProvenance,
    operationRuntime: OperationRuntime,
): Promise<void> {
    if (detected.format !== 'rpgmv' && detected.format !== 'rpgmz' && detected.format !== 'gdevelop') {
        throw new OperationError(
            ErrorCodes.FORMAT_MISMATCH,
            'ASAR 작업본의 지원 엔진을 판별할 수 없습니다',
            { format: detected.format },
        );
    }
    const sourcePath = request.options.containerSourcePath;
    if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
        throw new OperationError(
            ErrorCodes.REQUEST_INVALID,
            'ASAR apply에는 options.containerSourcePath 원본 경로가 필요합니다',
        );
    }
    const sourceInfo = inspectContainer(sourcePath);
    if (sourceInfo.type !== 'electron-asar' || !sourceInfo.archive || !sourceInfo.archivePath) {
        throw new OperationError(
            ErrorCodes.FORMAT_MISMATCH,
            'containerSourcePath에서 Electron app.asar를 찾지 못했습니다',
            { sourcePath },
        );
    }
    if (sourceInfo.archive.invalidEntryCount > 0
        && request.options.experimentalMalformedAsarRepack !== true) {
        throw new OperationError(
            ErrorCodes.EXPERIMENTAL_FEATURE_DISABLED,
            '비정상 ASAR metadata를 제외한 재패키징은 options.experimentalMalformedAsarRepack=true가 필요합니다',
            { invalidEntryCount: sourceInfo.archive.invalidEntryCount },
        );
    }
    const sourceArchiveRelative = normalizeRelative(path.relative(sourceInfo.rootPath, sourceInfo.archivePath));
    if (sourceArchiveRelative !== provenance.archiveRelativePath
        || sourceInfo.archive.sha256 !== provenance.archiveSha256) {
        throw new OperationError(
            ErrorCodes.SOURCE_CHANGED,
            '지정한 원본 ASAR가 작업본 provenance와 일치하지 않습니다',
            {
                expectedPath: provenance.archiveRelativePath,
                actualPath: sourceArchiveRelative,
                expectedSha256: provenance.archiveSha256,
                actualSha256: sourceInfo.archive.sha256,
            },
        );
    }
    if (sourceInfo.engine.type !== provenance.engine.type || sourceInfo.engine.root !== provenance.engine.root) {
        throw new OperationError(
            ErrorCodes.SOURCE_CHANGED,
            '원본 ASAR 엔진 프로파일이 작업본 provenance와 일치하지 않습니다',
            { expected: provenance.engine, actual: sourceInfo.engine },
        );
    }
    if (!equalPathLists(sourceInfo.archive.fileEntries, provenance.archiveFiles)
        || !equalPathLists(sourceInfo.archive.unpackedEntries, provenance.unpackedFiles)) {
        throw new OperationError(ErrorCodes.SOURCE_CHANGED, '원본 ASAR 파일 목록이 작업본 provenance와 일치하지 않습니다');
    }

    const workingRoot = path.resolve(request.projectPath);
    const output = containerApplyOutputPath(request, sourceInfo.rootPath, workingRoot);
    const packStaging = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-agent-pack-'));
    const engineTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-agent-asar-engine-'));
    const engineOutput = path.join(engineTemp, 'output');
    const transaction = new WorkspaceTransaction({
        outputPath: output,
        force: request.options.force === true,
        signal: operationRuntime.signal,
    });
    const outputStaging = transaction.stagingPath;
    try {
        copyArchiveWorkingFiles(workingRoot, packStaging, provenance);
        verifyProtectedWorkingFiles(workingRoot, sourceInfo.archivePath, provenance);
        const before = snapshotDirectory(packStaging);
        const engineRoot = path.join(packStaging, ...provenance.engine.root.split('/').filter(Boolean));
        const workingEngineRoot = path.join(workingRoot, ...provenance.engine.root.split('/').filter(Boolean));
        const {
            appliedFiles,
            elapsedMs,
            validation,
            approvedProtectedPaths,
            dictionaryOutcome,
        } = await applyAsarEngine(
            request,
            detected,
            result,
            provenance,
            operationRuntime,
            engineRoot,
            workingEngineRoot,
            engineOutput,
        );
        fs.rmSync(path.join(packStaging, CONTAINER_PROVENANCE_FILE), { force: true });

        const change = diffFileMaps(before, snapshotDirectory(packStaging), approvedProtectedPaths);
        if (change.protectedScriptDamage > 0) {
            throw new OperationError(
                ErrorCodes.VERIFY_FAILED,
                'apply 과정에서 보호 스크립트가 변경되었습니다',
                { change },
            );
        }

        const sourceUnpacked = sourceInfo.unpackedPath && fs.existsSync(sourceInfo.unpackedPath)
            ? sourceInfo.unpackedPath
            : undefined;
        copyTreeWithoutLinks(
            sourceInfo.rootPath,
            outputStaging,
            [sourceInfo.archivePath, ...(sourceUnpacked ? [sourceUnpacked] : [])],
        );
        const outputArchive = path.join(outputStaging, ...provenance.archiveRelativePath.split('/'));
        await packContainer(sourceInfo, packStaging, outputArchive);
        if (sourceUnpacked) {
            const generatedEntries = sourceInfo.archive.unpackedEntries.map((entry) => (
                path.join(sourceUnpacked, ...entry.split('/'))
            ));
            copyTreeWithoutLinks(sourceUnpacked, outputArchive + '.unpacked', generatedEntries);
        }
        const verified = verifyContainerOutput(outputArchive, provenance.requiredEntries);
        if (!verified.archive || verified.archive.invalidEntryCount > 0 || verified.archive.unsafeLinkCount > 0
            || verified.engine.type !== provenance.engine.type || verified.engine.root !== provenance.engine.root
            || !equalPathLists(verified.archive.fileEntries, provenance.archiveFiles)
            || !equalPathLists(verified.archive.unpackedEntries, provenance.unpackedFiles)) {
            throw new OperationError(ErrorCodes.VERIFY_FAILED, '재포장한 ASAR의 구조 검증에 실패했습니다', { verified });
        }
        const runtime = await inspectElectronRuntime(outputStaging, outputArchive, provenance.archiveRelativePath);
        if (runtime.blocked) {
            throw new OperationError(
                ErrorCodes.RUNTIME_INTEGRITY,
                runtime.blockReason ?? 'Electron 런타임 무결성 검증에 실패했습니다',
                runtime,
            );
        }
        await runElectronApplyLaunchProbe(request, runtime, outputStaging, result);
        if (sha256File(sourceInfo.archivePath) !== provenance.archiveSha256) {
            throw new OperationError(
                ErrorCodes.SOURCE_CHANGED,
                '작업 도중 원본 ASAR가 변경되었습니다',
                { source: sourceInfo.archivePath },
            );
        }

        throwIfOperationAborted(operationRuntime, 'apply-asar-commit');
        transaction.commit();
        const finalArchive = path.join(output, ...provenance.archiveRelativePath.split('/'));
        const remapRuntimePath = (value: string): string => path.join(output, path.relative(outputStaging, value));
        runtime.executable = runtime.executable ? remapRuntimePath(runtime.executable) : null;
        runtime.executableCandidates = runtime.executableCandidates.map(remapRuntimePath);
        if (runtime.launchProbe) runtime.launchProbe.executable = runtime.executable ?? runtime.launchProbe.executable;
        result.runtime = runtime;
        result.container = {
            type: 'electron-asar',
            path: provenance.archiveRelativePath,
            root: verified.engine.root,
            confidence: verified.engine.confidence,
            integrity: verified.archive.integrity,
            invalidEntryCount: verified.archive.invalidEntryCount,
        };
        result.engine = {
            type: verified.engine.type,
            wrapper: verified.engine.wrapper,
            features: verified.engine.features,
            confidence: verified.engine.confidence,
        };
        result.change = {
            filesChanged: change.filesChanged,
            bytesChanged: change.bytesChanged,
            textBytesChanged: change.textBytesChanged,
            protectedFilesChanged: change.protectedFilesChanged,
            protectedScriptDamage: change.protectedScriptDamage,
        };
        if (validation) result.validation = validation;
        result.artifacts = [output, finalArchive];
        result.stats = {
            files: appliedFiles,
            entries: verified.archive.fileCount,
            ...(elapsedMs === undefined ? {} : { elapsedMs: Math.round(elapsedMs) }),
            ...(dictionaryOutcome
                ? {
                    patched: dictionaryOutcome.patch.patched,
                    dictionary: dictionaryOutcome.dictionary.stats,
                }
                : {}),
        };
        result.warnings.push(...runtime.warnings);
        if (request.options.launchProbe !== true) {
            result.warnings.push(
                'Electron fuse·내장 ASAR 해시·코드 서명은 정적으로 검사했지만 실행 프로브는 요청되지 않았습니다',
            );
        }
        if (provenance.invalidEntryCount > 0) {
            result.warnings.push(
                `원본 ASAR의 잘못된 메타데이터 항목 ${provenance.invalidEntryCount}개는 정리된 재포장본에서 제외했습니다`,
            );
        }
        result.ok = true;
    } finally {
        cleanupTemporaryPath(packStaging, 'ASAR 재포장 임시 경로', result);
        cleanupTemporaryPath(engineTemp, 'ASAR 엔진 적용 임시 경로', result);
        transaction.dispose();
    }
}

type LooseApplyFamily = 'rpgmaker' | 'wolf' | 'tyrano' | 'gdevelop';
type LooseApplyHandler = (
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    runtime: OperationRuntime,
) => Promise<void>;

function rejectUnsupportedDictionary(request: AgentRequest): void {
    if (typeof request.options.translationDirectory === 'string') {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            'translationDirectory 자동 조립은 RPG MV/MZ만 지원합니다',
        );
    }
}

async function applyLooseRpg(request: AgentRequest, detected: DetectedProject, result: AgentResult, runtime: OperationRuntime): Promise<void> {
    const translationDirectory = typeof request.options.translationDirectory === 'string'
        ? request.options.translationDirectory
        : undefined;
    if (translationDirectory) {
        await applyLooseRpgDictionary(request, detected, result, runtime, translationDirectory);
        return;
    }
    const completed = request.outputPath ?? path.join(detected.dataDir, 'Completed');
    const report = await new RpgMakerService(buildOperationContext(runtime)).apply({
        dir: detected.dataDir,
        instantapply: false,
        outputDir: completed,
        force: request.options.force === true,
        autoline: request.options.autoline === true,
        isComment: request.options.isComment === true,
        useYaml: request.options.useYaml === true,
    });
    attachTranslationQuality(result, report.translationQuality);
    result.artifacts = [completed];
    result.validation = report.validation;
    result.stats = {
        files: report.appliedFiles.length,
        elapsedMs: Math.round(report.elapsedMs),
    };
}

function rpgDictionarySourceState(dataDir: string): string {
    const hash = crypto.createHash('sha256');
    const visit = (file: string, label: string): void => {
        if (!fs.existsSync(file)) { hash.update(JSON.stringify([label, 'absent'])); return; }
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
            throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'RPG 사전 입력이 일반 파일/디렉터리가 아닙니다');
        }
        hash.update(JSON.stringify([label, stat.isDirectory() ? 'directory' : sha256File(file)]));
        if (stat.isDirectory()) for (const child of fs.readdirSync(file).sort()) visit(path.join(file, child), `${label}/${child}`);
    };
    for (const name of ['Extract', 'Backup', '.extracteddata', 'System.json', 'ExternMessage.csv', 'Extract_img', 'Extract_audio']) {
        const resolved = resolveContainedPathWithoutLinks(dataDir, name);
        if (!resolved.ok) throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'RPG 사전 입력 경로가 안전하지 않습니다');
        visit(resolved.path, name);
    }
    const plugin = resolveContainedPathWithoutLinks(path.dirname(dataDir), 'js/plugins.js');
    if (!plugin.ok) throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'RPG plugins 원본 경로가 안전하지 않습니다');
    visit(plugin.path, 'js/plugins.js');
    return hash.digest('hex');
}

async function applyLooseRpgDictionary(
    request: AgentRequest, detected: DetectedProject, result: AgentResult,
    runtime: OperationRuntime, translationDirectory: string,
): Promise<void> {
    const dataDir = path.resolve(detected.dataDir);
    const completed = path.resolve(request.outputPath ?? path.join(dataDir, 'Completed'));
    assertRpgApplyOutputSafe(dataDir, completed);
    const transaction = new WorkspaceTransaction({ outputPath: completed, force: request.options.force === true, signal: runtime.signal });
    let workingRoot: string | undefined;
    try {
        const sourceState = rpgDictionarySourceState(dataDir);
        workingRoot = makeStagingDir(dataDir, '.tsukuru-dictionary');
        // Keep the parent name: asset encryption distinguishes MV's www from MZ.
        const gameRoot = path.join(workingRoot, path.basename(path.dirname(dataDir)));
        const stagedData = path.join(gameRoot, path.basename(dataDir));
        fs.mkdirSync(stagedData, { recursive: true });
        copyApplyArtifacts(dataDir, stagedData);
        for (const name of ['System.json', 'ExternMessage.csv', 'Extract_img', 'Extract_audio']) {
            const source = path.join(dataDir, name);
            if (fs.existsSync(source)) copyTreeWithoutLinks(source, path.join(stagedData, name));
        }
        const plugin = resolveContainedPathWithoutLinks(path.dirname(dataDir), path.join('js', 'plugins.js'));
        if (!plugin.ok) throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'RPG plugins.js 원본 경로가 안전하지 않습니다');
        if (fs.existsSync(plugin.path)) copyTreeWithoutLinks(plugin.path, path.join(gameRoot, 'js', 'plugins.js'));
        const outcome = applyRpgTranslationDirectory(path.join(stagedData, 'Extract'), translationDirectory, result);
        const report = await new RpgMakerService(buildOperationContext(runtime)).apply({
            dir: stagedData, outputDir: transaction.stagingPath, force: true,
            autoline: request.options.autoline === true,
            isComment: request.options.isComment === true,
            useYaml: request.options.useYaml === true,
        });
        throwIfOperationAborted(runtime, 'rpg-dictionary-commit');
        if (sourceState !== rpgDictionarySourceState(dataDir)) {
            throw new OperationError(ErrorCodes.SOURCE_CHANGED, '사전 적용 중 원본 또는 작업본이 변경되었습니다');
        }
        transaction.commit(['Extract', '.extracteddata'].map(name => ({
            staged: path.join(stagedData, name), target: path.join(dataDir, name),
        })));
        attachTranslationQuality(result, report.translationQuality);
        result.artifacts = [completed];
        result.validation = report.validation;
        result.stats = { files: report.appliedFiles.length, elapsedMs: Math.round(report.elapsedMs),
            patched: outcome.patch.patched, dictionary: outcome.dictionary.stats };
    } finally {
        transaction.dispose();
        if (workingRoot) cleanupTemporaryPath(workingRoot, 'RPG 사전 작업 경로', result);
    }
}

async function applyLooseWolf(request: AgentRequest, detected: DetectedProject, result: AgentResult, runtime: OperationRuntime): Promise<void> {
    rejectUnsupportedDictionary(request);
    const targetDir = request.outputPath ?? path.join(path.dirname(detected.dataDir), 'Completed');
    const transaction = new WorkspaceTransaction({ outputPath: targetDir, force: request.options.force === true, signal: runtime.signal });
    let report;
    try {
        copyTreeWithoutLinks(
            detected.dataDir,
            transaction.stagingPath,
            [path.join(detected.dataDir, '_Extract')],
        );
        report = await new WolfService(buildOperationContext(runtime)).applyToCopy({
            dataDir: detected.dataDir,
            targetDir: transaction.stagingPath,
        });
        transaction.commit();
    } finally {
        transaction.dispose();
    }
    result.artifacts = [targetDir];
    result.stats = { entries: report.appliedEntries };
}

async function applyLooseTyrano(request: AgentRequest, detected: DetectedProject, result: AgentResult, runtime: OperationRuntime): Promise<void> {
    rejectUnsupportedDictionary(request);
    const projectRoot = tyranoProjectRoot(detected);
    const targetDir = request.outputPath ?? path.join(path.dirname(projectRoot), 'Completed');
    const transaction = new WorkspaceTransaction({ outputPath: targetDir, force: request.options.force === true, signal: runtime.signal });
    let report;
    try {
        fs.rmSync(transaction.stagingPath, { recursive: true, force: true });
        report = new TyranoService().applyToCopy({ projectRoot, outputRoot: transaction.stagingPath, force: false });
        transaction.commit();
    } finally {
        transaction.dispose();
    }
    result.artifacts = [targetDir];
    result.stats = { files: report.appliedFiles, entries: report.appliedEntries };
    result.validation = report.validation;
}

async function applyLooseGdevelop(request: AgentRequest, detected: DetectedProject, result: AgentResult, runtime: OperationRuntime): Promise<void> {
    rejectUnsupportedDictionary(request);
    const projectRoot = gdevelopProjectRoot(detected);
    const targetDir = request.outputPath ?? path.join(path.dirname(projectRoot), 'Completed');
    const transaction = new WorkspaceTransaction({ outputPath: targetDir, force: request.options.force === true, signal: runtime.signal });
    let report;
    try {
        fs.rmSync(transaction.stagingPath, { recursive: true, force: true });
        report = new GDevelopService().applyToCopy({
            projectRoot,
            outputRoot: transaction.stagingPath,
            force: false,
            experimentalGdevelopCodeStrings: request.options.experimentalGdevelopCodeStrings === true,
        });
        transaction.commit();
    } finally {
        transaction.dispose();
    }
    result.artifacts = [targetDir];
    result.stats = {
        files: report.appliedFiles,
        entries: report.appliedEntries,
        approvedCodeFiles: report.approvedCodeFiles.length,
    };
    result.validation = report.validation;
}

export const looseApplyHandlerRegistry: Readonly<Record<LooseApplyFamily, LooseApplyHandler>> = Object.freeze({
    rpgmaker: applyLooseRpg,
    wolf: applyLooseWolf,
    tyrano: applyLooseTyrano,
    gdevelop: applyLooseGdevelop,
});

export async function handleApply(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    runtime: OperationRuntime,
): Promise<void> {
    const engine = selectEngineAdapter(detected);
    if (!engine.operations.includes('apply')) {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            `현재 엔진 프로파일은 진단만 지원합니다: ${detected.format}`,
            { format: detected.format },
        );
    }
    const translationDirectory = typeof request.options.translationDirectory === 'string'
        ? request.options.translationDirectory
        : undefined;
    const provenance = readContainerProvenance(request.projectPath);
    if (provenance) {
        if (translationDirectory && provenance.engine.type !== 'rpgmv' && provenance.engine.type !== 'rpgmz') {
            rejectUnsupportedDictionary(request);
        }
        if (provenance.containerType === 'nwjs-package') {
            await applyNwWorking(request, detected, result, provenance, runtime);
        } else {
            await applyAsarWorking(request, detected, result, provenance, runtime);
        }
        return;
    }
    if (detected.container?.type === 'electron-asar') {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            '원본 ASAR 직접 적용은 아직 지원하지 않습니다. 먼저 별도 작업 디렉터리로 추출하세요',
            { format: detected.format },
        );
    }
    if (request.options.launchProbe === true) {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            'launchProbe는 Electron ASAR/NW.js 컨테이너 작업본 apply에서만 지원합니다',
            { format: detected.format, container: detected.container?.type ?? 'directory' },
        );
    }
    const looseHandler = looseApplyHandlerRegistry[engine.family as LooseApplyFamily];
    if (!looseHandler) {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            `현재 엔진 프로파일은 진단만 지원합니다: ${detected.format}`,
            { format: detected.format },
        );
    }
    await looseHandler(request, detected, result, runtime);
    result.ok = true;
}
