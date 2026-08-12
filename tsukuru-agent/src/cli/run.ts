#!/usr/bin/env node
/**
 * tsukuru-agent CLI 진입점 (계획서 §CLI 계약).
 *   tsukuru-agent run --request -
 *   tsukuru-agent run --request request.json
 * stdout은 최종 결과 JSON 전용이며, 모든 로그·진행률은 stderr로 본낸다.
 */
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import * as asar from '@electron/asar';
import { validateRequest, AgentRequest, AgentResult, emptyResult } from '../core/schema';
import { OperationError, ErrorCodes, toOperationError } from '../core/types';
import { createOperationContext, createRpgState, createWolfState, OperationContext } from '../core/context';
import { StderrLogger, StderrProgressSink } from '../core/sinks';
import { detectProject, DetectedProject } from './formatDetect';
import { applyPatches, resolveExtractArtifactPath } from './patcher';
import { RpgMakerService, RpgExtractOptions } from '../js/rpgmv/RpgMakerService';
import { WolfService } from '../js/wolf/WolfService';
import { TyranoService } from '../js/tyrano/TyranoService';
import { GDevelopService } from '../js/gdevelop/GDevelopService';
import * as dataBaseO from '../js/rpgmv/datas.js';
import { MANIFEST_FILE } from '../core/manifest';
import {
    diffFileMaps,
    inspectRpgProject,
    inspectTyranoProject,
    inspectWolfBinaryMappings,
    isProtectedPath,
    scoreVerification,
    snapshotDirectory,
    StructuralIssue,
} from '../core/validator';
import { copyExternalResources, extractContainer, inspectContainer, packContainer, verifyContainerOutput } from '../core/container';
import { inspectElectronRuntime, runLaunchProbe } from '../core/runtimeDiagnostics';
import {
    CONTAINER_PROVENANCE_FILE,
    ContainerProvenance,
    createContainerProvenance,
    readContainerProvenance,
    writeContainerProvenance,
} from '../core/containerProvenance';

// stdout 계약 보호: 레거시 console 출력을 모두 stderr로 리다이렉트한다.
console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

function usage(): string {
    return '사용법: tsukuru-agent run --request <request.json|->';
}

function parseArgs(argv: string[]): string {
    const [cmd, ...rest] = argv;
    if (cmd !== 'run') {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, `지원하지 않는 명령입니다: ${cmd ?? '(없음)'}. ${usage()}`);
    }
    const idx = rest.indexOf('--request');
    if (idx < 0 || idx + 1 >= rest.length) {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, `--request <file|-> 인수가 필요합니다. ${usage()}`);
    }
    return rest[idx + 1];
}

function loadRequest(source: string): unknown {
    let raw: string;
    try {
        raw = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(source, 'utf8');
    } catch (err) {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, `요청을 읽을 수 없습니다: ${source}`, { cause: String(err) });
    }
    try {
        return JSON.parse(raw);
    } catch (err) {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, '요청 JSON 파싱에 실패했습니다', { cause: String(err) });
    }
}

function buildContext(): OperationContext {
    return createOperationContext(new StderrProgressSink(), new StderrLogger(), {
        rpg: createRpgState({ ...dataBaseO.settings }),
        wolf: createWolfState(),
    });
}

/** CLI가 포맷을 미리 판별하므로 서비스의 폼더명 검사는 force로 우회한다. */
function rpgExtractOptions(req: AgentRequest, dataDir: string): RpgExtractOptions {
    const o = req.options;
    const force = o.force === true;
    if (req.profile === 'full') {
        return { dir: dataDir, force, ext_note: true, ext_src: true, ext_javascript: true, ext_plugin: true, exJson: true };
    }
    if (req.profile === 'advanced') {
        return { ...(o as object), dir: dataDir, force } as RpgExtractOptions;
    }
    // standard: 기존 GUI 기본 추출 수준(renderer.ts 기본값은 모든 확장 플래그 off)
    return { dir: dataDir, force };
}

function wolfConfig(req: AgentRequest): { [key: string]: boolean } {
    const o = req.options;
    if (req.profile === 'advanced') {
        return { force: true, ...(o as { [key: string]: boolean }) };
    }
    if (req.profile === 'full') {
        return { force: true, extBuran: true, extAll: true };
    }
    return { force: true };
}

function resolveProject(req: AgentRequest): DetectedProject {
    if (!fs.existsSync(req.projectPath)) {
        throw new OperationError(ErrorCodes.PATH_NOT_FOUND, '프로젝트 경로가 존재하지 않습니다', { projectPath: req.projectPath });
    }
    const detected = detectProject(req.projectPath);
    if (!detected) {
        throw new OperationError(ErrorCodes.FORMAT_UNKNOWN, '프로젝트 포맷을 판별할 수 없습니다(data 폼더의 .json/.mps 또는 Data.wolf를 찾지 못했습니다)', { projectPath: req.projectPath });
    }
    const compatible = req.format === 'auto'
        || req.format === detected.format
        || (req.format === 'rpgmv' && detected.format === 'rpgmz')
        || (req.format === 'rpgmz-electron' && detected.format === 'rpgmz')
        || (req.format === 'gdevelop-electron' && detected.format === 'gdevelop')
        || (req.format === 'nwjs-webgame' && detected.container?.type === 'nwjs-package');
    if (!compatible) {
        throw new OperationError(ErrorCodes.FORMAT_MISMATCH, `요청 포맷(${req.format})과 실제 포맷(${detected.format})이 다릅니다`, { detected });
    }
    return detected;
}

function attachDiagnostics(detected: DetectedProject, result: AgentResult): void {
    const container = detected.container;
    if (!container) {
        return;
    }
    result.container = {
        type: container.type,
        path: container.archivePath
            ? path.relative(container.rootPath, container.archivePath).replace(/\\/g, '/')
            : null,
        root: container.engine.root,
        confidence: container.engine.confidence,
        integrity: container.archive?.integrity,
        invalidEntryCount: container.archive?.invalidEntryCount ?? 0,
    };
    result.engine = {
        type: container.engine.type,
        wrapper: container.engine.wrapper,
        features: container.engine.features,
        confidence: container.engine.confidence,
    };
}

function publicScores(scores: ReturnType<typeof scoreVerification>): AgentResult['scores'] {
    return {
        total: scores.total,
        extractionCoverage: scores.extractionCoverage,
        mappingIntegrity: scores.mappingIntegrity,
        reinsertionValidity: scores.reinsertionValidity,
        protectedScriptIntegrity: scores.protectedScriptIntegrity,
        containerIntegrity: scores.containerIntegrity,
        risk: scores.risk,
    };
}

function extractDirOf(detected: DetectedProject): string {
    if (detected.format === 'gdevelop') return path.join(gdevelopProjectRoot(detected), '_Extract');
    return detected.format === 'rpgmv' || detected.format === 'rpgmz'
        ? path.join(detected.dataDir, 'Extract')
        : path.join(detected.dataDir, '_Extract');
}

function gdevelopProjectRoot(detected: DetectedProject): string {
    const containerRoot = detected.container?.rootPath ?? path.dirname(detected.dataDir);
    const engineRoot = detected.container?.engine.root ?? '';
    const candidate = path.join(containerRoot, ...engineRoot.split('/').filter(Boolean));
    if (fs.existsSync(path.join(candidate, 'data.js')) || fs.existsSync(path.join(candidate, 'www', 'data.js'))) return candidate;
    return containerRoot;
}

