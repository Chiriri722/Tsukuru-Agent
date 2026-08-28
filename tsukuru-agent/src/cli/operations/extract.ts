import fs from 'fs';
import path from 'path';
import { copyExternalResources, extractContainer } from '../../core/container';
import {
    CONTAINER_PROVENANCE_FILE,
    createContainerProvenance,
    writeContainerProvenance,
} from '../../core/containerProvenance';
import { AgentRequest, AgentResult } from '../../core/schema';
import { ErrorCodes, OperationError } from '../../core/types';
import { WorkspaceTransaction } from '../../core/workspaceTransaction';
import { GDevelopService } from '../../js/gdevelop/GDevelopService';
import { RpgExtractOptions, RpgMakerService } from '../../js/rpgmv/RpgMakerService';
import { TyranoService } from '../../js/tyrano/TyranoService';
import { WolfService } from '../../js/wolf/WolfService';
import { gdevelopProjectRoot, tyranoProjectRoot } from '../enginePaths';
import { selectEngineAdapter } from '../engineRegistry';
import { DetectedProject } from '../formatDetect';
import { buildOperationContext } from '../operationContext';
import { resolveContainerOutputPath } from '../workspacePathPolicy';
import { OperationRuntime, throwIfOperationAborted } from '../../core/operationRuntime';

function rpgExtractOptions(request: AgentRequest, dataDir: string): RpgExtractOptions {
    const options = request.options;
    const force = options.force === true;
    if (request.profile === 'full') {
        return {
            dir: dataDir,
            force,
            ext_note: true,
            ext_src: true,
            ext_javascript: true,
            ext_plugin: true,
            exJson: true,
        };
    }
    if (request.profile === 'advanced') {
        return {
            dir: dataDir,
            force,
            ext_plugin: options.ext_plugin === true,
            ext_src: options.ext_src === true,
            ext_javascript: options.ext_javascript === true,
            ext_note: options.ext_note === true,
            exJson: options.exJson === true,
            autoline: options.autoline === true,
            decryptImg: options.decryptImg === true,
            decryptAudio: options.decryptAudio === true,
        };
    }
    return { dir: dataDir, force };
}

function wolfConfig(request: AgentRequest): { [key: string]: boolean } {
    const options = request.options;
    if (request.profile === 'advanced') {
        return {
            force: true,
            extPattern: options.extPattern === true,
            extBuran: options.extBuran === true,
            extAll: options.extAll === true,
        };
    }
    if (request.profile === 'full') return { force: true, extBuran: true, extAll: true };
    return { force: true };
}

