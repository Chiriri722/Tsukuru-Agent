#!/usr/bin/env node
/**
 * tsukuru-agent CLI 진입점 (계획서 §CLI 계약).
 *   tsukuru-agent run --request -
 *   tsukuru-agent run --request request.json
 * stdout은 최종 결과 JSON 전용이며, 모든 로그·진행률은 stderr로 본낸다.
 */
import fs from 'fs';
import path from 'path';
import { validateRequest, AgentRequest, AgentResult, emptyResult } from '../core/schema';
import { OperationError, ErrorCodes, toOperationError } from '../core/types';
import { createOperationContext, createRpgState, createWolfState, OperationContext } from '../core/context';
import { StderrLogger, StderrProgressSink } from '../core/sinks';
import { detectFormat, DetectedProject } from './formatDetect';
import { applyPatches } from './patcher';
import { RpgMakerService, RpgExtractOptions } from '../js/rpgmv/RpgMakerService';
import { WolfService } from '../js/wolf/WolfService';
import * as dataBaseO from '../js/rpgmv/datas.js';
import { MANIFEST_FILE } from '../core/manifest';

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
    const detected = detectFormat(req.projectPath);
    if (!detected) {
        throw new OperationError(ErrorCodes.FORMAT_UNKNOWN, '프로젝트 포맷을 판별할 수 없습니다(data 폼더의 .json/.mps 또는 Data.wolf를 찾지 못했습니다)', { projectPath: req.projectPath });
    }
    if (req.format !== 'auto' && req.format !== detected.format) {
        throw new OperationError(ErrorCodes.FORMAT_MISMATCH, `요청 포맷(${req.format})과 실제 포맷(${detected.format})이 다릅니다`, { detected });
    }
    return detected;
}

function extractDirOf(detected: DetectedProject): string {
    return detected.format === 'rpgmv' ? path.join(detected.dataDir, 'Extract') : path.join(detected.dataDir, '_Extract');
}

/** verify: 읽기 전용으로 포맷·경로·manifest·매핑·출력 조건을 검사한다. */
async function opVerify(req: AgentRequest, detected: DetectedProject, result: AgentResult): Promise<void> {
    const issues: string[] = [];
    const extractDir = extractDirOf(detected);
    let entries = 0;
    if (!fs.existsSync(extractDir)) {
        issues.push(`추출 산출물 디렉터리가 없습니다: ${extractDir}`);
    } else {
        const manifestPath = path.join(extractDir, MANIFEST_FILE);
        if (!fs.existsSync(manifestPath)) {
            issues.push('manifest.json이 없습니다(구버전 추출 산출물이면 patch를 사용할 수 없습니다)');
        } else {
            try {
                const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (m.schemaVersion !== 1) {
                    issues.push(`지원하지 않는 manifest schemaVersion입니다: ${String(m.schemaVersion)}`);
                }
                if (m.format !== detected.format) {
                    issues.push(`manifest 포맷(${m.format})과 실제 포맷(${detected.format})이 다릅니다`);
                }
                entries = Array.isArray(m.entries) ? m.entries.length : 0;
                const textFiles = new Set<string>((m.entries ?? []).map((e: any) => e.extractFile));
                for (const t of textFiles) {
                    if (!fs.existsSync(path.join(extractDir, t))) {
                        issues.push(`추출 텍스트 파일이 없습니다: ${t}`);
                    }
                }
            } catch {
                throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, 'manifest.json 파싱에 실패했습니다', { manifestPath });
            }
        }
        // .extracteddata location differs by format (MV: data dir / Wolf: inside _Extract)
        const edPath = detected.format === 'rpgmv' ? path.join(detected.dataDir, '.extracteddata') : path.join(extractDir, '.extracteddata');
        if (!fs.existsSync(edPath)) {
            issues.push('.extracteddata 파일이 없습니다(apply에 필요합니다)');
        }
    }
    result.ok = issues.length === 0;
    result.warnings = issues;
    result.stats = { entries };
    if (!result.ok) {
        result.error = { code: ErrorCodes.VERIFY_FAILED, message: `검증 실패: ${issues.length}건`, details: issues };
    }
}

async function opExtract(req: AgentRequest, detected: DetectedProject, result: AgentResult): Promise<void> {
    const context = buildContext();
    if (detected.format === 'rpgmv') {
        const svc = new RpgMakerService(context);
        const rep = await svc.extract(rpgExtractOptions(req, detected.dataDir));
        result.artifacts = [path.join(detected.dataDir, 'Extract'), path.join(detected.dataDir, 'Backup'), path.join(detected.dataDir, '.extracteddata'), rep.manifestPath ?? ''].filter((a) => a !== '');
        result.stats = { files: rep.extractedFiles.length, entries: rep.manifestEntries ?? 0, textBytes: rep.textBytes, elapsedMs: Math.round(rep.elapsedMs) };
    } else {
        const svc = new WolfService(context);
        const rep = await svc.extract({ folder: detected.dataDir, config: wolfConfig(req) });
        result.artifacts = [rep.extractDir ?? '', rep.manifestPath ?? ''].filter((a) => a !== '');
        result.stats = { entries: rep.extractedEntries };
    }
    result.ok = true;
}

async function opApply(req: AgentRequest, detected: DetectedProject, result: AgentResult): Promise<void> {
    const context = buildContext();
    if (detected.format === 'rpgmv') {
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
    } else {
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
    }
    result.ok = true;
}

/** patch: manifest ID·해시 검증 후 추출 작업본만 수정하고 줄 매핑을 재생성한다. */
async function opPatch(req: AgentRequest, detected: DetectedProject, result: AgentResult): Promise<void> {
    const extractDir = extractDirOf(detected);
    const outcome = applyPatches(extractDir, detected.format, req.patches);
    result.ok = true;
    result.artifacts = [path.join(extractDir, MANIFEST_FILE)];
    result.stats = { patched: outcome.patched, files: outcome.files };
}

/** Node/Electron 공용 실행기. argv는 'run' 서브커맨드부터 시작한다. */
export async function runAgent(argv: string[]): Promise<number> {
    const result = emptyResult();
    try {
        const req = validateRequest(loadRequest(parseArgs(argv)));
        const detected = resolveProject(req);
        result.format = detected.format;
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