function tyranoProjectRoot(detected: DetectedProject): string {
    const containerRoot = detected.container?.rootPath ?? path.dirname(detected.dataDir);
    const engineRoot = detected.container?.engine.root ?? '';
    const candidate = path.join(containerRoot, engineRoot);
    if (path.basename(candidate).toLowerCase() === 'data' && fs.existsSync(path.join(candidate, 'scenario'))) {
        return path.dirname(candidate);
    }
    if (fs.existsSync(path.join(candidate, 'data', 'scenario'))) return candidate;
    if (path.basename(detected.dataDir).toLowerCase() === 'data' && fs.existsSync(path.join(detected.dataDir, 'scenario'))) {
        return path.dirname(detected.dataDir);
    }
    return containerRoot;
}

function structuralIssueMessage(issue: StructuralIssue): string {
    const position = issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : '';
    return `[${issue.code}] ${issue.file ?? '(project)'}${position}: ${issue.message}`;
}

function writeStructuralSummary(result: AgentResult): void {
    const validation = result.validation;
    if (!validation) return;
    process.stderr.write(
        `[Tsukuru Agent] validation=${validation.profile} files=${validation.filesChecked} entries=${validation.entriesChecked} invalid=${validation.invalidEntries} token-errors=${validation.tokenErrors} encoding-warnings=${validation.encodingWarnings}\n`,
    );
}