async function extractAsar(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    runtime: OperationRuntime,
): Promise<void> {
    const engine = selectEngineAdapter(detected);
    if (!detected.container || (engine.family !== 'rpgmaker' && engine.family !== 'gdevelop')) {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            '현재 ASAR 엔진 프로파일은 진단만 지원합니다',
            { format: detected.format },
        );
    }
    const output = resolveContainerOutputPath(request, detected.container.rootPath);
    const transaction = new WorkspaceTransaction({ outputPath: output, force: request.options.force === true, signal: runtime.signal });
    try {
        await extractContainer(detected.container, transaction.stagingPath);
        const provenance = createContainerProvenance(detected.container, transaction.stagingPath);
        if (detected.container.archive?.invalidEntryCount) {
            result.warnings.push(
                `비정상 ASAR metadata ${detected.container.archive.invalidEntryCount}개는 작업본에서 제외되며 재패키징에는 별도 실험 opt-in이 필요합니다`,
            );
        }
        if (engine.family === 'gdevelop') {
            const engineRoot = path.join(
                transaction.stagingPath,
                ...detected.container.engine.root.split('/').filter(Boolean),
            );
            const report = new GDevelopService().extract({
                projectRoot: engineRoot,
                force: request.options.force === true,
                experimentalGdevelopCodeStrings: request.options.experimentalGdevelopCodeStrings === true,
            });
            copyExternalResources(detected.container, transaction.stagingPath);
            writeContainerProvenance(transaction.stagingPath, provenance);
            throwIfOperationAborted(runtime, 'extract-asar-gdevelop-commit');
            transaction.commit();
            const finalEngineRoot = path.join(output, ...detected.container.engine.root.split('/').filter(Boolean));
            result.artifacts = [
                output,
                path.join(finalEngineRoot, '_Extract'),
                path.join(output, CONTAINER_PROVENANCE_FILE),
            ];
            result.stats = {
                files: report.extractedFiles,
                entries: report.extractedEntries,
                codeEntries: report.codeEntries,
                ambiguousCodeStrings: report.ambiguousCodeStrings,
            };
            result.ok = true;
            return;
        }
        const dataDir = path.join(transaction.stagingPath, detected.container.engine.root, 'data');
        if (!fs.existsSync(dataDir)) {
            throw new OperationError(
                ErrorCodes.FORMAT_UNKNOWN,
                'ASAR 안에서 MZ data 폴더를 찾지 못했습니다',
                { dataDir },
            );
        }
        const service = new RpgMakerService(buildOperationContext(runtime));
        const report = await service.extract(rpgExtractOptions(request, dataDir));
        copyExternalResources(detected.container, transaction.stagingPath);
        writeContainerProvenance(transaction.stagingPath, provenance);
        throwIfOperationAborted(runtime, 'extract-asar-commit');
        transaction.commit();
        result.artifacts = [
            output,
            path.join(output, detected.container.engine.root, 'data', 'Extract'),
            path.join(output, detected.container.engine.root, 'data', '.extracteddata'),
            path.join(output, CONTAINER_PROVENANCE_FILE),
        ];
        result.stats = {
            files: report.extractedFiles.length,
            entries: report.manifestEntries ?? 0,
            textBytes: report.textBytes,
            elapsedMs: Math.round(report.elapsedMs),
        };
        result.ok = true;
    } finally {
        transaction.dispose();
    }
}

async function extractNw(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    runtime: OperationRuntime,
): Promise<void> {
    const engine = selectEngineAdapter(detected);
    if (!detected.container || detected.container.type !== 'nwjs-package' || engine.family !== 'gdevelop') {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            '현재 package.nw 엔진 프로파일은 GDevelop만 추출할 수 있습니다',
            { format: detected.format },
        );
    }
    if (detected.container.engine.features.includes('nwjs-directory-form')
        && request.options.experimentalNwDirectory !== true) {
        throw new OperationError(
            ErrorCodes.EXPERIMENTAL_FEATURE_DISABLED,
            'directory-form package.nw 추출은 options.experimentalNwDirectory=true가 필요합니다',
        );
    }
    if (detected.container.engine.features.includes('nwjs-appended-zip')
        && request.options.experimentalNwAppendedZip !== true) {
        throw new OperationError(
            ErrorCodes.EXPERIMENTAL_FEATURE_DISABLED,
            'appended ZIP NW.js 추출은 options.experimentalNwAppendedZip=true가 필요합니다',
        );
    }
    if (detected.container.engine.features.includes('nwjs-appended-zip')
        && detected.container.archive?.appendedZip?.safeToRepack !== true) {
        throw new OperationError(
            ErrorCodes.EXPERIMENTAL_FEATURE_UNSAFE,
            detected.container.archive?.appendedZip?.reason ?? 'appended ZIP NW.js 실행 파일은 안전하게 변경할 수 없습니다',
        );
    }
    const output = resolveContainerOutputPath(request, detected.container.rootPath);
    const transaction = new WorkspaceTransaction({ outputPath: output, force: request.options.force === true, signal: runtime.signal });
    try {
        await extractContainer(detected.container, transaction.stagingPath);
        const provenance = createContainerProvenance(detected.container, transaction.stagingPath);
        const engineRoot = path.join(
            transaction.stagingPath,
            ...detected.container.engine.root.split('/').filter(Boolean),
        );
        const report = new GDevelopService().extract({
            projectRoot: engineRoot,
            force: request.options.force === true,
            experimentalGdevelopCodeStrings: request.options.experimentalGdevelopCodeStrings === true,
        });
        writeContainerProvenance(transaction.stagingPath, provenance);
        throwIfOperationAborted(runtime, 'extract-nw-commit');
        transaction.commit();
        const outputEngineRoot = path.join(output, ...detected.container.engine.root.split('/').filter(Boolean));
        result.artifacts = [
            output,
            path.join(outputEngineRoot, '_Extract'),
            path.join(output, CONTAINER_PROVENANCE_FILE),
        ];
        result.stats = {
            files: report.extractedFiles,
            entries: report.extractedEntries,
            codeEntries: report.codeEntries,
            ambiguousCodeStrings: report.ambiguousCodeStrings,
        };
        result.ok = true;
    } finally {
        transaction.dispose();
    }
}