/** verify: 읽기 전용으로 포맷·경로·manifest·매핑·출력 조건을 검사한다. */
async function opVerify(req: AgentRequest, detected: DetectedProject, result: AgentResult): Promise<void> {
    const issues: string[] = [];
    const extractDir = extractDirOf(detected);
    let entries = 0;
    let change = { filesChanged: 0, bytesChanged: 0, textBytesChanged: 0, protectedFilesChanged: 0, protectedScriptDamage: 0 };
    let comparisonPerformed = false;
    if (detected.container?.type === 'electron-asar') {
        const archive = detected.container.archive;
        const runtime = detected.container.archivePath
            ? await inspectElectronRuntime(detected.container.rootPath, detected.container.archivePath, path.relative(detected.container.rootPath, detected.container.archivePath))
            : undefined;
        result.runtime = runtime;
        let containerIntegrity = archive && archive.fileCount > 0 && archive.integrity !== 'unreadable'
            ? (archive.invalidEntryCount > 0 ? 70 : 100)
            : 50;
        if (runtime?.blocked) containerIntegrity = 0;
        else if (runtime?.signature?.status === 'hash-mismatch') containerIntegrity = Math.min(containerIntegrity, 40);
        const critical = detected.container.engine.type === 'unknown' ? ['engine-unknown'] : [];
        if (runtime?.blocked) critical.push('electron-asar-integrity-mismatch');
        if (runtime?.signature?.status === 'hash-mismatch') critical.push('authenticode-hash-mismatch');
        const scores = scoreVerification({
            extractionCoverage: 0,
            mappingIntegrity: 0,
            reinsertionValidity: 0,
            protectedScriptIntegrity: 50,
            containerIntegrity,
            critical,
        });
        result.scores = publicScores(scores);
        result.change = { filesChanged: 0, bytesChanged: 0, textBytesChanged: 0, protectedFilesChanged: 0, protectedScriptDamage: 0 };
        result.stats = { entries: archive?.fileCount ?? 0, score: scores.total };
        result.warnings = ['ASAR 컨테이너는 식별되었지만 추출 산출물은 아직 없습니다', ...(runtime?.warnings ?? [])];
        result.ok = false;
        result.error = { code: ErrorCodes.VERIFY_FAILED, message: '검증 실패: ASAR 추출 산출물이 없습니다', details: result.warnings };
        if (req.options.humanSummary === true && result.scores && result.engine) {
            process.stderr.write(`[Tsukuru Agent] container=${result.container?.type ?? 'unknown'} engine=${result.engine.type} wrapper=${result.engine.wrapper ?? 'none'}\n`);
            process.stderr.write(`[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}\n`);
            process.stderr.write(`[Tsukuru Agent] extraction=${result.scores.extractionCoverage}% reinsert=${result.scores.reinsertionValidity}% protected-script-damage=unassessed\n`);
            process.stderr.write(`[Tsukuru Agent] runtime-risk=${runtime?.risk ?? 'unassessed'} fuse=${runtime?.fuses?.embeddedAsarIntegrityValidation ?? 'unknown'} asar-integrity=${runtime?.asarIntegrity?.status ?? 'unassessed'} signature=${runtime?.signature?.status ?? 'unassessed'}\n`);
        }
        return;
    }
    if (detected.format === 'tyrano') {
        const projectRoot = tyranoProjectRoot(detected);
        const extractManifest = path.join(projectRoot, 'data', '_Extract', MANIFEST_FILE);
        if (fs.existsSync(extractManifest)) {
            let validation;
            try {
                validation = new TyranoService().verifyWorkspace(projectRoot);
            } catch (error) {
                const operationError = toOperationError(error);
                validation = inspectTyranoProject(projectRoot);
                let manifestEntries = 0;
                try {
                    const parsedManifest = JSON.parse(fs.readFileSync(extractManifest, 'utf8'));
                    manifestEntries = Array.isArray(parsedManifest.entries) ? parsedManifest.entries.length : 0;
                } catch { /* 아래 issue가 manifest 실패를 대표한다. */ }
                const details = operationError.details && typeof operationError.details === 'object'
                    ? operationError.details as Record<string, unknown>
                    : {};
                const issueCode = operationError.code === ErrorCodes.SOURCE_CHANGED
                    ? 'TYRANO_SOURCE_CHANGED'
                    : operationError.code === ErrorCodes.PATCH_HASH_MISMATCH
                        ? 'TYRANO_EXTRACT_HASH_MISMATCH'
                        : operationError.code === ErrorCodes.ENCODING_UNREPRESENTABLE
                            ? 'TYRANO_ENCODING_UNREPRESENTABLE'
                            : operationError.code === ErrorCodes.MAPPING_CORRUPT
                                ? 'TYRANO_MAPPING_CORRUPT'
                                : 'TYRANO_REINSERTION_FAILED';
                validation.ok = false;
                validation.entriesChecked = manifestEntries;
                validation.invalidEntries = manifestEntries > 0 ? 1 : 0;
                validation.validEntries = Math.max(0, manifestEntries - validation.invalidEntries);
                validation.tokenErrors++;
                validation.issues.push({
                    code: issueCode,
                    severity: 'critical',
                    file: typeof details.sourceFile === 'string' ? details.sourceFile : null,
                    message: operationError.message,
                });
            }
            result.validation = validation;
            const scores = scoreVerification({
                extractionCoverage: 100,
                mappingIntegrity: validation.entriesChecked > 0 ? 100 : 0,
                reinsertionValidity: validation.ok ? 100 : 0,
                protectedScriptIntegrity: validation.ok ? 100 : 0,
                containerIntegrity: 100,
                critical: validation.ok ? [] : ['tyrano-workspace-invalid'],
            });
            result.ok = validation.ok && scores.ok;
            result.warnings = validation.issues.map(structuralIssueMessage);
            result.scores = publicScores(scores);
            result.change = change;
            result.stats = {
                entries: validation.entriesChecked,
                files: validation.filesChecked,
                invalidEntries: validation.invalidEntries,
                tokenErrors: validation.tokenErrors,
                encodingWarnings: validation.encodingWarnings,
                score: scores.total,
            };
            if (!result.ok) result.error = { code: ErrorCodes.VERIFY_FAILED, message: '검증 실패: Tyrano 작업본을 안전하게 재삽입할 수 없습니다', details: result.warnings };
            if (req.options.humanSummary === true && result.scores && result.engine) {
                process.stderr.write(`[Tsukuru Agent] container=${result.container?.type ?? 'unknown'} engine=${result.engine.type} wrapper=${result.engine.wrapper ?? 'none'}\n`);
                process.stderr.write(`[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}\n`);
                process.stderr.write(`[Tsukuru Agent] extraction=100% reinsert=${result.scores.reinsertionValidity}% protected-script-integrity=${result.scores.protectedScriptIntegrity}%\n`);
                writeStructuralSummary(result);
            }
            return;
        }
        const validation = inspectTyranoProject(projectRoot);
        result.validation = validation;
        const mappingIntegrity = validation.entriesChecked > 0
            ? Math.round(validation.validEntries / validation.entriesChecked * 100)
            : 0;
        const structuralIssues = validation.issues.map(structuralIssueMessage);
        const warnings = [
            'Tyrano 원본 구조 검사는 완료했지만 data/_Extract 작업본이 없습니다. 먼저 extract를 실행하세요',
            ...structuralIssues,
        ];
        const scores = scoreVerification({
            extractionCoverage: 0,
            mappingIntegrity,
            reinsertionValidity: 0,
            protectedScriptIntegrity: validation.ok ? 100 : 0,
            containerIntegrity: 100,
            critical: validation.ok ? [] : ['tyrano-structure-invalid'],
        });
        result.ok = false;
        result.warnings = warnings;
        result.scores = publicScores(scores);
        result.change = change;
        result.stats = {
            entries: validation.entriesChecked,
            files: validation.filesChecked,
            invalidEntries: validation.invalidEntries,
            tokenErrors: validation.tokenErrors,
            encodingWarnings: validation.encodingWarnings,
            score: scores.total,
        };
        result.error = {
            code: ErrorCodes.VERIFY_FAILED,
            message: validation.ok
                ? '검증 제한: Tyrano 추출 작업본이 없습니다'
                : `검증 실패: Tyrano 구조 오류 ${validation.tokenErrors}건`,
            details: warnings,
        };
        if (req.options.humanSummary === true && result.scores && result.engine) {
            process.stderr.write(`[Tsukuru Agent] container=${result.container?.type ?? 'unknown'} engine=${result.engine.type} wrapper=${result.engine.wrapper ?? 'none'}\n`);
            process.stderr.write(`[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}\n`);
            process.stderr.write(`[Tsukuru Agent] extraction=0% reinsert=0% protected-script-integrity=${result.scores.protectedScriptIntegrity}%\n`);
            writeStructuralSummary(result);
        }
        return;
    }
    if (detected.format === 'gdevelop') {
        const projectRoot = gdevelopProjectRoot(detected);
        const extractManifest = path.join(projectRoot, '_Extract', MANIFEST_FILE);
        let validation: import('../core/validator').StructuralValidationReport;
        if (!fs.existsSync(extractManifest)) {
            validation = {
                profile: 'gdevelop', ok: false, filesChecked: fs.existsSync(path.join(projectRoot, 'data.js')) ? 1 : 0,
                entriesChecked: 0, validEntries: 0, invalidEntries: 0,
                encodingCounts: { utf8: 0, shiftJis: 0, unknown: 0 }, encodingWarnings: 0, tokenErrors: 1,
                issues: [{
                    code: 'GDEVELOP_MANIFEST_MISSING', severity: 'critical', file: null,
                    message: 'GDevelop _Extract 작업본이 없습니다. 먼저 extract를 실행하세요',
                }],
            };
        } else {
            try {
                validation = new GDevelopService().verifyWorkspace(projectRoot);
            } catch (error) {
                const operationError = toOperationError(error);
                let manifestEntries = 0;
                try {
                    const parsedManifest = JSON.parse(fs.readFileSync(extractManifest, 'utf8'));
                    manifestEntries = Array.isArray(parsedManifest.entries) ? parsedManifest.entries.length : 0;
                } catch { /* 아래 issue가 manifest 실패를 대표한다. */ }
                validation = {
                    profile: 'gdevelop', ok: false, filesChecked: 1,
                    entriesChecked: manifestEntries, validEntries: Math.max(0, manifestEntries - 1),
                    invalidEntries: manifestEntries > 0 ? 1 : 0,
                    encodingCounts: { utf8: 1, shiftJis: 0, unknown: 0 }, encodingWarnings: 0, tokenErrors: 1,
                    issues: [{
                        code: operationError.code === ErrorCodes.SOURCE_CHANGED
                            ? 'GDEVELOP_SOURCE_CHANGED'
                            : operationError.code === ErrorCodes.PATCH_HASH_MISMATCH
                                ? 'GDEVELOP_EXTRACT_HASH_MISMATCH'
                                : 'GDEVELOP_REINSERTION_FAILED',
                        severity: 'critical', file: null, message: operationError.message,
                    }],
                };
            }
        }
        result.validation = validation;
        const scores = scoreVerification({
            extractionCoverage: validation.entriesChecked > 0 ? 100 : 0,
            mappingIntegrity: validation.entriesChecked > 0
                ? Math.round(validation.validEntries / validation.entriesChecked * 100)
                : 0,
            reinsertionValidity: validation.ok ? 100 : 0,
            protectedScriptIntegrity: validation.ok ? 100 : 0,
            containerIntegrity: detected.container?.archive
                ? (detected.container.archive.invalidEntryCount === 0 ? 100 : 0)
                : 100,
            critical: validation.ok ? [] : ['gdevelop-workspace-invalid'],
        });
        result.ok = validation.ok && scores.ok;
        result.warnings = validation.issues.map(structuralIssueMessage);
        result.scores = publicScores(scores);
        result.change = change;
        result.stats = {
            entries: validation.entriesChecked,
            files: validation.filesChecked,
            invalidEntries: validation.invalidEntries,
            tokenErrors: validation.tokenErrors,
            encodingWarnings: validation.encodingWarnings,
            score: scores.total,
        };
        if (!result.ok) result.error = { code: ErrorCodes.VERIFY_FAILED, message: '검증 실패: GDevelop 작업본을 안전하게 재삽입할 수 없습니다', details: result.warnings };
        if (req.options.humanSummary === true && result.scores && result.engine) {
            process.stderr.write(`[Tsukuru Agent] container=${result.container?.type ?? 'unknown'} engine=${result.engine.type} wrapper=${result.engine.wrapper ?? 'none'}\n`);
            process.stderr.write(`[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}\n`);
            process.stderr.write(`[Tsukuru Agent] extraction=${result.scores.extractionCoverage}% reinsert=${result.scores.reinsertionValidity}% protected-script-integrity=${result.scores.protectedScriptIntegrity}%\n`);
            writeStructuralSummary(result);
        }
        return;
    }
    let manifest: unknown;
    if (!fs.existsSync(extractDir)) {
        issues.push(`추출 산출물 디렉터리가 없습니다: ${extractDir}`);
    } else {
        const manifestPath = path.join(extractDir, MANIFEST_FILE);
        if (!fs.existsSync(manifestPath)) {
            issues.push('manifest.json이 없습니다(구버전 추출 산출물이면 patch를 사용할 수 없습니다)');
        } else {
            try {
                const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                manifest = m;
                if (m.schemaVersion !== 1 && m.schemaVersion !== 2) {
                    issues.push(`지원하지 않는 manifest schemaVersion입니다: ${String(m.schemaVersion)}`);
                }
                const expectedManifestFormat = detected.format === 'rpgmz' ? 'rpgmv' : detected.format;
                if (m.format !== expectedManifestFormat) {
                    issues.push(`manifest 포맷(${m.format})과 실제 포맷(${detected.format})이 다릅니다`);
                }
                if (!Array.isArray(m.entries)) {
                    issues.push('manifest entries가 배열이 아닙니다');
                } else {
                    entries = m.entries.length;
                    if (entries === 0) issues.push('manifest entries가 비어 있습니다');
                    const textFiles = new Set<unknown>(m.entries.map((e: any) => e.extractFile));
                    for (const t of textFiles) {
                        const textPath = resolveExtractArtifactPath(extractDir, t);
                        if (!fs.existsSync(textPath)) issues.push(`추출 텍스트 파일이 없습니다: ${String(t)}`);
                    }
                }
            } catch (err) {
                if (err instanceof OperationError) throw err;
                throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, 'manifest.json 파싱에 실패했습니다', { manifestPath });
            }
        }
        // .extracteddata location differs by format (MV: data dir / Wolf: inside _Extract)
        const edPath = detected.format === 'rpgmv' || detected.format === 'rpgmz'
            ? path.join(detected.dataDir, '.extracteddata')
            : path.join(extractDir, '.extracteddata');
        if (!fs.existsSync(edPath)) {
            issues.push('.extracteddata 파일이 없습니다(apply에 필요합니다)');
        }
    }
    const artifactIssueCount = issues.length;
    if ((detected.format === 'rpgmv' || detected.format === 'rpgmz') && manifest) {
        const validation = inspectRpgProject(detected.dataDir, manifest);
        result.validation = validation;
        issues.push(...validation.issues.map(structuralIssueMessage));
    } else if (detected.format === 'wolf' && manifest) {
        const validation = inspectWolfBinaryMappings(detected.dataDir, manifest);
        result.validation = validation;
        issues.push(...validation.issues.map(structuralIssueMessage));
    }
    if (req.outputPath) {
        const sourcePath = path.resolve(req.projectPath);
        const outputPath = path.resolve(req.outputPath);
        if (sourcePath === outputPath) {
            issues.push('원본 경로와 출력 경로는 같을 수 없습니다');
        } else if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).isDirectory()) {
            issues.push(`비교할 출력 디렉터리가 없습니다: ${req.outputPath}`);
        } else {
            try {
                const before = snapshotDirectory(sourcePath);
                const after = snapshotDirectory(outputPath);
                const diff = diffFileMaps(before, after);
                comparisonPerformed = true;
                change = {
                    filesChanged: diff.filesChanged,
                    bytesChanged: diff.bytesChanged,
                    textBytesChanged: diff.textBytesChanged,
                    protectedFilesChanged: diff.protectedFilesChanged,
                    protectedScriptDamage: diff.protectedScriptDamage,
                };
                if (change.protectedScriptDamage > 0) {
                    issues.push('보호 스크립트가 변형되었습니다');
                }
            } catch (err) {
                issues.push(`출력 비교에 실패했습니다: ${String(err)}`);
            }
        }
    }
    const extractionReady = artifactIssueCount === 0 && entries > 0;
    const mappingIntegrity = result.validation
        ? (result.validation.entriesChecked > 0
            ? Math.round(result.validation.validEntries / result.validation.entriesChecked * 100)
            : 0)
        : (extractionReady ? 100 : 0);
    const ready = issues.length === 0 && extractionReady && (result.validation?.ok ?? true);
    const deep = req.options.verifyDepth === 'deep';
    const structuralCritical = result.validation?.issues
        .filter((issue) => issue.severity === 'critical')
        .map((issue) => issue.code) ?? [];
    const scores = scoreVerification({
        extractionCoverage: extractionReady ? 100 : 0,
        mappingIntegrity,
        reinsertionValidity: ready ? (deep && comparisonPerformed ? 80 : 50) : 0,
        protectedScriptIntegrity: comparisonPerformed ? (change.protectedScriptDamage === 0 ? 100 : 0) : 50,
        containerIntegrity: detected.container?.archive ? (detected.container.archive.integrity === 'unreadable' ? 50 : 100) : 100,
        critical: [
            ...(change.protectedScriptDamage > 0 ? ['protected-script-changed'] : []),
            ...structuralCritical,
        ],
    });
    result.ok = issues.length === 0 && scores.ok;
    result.warnings = issues;
    result.scores = publicScores(scores);
    result.change = change;
    result.stats = {
        entries,
        score: scores.total,
        ...(result.validation ? {
            files: result.validation.filesChecked,
            invalidEntries: result.validation.invalidEntries,
            tokenErrors: result.validation.tokenErrors,
            encodingWarnings: result.validation.encodingWarnings,
        } : {}),
    };
    if (!result.ok) {
        result.error = { code: ErrorCodes.VERIFY_FAILED, message: `검증 실패: ${issues.length}건`, details: issues };
    }
    if (req.options.humanSummary === true && result.scores && result.engine) {
        process.stderr.write(`[Tsukuru Agent] container=${result.container?.type ?? 'unknown'} engine=${result.engine.type} wrapper=${result.engine.wrapper ?? 'none'}\n`);
        process.stderr.write(`[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}\n`);
        const damageSummary = comparisonPerformed ? `${result.change.protectedScriptDamage}%` : 'unassessed';
        process.stderr.write(`[Tsukuru Agent] extraction=${result.scores.extractionCoverage}% reinsert=${result.scores.reinsertionValidity}% protected-script-damage=${damageSummary}\n`);
        writeStructuralSummary(result);
    }
}

async function opExtract(req: AgentRequest, detected: DetectedProject, result: AgentResult): Promise<void> {
    if (detected.container?.type === 'electron-asar') {
        await opExtractAsar(req, detected, result);
        return;
    }
    if (detected.container?.type === 'nwjs-package') {
        await opExtractNw(req, detected, result);
        return;
    }
    const context = buildContext();
    if (detected.format === 'rpgmv' || detected.format === 'rpgmz') {
        const svc = new RpgMakerService(context);
        const rep = await svc.extract(rpgExtractOptions(req, detected.dataDir));
        result.artifacts = [path.join(detected.dataDir, 'Extract'), path.join(detected.dataDir, 'Backup'), path.join(detected.dataDir, '.extracteddata'), rep.manifestPath ?? ''].filter((a) => a !== '');
        result.stats = { files: rep.extractedFiles.length, entries: rep.manifestEntries ?? 0, textBytes: rep.textBytes, elapsedMs: Math.round(rep.elapsedMs) };
    } else if (detected.format === 'wolf') {
        const svc = new WolfService(context);
        const rep = await svc.extract({ folder: detected.dataDir, config: wolfConfig(req) });
        result.artifacts = [rep.extractDir ?? '', rep.manifestPath ?? ''].filter((a) => a !== '');
        result.stats = { entries: rep.extractedEntries };
    } else if (detected.format === 'tyrano') {
        const rep = new TyranoService().extract({ projectRoot: tyranoProjectRoot(detected), force: req.options.force === true });
        result.artifacts = [rep.extractDir, rep.manifestPath];
        result.stats = { files: rep.extractedFiles, entries: rep.extractedEntries };
    } else if (detected.format === 'gdevelop') {
        const rep = new GDevelopService().extract({ projectRoot: gdevelopProjectRoot(detected), force: req.options.force === true });
        result.artifacts = [rep.extractDir, rep.manifestPath];
        result.stats = { files: rep.extractedFiles, entries: rep.extractedEntries };
    } else {
        throw new OperationError(ErrorCodes.NOT_IMPLEMENTED, `현재 엔진 프로파일은 진단만 지원합니다: ${detected.format}`, { format: detected.format });
    }
    result.ok = true;
}