type LooseExtractFamily = 'rpgmaker' | 'wolf' | 'tyrano' | 'gdevelop';
type LooseExtractHandler = (
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    runtime: OperationRuntime,
) => Promise<void>;

async function extractLooseRpg(request: AgentRequest, detected: DetectedProject, result: AgentResult, runtime: OperationRuntime): Promise<void> {
    const report = await new RpgMakerService(buildOperationContext(runtime)).extract(
        rpgExtractOptions(request, detected.dataDir),
    );
    result.artifacts = [
        path.join(detected.dataDir, 'Extract'),
        path.join(detected.dataDir, 'Backup'),
        path.join(detected.dataDir, '.extracteddata'),
        report.manifestPath ?? '',
    ].filter((artifact) => artifact !== '');
    result.stats = {
        files: report.extractedFiles.length,
        entries: report.manifestEntries ?? 0,
        textBytes: report.textBytes,
        elapsedMs: Math.round(report.elapsedMs),
    };
}

async function extractLooseWolf(request: AgentRequest, detected: DetectedProject, result: AgentResult, runtime: OperationRuntime): Promise<void> {
    const report = await new WolfService(buildOperationContext(runtime)).extract({
        folder: detected.dataDir,
        config: wolfConfig(request),
    });
    result.artifacts = [report.extractDir ?? '', report.manifestPath ?? ''].filter(
        (artifact) => artifact !== '',
    );
    result.stats = { entries: report.extractedEntries };
}

async function extractLooseTyrano(request: AgentRequest, detected: DetectedProject, result: AgentResult, runtime: OperationRuntime): Promise<void> {
    throwIfOperationAborted(runtime, 'extract-tyrano');
    const report = new TyranoService().extract({
        projectRoot: tyranoProjectRoot(detected),
        force: request.options.force === true,
    });
    result.artifacts = [report.extractDir, report.manifestPath];
    result.stats = { files: report.extractedFiles, entries: report.extractedEntries };
}

async function extractLooseGdevelop(request: AgentRequest, detected: DetectedProject, result: AgentResult, runtime: OperationRuntime): Promise<void> {
    throwIfOperationAborted(runtime, 'extract-gdevelop');
    const report = new GDevelopService().extract({
        projectRoot: gdevelopProjectRoot(detected),
        force: request.options.force === true,
        experimentalGdevelopCodeStrings: request.options.experimentalGdevelopCodeStrings === true,
    });
    result.artifacts = [report.extractDir, report.manifestPath];
    result.stats = {
        files: report.extractedFiles,
        entries: report.extractedEntries,
        codeEntries: report.codeEntries,
        ambiguousCodeStrings: report.ambiguousCodeStrings,
    };
}

export const looseExtractHandlerRegistry: Readonly<Record<LooseExtractFamily, LooseExtractHandler>> = Object.freeze({
    rpgmaker: extractLooseRpg,
    wolf: extractLooseWolf,
    tyrano: extractLooseTyrano,
    gdevelop: extractLooseGdevelop,
});

export async function handleExtract(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    runtime: OperationRuntime,
): Promise<void> {
    const engine = selectEngineAdapter(detected);
    if (!engine.operations.includes('extract')) {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            `현재 엔진 프로파일은 진단만 지원합니다: ${detected.format}`,
            { format: detected.format },
        );
    }
    if (detected.container?.type === 'electron-asar') return extractAsar(request, detected, result, runtime);
    if (detected.container?.type === 'nwjs-package') return extractNw(request, detected, result, runtime);

    const looseHandler = looseExtractHandlerRegistry[engine.family as LooseExtractFamily];
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