function isWithinPath(parent: string, child: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function pathsOverlap(left: string, right: string): boolean {
    return isWithinPath(left, right) || isWithinPath(right, left);
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
        throw new OperationError(ErrorCodes.CONTAINER_PROVENANCE_INVALID, 'ASAR 작업본 루트는 심볼릭 링크/정션일 수 없습니다', { root });
    }
    for (const segment of normalizeRelative(relative).split('/')) {
        current = path.join(current, segment);
        if (!fs.existsSync(current)) {
            throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'ASAR 작업본에서 원본 파일이 누락되었습니다', { relative });
        }
        if (fs.lstatSync(current).isSymbolicLink()) {
            throw new OperationError(ErrorCodes.CONTAINER_PROVENANCE_INVALID, 'ASAR 작업본에 심볼릭 링크/정션을 사용할 수 없습니다', { relative });
        }
    }
    return current;
}

function copyArchiveWorkingFiles(workingRoot: string, stagingRoot: string, provenance: ContainerProvenance): void {
    fs.mkdirSync(stagingRoot, { recursive: true });
    for (const relative of provenance.archiveFiles) {
        const source = assertNoSymbolicLinkInPath(workingRoot, relative);
        if (!fs.lstatSync(source).isFile()) {
            throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'ASAR 작업본의 원본 파일이 일반 파일이 아닙니다', { relative });
        }
        const target = path.join(stagingRoot, ...relative.split('/'));
        if (!isWithinPath(stagingRoot, target)) {
            throw new OperationError(ErrorCodes.CONTAINER_PROVENANCE_INVALID, 'ASAR staging 경로가 안전하지 않습니다', { relative });
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        fs.chmodSync(target, fs.statSync(source).mode);
    }
}

function copyTreeWithoutLinks(source: string, target: string): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, {
        recursive: true,
        preserveTimestamps: true,
        filter: (candidate) => {
            if (fs.lstatSync(candidate).isSymbolicLink()) {
                throw new OperationError(ErrorCodes.VERIFY_FAILED, '심볼릭 링크/정션이 있는 게임 복사본은 만들 수 없습니다', { path: candidate });
            }
            return true;
        },
    });
}

function copyApplyArtifacts(workingData: string, stagingData: string): void {
    for (const name of ['Extract', 'Backup', '.extracteddata']) {
        const source = path.join(workingData, name);
        if (!fs.existsSync(source)) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, `ASAR 작업본에 apply 필수 산출물이 없습니다: ${name}`, { source });
        }
        copyTreeWithoutLinks(source, path.join(stagingData, name));
    }
}

function overlayDirectory(source: string, target: string): void {
    if (!fs.existsSync(source)) return;
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
        copyTreeWithoutLinks(path.join(source, entry), path.join(target, entry));
    }
}

function verifyProtectedWorkingFiles(workingRoot: string, sourceArchive: string, provenance: ContainerProvenance): void {
    const changed: string[] = [];
    for (const relative of provenance.archiveFiles.filter(isProtectedPath)) {
        const workingFile = assertNoSymbolicLinkInPath(workingRoot, relative);
        const archiveEntry = relative.split('/').join(path.sep);
        const original = asar.extractFile(sourceArchive, archiveEntry, false);
        if (!original.equals(fs.readFileSync(workingFile))) changed.push(relative);
    }
    if (changed.length > 0) {
        throw new OperationError(ErrorCodes.VERIFY_FAILED, 'ASAR 작업본의 보호 스크립트가 원본과 다릅니다', { changed });
    }
}

function containerApplyOutputPath(req: AgentRequest, sourceRoot: string, workingRoot: string): string {
    const source = path.resolve(sourceRoot);
    const working = path.resolve(workingRoot);
    const output = path.resolve(req.outputPath ?? path.join(path.dirname(source), path.basename(source) + '_Completed'));
    if (pathsOverlap(source, output) || pathsOverlap(working, output)) {
        throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '컨테이너 출력은 원본과 작업본 양쪽 경로 바깥이어야 합니다', { outputPath: output });
    }
    if (fs.existsSync(output) && req.options.force !== true) {
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
            throw new OperationError(ErrorCodes.VERIFY_FAILED, 'NW.js 작업본의 보호 스크립트가 원본과 다릅니다', { changed });
        }
    } finally {
        fs.rmSync(originalRoot, { recursive: true, force: true });
    }
}

async function opApplyNwWorking(req: AgentRequest, detected: DetectedProject, result: AgentResult, provenance: ContainerProvenance): Promise<void> {
    if (detected.format !== 'gdevelop' || provenance.engine.type !== 'gdevelop') {
        throw new OperationError(ErrorCodes.FORMAT_MISMATCH, 'NW.js 작업본은 현재 GDevelop 엔진만 적용할 수 있습니다', { format: detected.format });
    }
    const sourcePath = req.options.containerSourcePath;
    if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, 'NW.js apply에는 options.containerSourcePath 원본 경로가 필요합니다');
    }
    const sourceInfo = inspectContainer(sourcePath);
    if (sourceInfo.type !== 'nwjs-package' || !sourceInfo.archive || !sourceInfo.archivePath || !sourceInfo.packagePath) {
        throw new OperationError(ErrorCodes.FORMAT_MISMATCH, 'containerSourcePath에서 package.nw를 찾지 못했습니다', { sourcePath });
    }
    const sourceArchiveRelative = normalizeRelative(path.relative(sourceInfo.rootPath, sourceInfo.packagePath));
    if (sourceArchiveRelative !== provenance.archiveRelativePath || sourceInfo.archive.sha256 !== provenance.archiveSha256) {
        throw new OperationError(ErrorCodes.SOURCE_CHANGED, '지정한 원본 package.nw가 작업본 provenance와 일치하지 않습니다', {
            expectedPath: provenance.archiveRelativePath,
            actualPath: sourceArchiveRelative,
            expectedSha256: provenance.archiveSha256,
            actualSha256: sourceInfo.archive.sha256,
        });
    }
    if (sourceInfo.engine.type !== provenance.engine.type || sourceInfo.engine.root !== provenance.engine.root
        || !equalPathLists(sourceInfo.archive.fileEntries, provenance.archiveFiles)) {
        throw new OperationError(ErrorCodes.SOURCE_CHANGED, '원본 package.nw 엔진 또는 파일 목록이 provenance와 일치하지 않습니다');
    }

    const workingRoot = path.resolve(req.projectPath);
    const output = containerApplyOutputPath(req, sourceInfo.rootPath, workingRoot);
    const outputParent = path.dirname(output);
    fs.mkdirSync(outputParent, { recursive: true });
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-agent-nw-pack-'));
    const archiveWorking = path.join(tempRoot, 'archive-working');
    const engineOutput = path.join(tempRoot, 'engine-output');
    const repackRoot = path.join(tempRoot, 'repack');
    const outputStagingRoot = fs.mkdtempSync(path.join(outputParent, '.tsukuru-agent-nw-output-'));
    const outputStaging = path.join(outputStagingRoot, 'payload');
    try {
        copyArchiveWorkingFiles(workingRoot, archiveWorking, provenance);
        await verifyProtectedNwWorkingFiles(workingRoot, sourceInfo, provenance);
        const engineSegments = provenance.engine.root.split('/').filter(Boolean);
        const workingEngineRoot = path.join(workingRoot, ...engineSegments);
        const archiveEngineRoot = path.join(archiveWorking, ...engineSegments);
        const extractArtifacts = path.join(workingEngineRoot, '_Extract');
        if (!fs.existsSync(extractArtifacts)) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, 'NW.js GDevelop 작업본에 _Extract가 없습니다', { extractArtifacts });
        }
        copyTreeWithoutLinks(extractArtifacts, path.join(archiveEngineRoot, '_Extract'));
        const before = snapshotDirectory(archiveWorking);
        const applied = new GDevelopService().applyToCopy({ projectRoot: archiveEngineRoot, outputRoot: engineOutput });
        let packageRoot = engineOutput;
        if (engineSegments.length > 0) {
            copyTreeWithoutLinks(archiveWorking, repackRoot);
            const repackEngineRoot = path.join(repackRoot, ...engineSegments);
            fs.rmSync(repackEngineRoot, { recursive: true, force: true });
            copyTreeWithoutLinks(engineOutput, repackEngineRoot);
            packageRoot = repackRoot;
        }
        const change = diffFileMaps(before, snapshotDirectory(packageRoot));
        if (change.protectedScriptDamage > 0) {
            throw new OperationError(ErrorCodes.VERIFY_FAILED, 'NW.js apply 과정에서 보호 스크립트가 변경되었습니다', { change });
        }

        copyTreeWithoutLinks(sourceInfo.rootPath, outputStaging);
        const outputArchive = path.join(outputStaging, ...provenance.archiveRelativePath.split('/'));
        fs.rmSync(outputArchive, { force: true });
        await packContainer(sourceInfo, packageRoot, outputArchive);
        const verified = verifyContainerOutput(outputArchive, provenance.requiredEntries);
        if (!verified.archive || verified.archive.invalidEntryCount > 0 || verified.archive.unsafeLinkCount > 0
            || verified.engine.type !== provenance.engine.type || verified.engine.root !== provenance.engine.root
            || !equalPathLists(verified.archive.fileEntries, provenance.archiveFiles)) {
            throw new OperationError(ErrorCodes.VERIFY_FAILED, '재포장한 package.nw 구조 검증에 실패했습니다', { verified });
        }
        if (sha256File(sourceInfo.archivePath) !== provenance.archiveSha256) {
            throw new OperationError(ErrorCodes.SOURCE_CHANGED, '작업 도중 원본 package.nw가 변경되었습니다', { source: sourceInfo.archivePath });
        }
        if (fs.existsSync(output)) {
            if (req.options.force !== true) throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 작업 도중 생성되었습니다', { outputPath: output });
            fs.rmSync(output, { recursive: true, force: true });
        }
        fs.renameSync(outputStaging, output);
        const finalArchive = path.join(output, ...provenance.archiveRelativePath.split('/'));
        result.container = {
            type: 'nwjs-package', path: provenance.archiveRelativePath, root: verified.engine.root,
            confidence: verified.engine.confidence, integrity: verified.archive.integrity,
            invalidEntryCount: verified.archive.invalidEntryCount,
        };
        result.engine = {
            type: verified.engine.type, wrapper: verified.engine.wrapper,
            features: verified.engine.features, confidence: verified.engine.confidence,
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
        fs.rmSync(tempRoot, { recursive: true, force: true });
        fs.rmSync(outputStagingRoot, { recursive: true, force: true });
    }
}

async function opApplyAsarWorking(req: AgentRequest, detected: DetectedProject, result: AgentResult, provenance: ContainerProvenance): Promise<void> {
    if (detected.format !== 'rpgmv' && detected.format !== 'rpgmz') {
        throw new OperationError(ErrorCodes.FORMAT_MISMATCH, 'ASAR 작업본의 RPG Maker 엔진을 판별할 수 없습니다', { format: detected.format });
    }
    const sourcePath = req.options.containerSourcePath;
    if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, 'ASAR apply에는 options.containerSourcePath 원본 경로가 필요합니다');
    }
    const sourceInfo = inspectContainer(sourcePath);
    if (sourceInfo.type !== 'electron-asar' || !sourceInfo.archive || !sourceInfo.archivePath) {
        throw new OperationError(ErrorCodes.FORMAT_MISMATCH, 'containerSourcePath에서 Electron app.asar를 찾지 못했습니다', { sourcePath });
    }
    const sourceArchiveRelative = normalizeRelative(path.relative(sourceInfo.rootPath, sourceInfo.archivePath));
    if (sourceArchiveRelative !== provenance.archiveRelativePath
        || sourceInfo.archive.sha256 !== provenance.archiveSha256) {
        throw new OperationError(ErrorCodes.SOURCE_CHANGED, '지정한 원본 ASAR가 작업본 provenance와 일치하지 않습니다', {
            expectedPath: provenance.archiveRelativePath,
            actualPath: sourceArchiveRelative,
            expectedSha256: provenance.archiveSha256,
            actualSha256: sourceInfo.archive.sha256,
        });
    }
    if (sourceInfo.engine.type !== provenance.engine.type || sourceInfo.engine.root !== provenance.engine.root) {
        throw new OperationError(ErrorCodes.SOURCE_CHANGED, '원본 ASAR 엔진 프로파일이 작업본 provenance와 일치하지 않습니다', {
            expected: provenance.engine,
            actual: sourceInfo.engine,
        });
    }
    if (!equalPathLists(sourceInfo.archive.fileEntries, provenance.archiveFiles)
        || !equalPathLists(sourceInfo.archive.unpackedEntries, provenance.unpackedFiles)) {
        throw new OperationError(ErrorCodes.SOURCE_CHANGED, '원본 ASAR 파일 목록이 작업본 provenance와 일치하지 않습니다');
    }

    const workingRoot = path.resolve(req.projectPath);
    const output = containerApplyOutputPath(req, sourceInfo.rootPath, workingRoot);
    const outputParent = path.dirname(output);
    fs.mkdirSync(outputParent, { recursive: true });
    const packStaging = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-agent-pack-'));
    const outputStagingRoot = fs.mkdtempSync(path.join(outputParent, '.tsukuru-agent-output-'));
    const outputStaging = path.join(outputStagingRoot, 'payload');
    try {
        copyArchiveWorkingFiles(workingRoot, packStaging, provenance);
        verifyProtectedWorkingFiles(workingRoot, sourceInfo.archivePath, provenance);
        const before = snapshotDirectory(packStaging);
        const engineRoot = path.join(packStaging, ...provenance.engine.root.split('/').filter(Boolean));
        const workingEngineRoot = path.join(workingRoot, ...provenance.engine.root.split('/').filter(Boolean));
        const dataDir = path.join(engineRoot, 'data');
        copyApplyArtifacts(path.join(workingEngineRoot, 'data'), dataDir);

        const context = buildContext();
        const svc = new RpgMakerService(context);
        const rep = await svc.apply({
            dir: dataDir,
            instantapply: false,
            autoline: req.options.autoline === true,
            isComment: req.options.isComment === true,
            useYaml: req.options.useYaml === true,
        });
        const completed = path.join(dataDir, 'Completed');
        overlayDirectory(path.join(completed, 'data'), dataDir);
        overlayDirectory(path.join(completed, 'js'), path.join(engineRoot, 'js'));
        for (const artifact of ['Extract', 'Backup', 'Completed', '.extracteddata']) {
            fs.rmSync(path.join(dataDir, artifact), { recursive: true, force: true });
        }
        fs.rmSync(path.join(packStaging, CONTAINER_PROVENANCE_FILE), { force: true });

        const after = snapshotDirectory(packStaging);
        const change = diffFileMaps(before, after);
        if (change.protectedScriptDamage > 0) {
            throw new OperationError(ErrorCodes.VERIFY_FAILED, 'apply 과정에서 보호 스크립트가 변경되었습니다', { change });
        }

        copyTreeWithoutLinks(sourceInfo.rootPath, outputStaging);
        const outputArchive = path.join(outputStaging, ...provenance.archiveRelativePath.split('/'));
        fs.rmSync(outputArchive, { force: true });
        await packContainer(sourceInfo, packStaging, outputArchive);
        const verified = verifyContainerOutput(outputArchive, provenance.requiredEntries);
        if (!verified.archive || verified.archive.invalidEntryCount > 0 || verified.archive.unsafeLinkCount > 0
            || verified.engine.type !== provenance.engine.type || verified.engine.root !== provenance.engine.root
            || !equalPathLists(verified.archive.fileEntries, provenance.archiveFiles)
            || !equalPathLists(verified.archive.unpackedEntries, provenance.unpackedFiles)) {
            throw new OperationError(ErrorCodes.VERIFY_FAILED, '재포장한 ASAR의 구조 검증에 실패했습니다', { verified });
        }
        const runtime = await inspectElectronRuntime(outputStaging, outputArchive, provenance.archiveRelativePath);
        if (runtime.blocked) {
            throw new OperationError(ErrorCodes.RUNTIME_INTEGRITY, runtime.blockReason ?? 'Electron 런타임 무결성 검증에 실패했습니다', runtime);
        }
        if (req.options.launchProbe === true) {
            if (!runtime.executable) {
                throw new OperationError(ErrorCodes.LAUNCH_PROBE_FAILED, '실행 프로브에 사용할 Electron 실행 파일을 찾지 못했습니다', runtime);
            }
            const executableRelative = path.relative(outputStaging, runtime.executable);
            const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-agent-launch-'));
            const probePayload = path.join(probeRoot, 'payload');
            try {
                copyTreeWithoutLinks(outputStaging, probePayload);
                runtime.launchProbe = await runLaunchProbe(
                    path.join(probePayload, executableRelative),
                    [],
                    { timeoutMs: req.options.launchTimeoutMs as number | undefined },
                );
                if (runtime.launchProbe.status === 'failed' || runtime.launchProbe.status === 'exited-error') {
                    throw new OperationError(ErrorCodes.LAUNCH_PROBE_FAILED, '재포장 게임의 실행 프로브가 실패했습니다', runtime.launchProbe);
                }
            } finally {
                fs.rmSync(probeRoot, { recursive: true, force: true });
            }
        }
        if (sha256File(sourceInfo.archivePath) !== provenance.archiveSha256) {
            throw new OperationError(ErrorCodes.SOURCE_CHANGED, '작업 도중 원본 ASAR가 변경되었습니다', { source: sourceInfo.archivePath });
        }

        if (fs.existsSync(output)) {
            if (req.options.force !== true) {
                throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 작업 도중 생성되었습니다', { outputPath: output });
            }
            fs.rmSync(output, { recursive: true, force: true });
        }
        fs.renameSync(outputStaging, output);
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
        result.artifacts = [output, finalArchive];
        result.stats = {
            files: rep.appliedFiles.length,
            entries: verified.archive.fileCount,
            elapsedMs: Math.round(rep.elapsedMs),
        };
        result.warnings = [...runtime.warnings];
        if (req.options.launchProbe !== true) {
            result.warnings.push('Electron fuse·내장 ASAR 해시·코드 서명은 정적으로 검사했지만 실행 프로브는 요청되지 않았습니다');
        }
        if (provenance.invalidEntryCount > 0) {
            result.warnings.push(`원본 ASAR의 잘못된 메타데이터 항목 ${provenance.invalidEntryCount}개는 정리된 재포장본에서 제외했습니다`);
        }
        result.ok = true;
    } finally {
        fs.rmSync(packStaging, { recursive: true, force: true });
        fs.rmSync(outputStagingRoot, { recursive: true, force: true });
    }
}

async function opApply(req: AgentRequest, detected: DetectedProject, result: AgentResult): Promise<void> {
    const provenance = readContainerProvenance(req.projectPath);
    if (provenance) {
        if (provenance.containerType === 'nwjs-package') await opApplyNwWorking(req, detected, result, provenance);
        else await opApplyAsarWorking(req, detected, result, provenance);
        return;
    }
    if (detected.container?.type === 'electron-asar') {
        throw new OperationError(ErrorCodes.NOT_IMPLEMENTED, '원본 ASAR 직접 적용은 아직 지원하지 않습니다. 먼저 별도 작업 디렉터리로 추출하세요', { format: detected.format });
    }
    const context = buildContext();
    if (detected.format === 'rpgmv' || detected.format === 'rpgmz') {
        const svc = new RpgMakerService(context);
        const rep = await svc.apply({
            dir: detected.dataDir,
            instantapply: false,
            autoline: req.options.autoline === true,
            isComment: req.options.isComment === true,
            useYaml: req.options.useYaml === true,
        });
        let completed = path.join(detected.dataDir, 'Completed');
        if (req.outputPath && path.resolve(req.outputPath) !== path.resolve(completed)) {
            if (fs.existsSync(req.outputPath)) {
                if (req.options.force === true) {
                    fs.rmSync(req.outputPath, { recursive: true, force: true });
                } else {
                    throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 이미 존재합니다', { outputPath: req.outputPath });
                }
            }
            fs.cpSync(completed, req.outputPath, { recursive: true });
            completed = req.outputPath;
        }
        result.artifacts = [completed];
        result.stats = { files: rep.appliedFiles.length, elapsedMs: Math.round(rep.elapsedMs) };
    } else if (detected.format === 'wolf') {
        // Wolf: 게임 복사본에만 적용(계획서 §CLI 계약). 기본 출력: <게임 루트>/Completed
        const targetDir = req.outputPath ?? path.join(path.dirname(detected.dataDir), 'Completed');
        if (fs.existsSync(targetDir)) {
            if (req.options.force === true) {
                fs.rmSync(targetDir, { recursive: true, force: true });
            } else {
                throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 이미 존재합니다', { targetDir });
            }
        }
        fs.cpSync(detected.dataDir, targetDir, { recursive: true, filter: (src) => !src.includes('_Extract') });
        const svc = new WolfService(context);
        const rep = await svc.applyToCopy({ dataDir: detected.dataDir, targetDir });
        result.artifacts = [targetDir];
        result.stats = { entries: rep.appliedEntries };
    } else if (detected.format === 'tyrano') {
        const projectRoot = tyranoProjectRoot(detected);
        const targetDir = req.outputPath ?? path.join(path.dirname(projectRoot), 'Completed');
        const rep = new TyranoService().applyToCopy({ projectRoot, outputRoot: targetDir, force: req.options.force === true });
        result.artifacts = [rep.outputRoot];
        result.stats = { files: rep.appliedFiles, entries: rep.appliedEntries };
        result.validation = rep.validation;
    } else if (detected.format === 'gdevelop') {
        const projectRoot = gdevelopProjectRoot(detected);
        const targetDir = req.outputPath ?? path.join(path.dirname(projectRoot), 'Completed');
        const rep = new GDevelopService().applyToCopy({ projectRoot, outputRoot: targetDir, force: req.options.force === true });
        result.artifacts = [rep.outputRoot];
        result.stats = { files: rep.appliedFiles, entries: rep.appliedEntries };
        result.validation = rep.validation;
    } else {
        throw new OperationError(ErrorCodes.NOT_IMPLEMENTED, `현재 엔진 프로파일은 진단만 지원합니다: ${detected.format}`, { format: detected.format });
    }
    result.ok = true;
}

/** patch: manifest ID·해시 검증 후 추출 작업본만 수정하고 줄 매핑을 재생성한다. */
async function opPatch(req: AgentRequest, detected: DetectedProject, result: AgentResult): Promise<void> {
    if (detected.container?.type === 'electron-asar') {
        throw new OperationError(ErrorCodes.NOT_IMPLEMENTED, '원본 ASAR 직접 패치는 아직 지원하지 않습니다. 먼저 별도 작업 디렉터리로 추출하세요', { format: detected.format });
    }
    const extractDir = extractDirOf(detected);
    if (detected.format !== 'rpgmv' && detected.format !== 'rpgmz' && detected.format !== 'wolf' && detected.format !== 'tyrano' && detected.format !== 'gdevelop') {
        throw new OperationError(ErrorCodes.NOT_IMPLEMENTED, `현재 엔진 프로파일은 진단만 지원합니다: ${detected.format}`, { format: detected.format });
    }
    const patchFormat = detected.format === 'wolf'
        ? 'wolf'
        : detected.format === 'tyrano'
            ? 'tyrano'
            : detected.format === 'gdevelop'
                ? 'gdevelop'
                : 'rpgmv';
    const patchExtractDir = detected.format === 'tyrano'
        ? path.join(tyranoProjectRoot(detected), 'data', '_Extract')
        : detected.format === 'gdevelop'
            ? path.join(gdevelopProjectRoot(detected), '_Extract')
            : extractDir;
    const outcome = applyPatches(
        patchExtractDir,
        patchFormat,
        req.patches,
    );
    result.ok = true;
    result.artifacts = [path.join(patchExtractDir, MANIFEST_FILE)];
    result.stats = { patched: outcome.patched, files: outcome.files };
}

/** Node/Electron 공용 실행기. argv는 'run' 서브커맨드부터 시작한다. */
export async function runAgent(argv: string[]): Promise<number> {
    const result = emptyResult();
    try {
        const req = validateRequest(loadRequest(parseArgs(argv)));
        const detected = resolveProject(req);
        result.format = detected.format;
        attachDiagnostics(detected, result);
        switch (req.operation) {
            case 'verify':
                await opVerify(req, detected, result);
                break;
            case 'extract':
                await opExtract(req, detected, result);
                break;
            case 'apply':
                await opApply(req, detected, result);
                break;
            case 'patch':
                await opPatch(req, detected, result);
                break;
        }
    } catch (err) {
        const opErr = toOperationError(err);
        result.ok = false;
        result.error = opErr.toJSON();
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
}

function containerOutputPath(req: AgentRequest, sourceRoot: string): string {
    const source = path.resolve(sourceRoot);
    const output = path.resolve(req.outputPath ?? path.join(path.dirname(source), path.basename(source) + '_tsukuru'));
    if (pathsOverlap(source, output)) {
        throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '컨테이너 출력은 원본 경로 바깥이어야 합니다', { outputPath: output });
    }
    if (fs.existsSync(output)) {
        if (req.options.force === true) fs.rmSync(output, { recursive: true, force: true });
        else throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 이미 존재합니다', { outputPath: output });
    }
    return output;
}

async function opExtractAsar(req: AgentRequest, detected: DetectedProject, result: AgentResult): Promise<void> {
    if (!detected.container || (detected.format !== 'rpgmv' && detected.format !== 'rpgmz')) {
        throw new OperationError(ErrorCodes.NOT_IMPLEMENTED, '현재 ASAR 엔진 프로파일은 진단만 지원합니다', { format: detected.format });
    }
    const output = containerOutputPath(req, detected.container.rootPath);
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-agent-asar-'));
    let completed = false;
    try {
        await extractContainer(detected.container, staging);
        const provenance = createContainerProvenance(detected.container, staging);
        const dataDir = path.join(staging, detected.container.engine.root, 'data');
        if (!fs.existsSync(dataDir)) throw new OperationError(ErrorCodes.FORMAT_UNKNOWN, 'ASAR 안에서 MZ data 폴더를 찾지 못했습니다', { dataDir });
        const context = buildContext();
        const svc = new RpgMakerService(context);
        const rep = await svc.extract(rpgExtractOptions(req, dataDir));
        fs.cpSync(staging, output, { recursive: true });
        copyExternalResources(detected.container, output);
        const provenancePath = writeContainerProvenance(output, provenance);
        result.artifacts = [output, path.join(output, detected.container.engine.root, 'data', 'Extract'), path.join(output, detected.container.engine.root, 'data', '.extracteddata'), provenancePath];
        result.stats = { files: rep.extractedFiles.length, entries: rep.manifestEntries ?? 0, textBytes: rep.textBytes, elapsedMs: Math.round(rep.elapsedMs) };
        result.ok = true;
        completed = true;
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
        if (!completed && fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
    }
}

async function opExtractNw(req: AgentRequest, detected: DetectedProject, result: AgentResult): Promise<void> {
    if (!detected.container || detected.container.type !== 'nwjs-package' || detected.format !== 'gdevelop') {
        throw new OperationError(ErrorCodes.NOT_IMPLEMENTED, '현재 package.nw 엔진 프로파일은 GDevelop만 추출할 수 있습니다', { format: detected.format });
    }
    const output = containerOutputPath(req, detected.container.rootPath);
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-agent-nw-'));
    let completed = false;
    try {
        await extractContainer(detected.container, staging);
        const provenance = createContainerProvenance(detected.container, staging);
        const engineRoot = path.join(staging, ...detected.container.engine.root.split('/').filter(Boolean));
        const rep = new GDevelopService().extract({ projectRoot: engineRoot, force: req.options.force === true });
        fs.cpSync(staging, output, { recursive: true });
        const provenancePath = writeContainerProvenance(output, provenance);
        const outputEngineRoot = path.join(output, ...detected.container.engine.root.split('/').filter(Boolean));
        result.artifacts = [output, path.join(outputEngineRoot, '_Extract'), provenancePath];
        result.stats = { files: rep.extractedFiles, entries: rep.extractedEntries };
        result.ok = true;
        completed = true;
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
        if (!completed && fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
    }
}
