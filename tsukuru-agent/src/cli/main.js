#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tsukuru-agent CLI 진입점 (계획서 §CLI 계약).
 *   tsukuru-agent run --request -
 *   tsukuru-agent run --request request.json
 * stdout은 최종 결과 JSON 전용이며, 모든 로그·진행률은 stderr로 본낸다.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const schema_1 = require("../core/schema");
const types_1 = require("../core/types");
const context_1 = require("../core/context");
const sinks_1 = require("../core/sinks");
const formatDetect_1 = require("./formatDetect");
const patcher_1 = require("./patcher");
const RpgMakerService_1 = require("../js/rpgmv/RpgMakerService");
const WolfService_1 = require("../js/wolf/WolfService");
const dataBaseO = __importStar(require("../js/rpgmv/datas.js"));
const manifest_1 = require("../core/manifest");
// stdout 계약 보호: 레거시 console 출력을 모두 stderr로 리다이렉트한다.
console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;
function usage() {
    return '사용법: tsukuru-agent run --request <request.json|->';
}
function parseArgs(argv) {
    const [cmd, ...rest] = argv;
    if (cmd !== 'run') {
        throw new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, `지원하지 않는 명령입니다: ${cmd !== null && cmd !== void 0 ? cmd : '(없음)'}. ${usage()}`);
    }
    const idx = rest.indexOf('--request');
    if (idx < 0 || idx + 1 >= rest.length) {
        throw new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, `--request <file|-> 인수가 필요합니다. ${usage()}`);
    }
    return rest[idx + 1];
}
function loadRequest(source) {
    let raw;
    try {
        raw = source === '-' ? fs_1.default.readFileSync(0, 'utf8') : fs_1.default.readFileSync(source, 'utf8');
    }
    catch (err) {
        throw new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, `요청을 읽을 수 없습니다: ${source}`, { cause: String(err) });
    }
    try {
        return JSON.parse(raw);
    }
    catch (err) {
        throw new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, '요청 JSON 파싱에 실패했습니다', { cause: String(err) });
    }
}
function buildContext() {
    return (0, context_1.createOperationContext)(new sinks_1.StderrProgressSink(), new sinks_1.StderrLogger(), {
        rpg: (0, context_1.createRpgState)({ ...dataBaseO.settings }),
        wolf: (0, context_1.createWolfState)(),
    });
}
/** CLI가 포맷을 미리 판별하므로 서비스의 폼더명 검사는 force로 우회한다. */
function rpgExtractOptions(req, dataDir) {
    const o = req.options;
    const force = o.force === true;
    if (req.profile === 'full') {
        return { dir: dataDir, force, ext_note: true, ext_src: true, ext_javascript: true, ext_plugin: true, exJson: true };
    }
    if (req.profile === 'advanced') {
        return { ...o, dir: dataDir, force };
    }
    // standard: 기존 GUI 기본 추출 수준(renderer.ts 기본값은 모든 확장 플래그 off)
    return { dir: dataDir, force };
}
function wolfConfig(req) {
    const o = req.options;
    if (req.profile === 'advanced') {
        return { force: true, ...o };
    }
    if (req.profile === 'full') {
        return { force: true, extBuran: true, extAll: true };
    }
    return { force: true };
}
function resolveProject(req) {
    if (!fs_1.default.existsSync(req.projectPath)) {
        throw new types_1.OperationError(types_1.ErrorCodes.PATH_NOT_FOUND, '프로젝트 경로가 존재하지 않습니다', { projectPath: req.projectPath });
    }
    const detected = (0, formatDetect_1.detectFormat)(req.projectPath);
    if (!detected) {
        throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_UNKNOWN, '프로젝트 포맷을 판별할 수 없습니다(data 폼더의 .json/.mps 또는 Data.wolf를 찾지 못했습니다)', { projectPath: req.projectPath });
    }
    if (req.format !== 'auto' && req.format !== detected.format) {
        throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_MISMATCH, `요청 포맷(${req.format})과 실제 포맷(${detected.format})이 다릅니다`, { detected });
    }
    return detected;
}
function extractDirOf(detected) {
    return detected.format === 'rpgmv' ? path_1.default.join(detected.dataDir, 'Extract') : path_1.default.join(detected.dataDir, '_Extract');
}
/** verify: 읽기 전용으로 포맷·경로·manifest·매핑·출력 조건을 검사한다. */
async function opVerify(req, detected, result) {
    var _a;
    const issues = [];
    const extractDir = extractDirOf(detected);
    let entries = 0;
    if (!fs_1.default.existsSync(extractDir)) {
        issues.push(`추출 산출물 디렉터리가 없습니다: ${extractDir}`);
    }
    else {
        const manifestPath = path_1.default.join(extractDir, manifest_1.MANIFEST_FILE);
        if (!fs_1.default.existsSync(manifestPath)) {
            issues.push('manifest.json이 없습니다(구버전 추출 산출물이면 patch를 사용할 수 없습니다)');
        }
        else {
            try {
                const m = JSON.parse(fs_1.default.readFileSync(manifestPath, 'utf8'));
                if (m.schemaVersion !== 1) {
                    issues.push(`지원하지 않는 manifest schemaVersion입니다: ${String(m.schemaVersion)}`);
                }
                if (m.format !== detected.format) {
                    issues.push(`manifest 포맷(${m.format})과 실제 포맷(${detected.format})이 다릅니다`);
                }
                entries = Array.isArray(m.entries) ? m.entries.length : 0;
                const textFiles = new Set(((_a = m.entries) !== null && _a !== void 0 ? _a : []).map((e) => e.extractFile));
                for (const t of textFiles) {
                    if (!fs_1.default.existsSync(path_1.default.join(extractDir, t))) {
                        issues.push(`추출 텍스트 파일이 없습니다: ${t}`);
                    }
                }
            }
            catch (_b) {
                throw new types_1.OperationError(types_1.ErrorCodes.MANIFEST_CORRUPT, 'manifest.json 파싱에 실패했습니다', { manifestPath });
            }
        }
        // .extracteddata location differs by format (MV: data dir / Wolf: inside _Extract)
        const edPath = detected.format === 'rpgmv' ? path_1.default.join(detected.dataDir, '.extracteddata') : path_1.default.join(extractDir, '.extracteddata');
        if (!fs_1.default.existsSync(edPath)) {
            issues.push('.extracteddata 파일이 없습니다(apply에 필요합니다)');
        }
    }
    result.ok = issues.length === 0;
    result.warnings = issues;
    result.stats = { entries };
    if (!result.ok) {
        result.error = { code: types_1.ErrorCodes.VERIFY_FAILED, message: `검증 실패: ${issues.length}건`, details: issues };
    }
}
async function opExtract(req, detected, result) {
    var _a, _b, _c, _d;
    const context = buildContext();
    if (detected.format === 'rpgmv') {
        const svc = new RpgMakerService_1.RpgMakerService(context);
        const rep = await svc.extract(rpgExtractOptions(req, detected.dataDir));
        result.artifacts = [path_1.default.join(detected.dataDir, 'Extract'), path_1.default.join(detected.dataDir, 'Backup'), path_1.default.join(detected.dataDir, '.extracteddata'), (_a = rep.manifestPath) !== null && _a !== void 0 ? _a : ''].filter((a) => a !== '');
        result.stats = { files: rep.extractedFiles.length, entries: (_b = rep.manifestEntries) !== null && _b !== void 0 ? _b : 0, textBytes: rep.textBytes, elapsedMs: Math.round(rep.elapsedMs) };
    }
    else {
        const svc = new WolfService_1.WolfService(context);
        const rep = await svc.extract({ folder: detected.dataDir, config: wolfConfig(req) });
        result.artifacts = [(_c = rep.extractDir) !== null && _c !== void 0 ? _c : '', (_d = rep.manifestPath) !== null && _d !== void 0 ? _d : ''].filter((a) => a !== '');
        result.stats = { entries: rep.extractedEntries };
    }
    result.ok = true;
}
async function opApply(req, detected, result) {
    var _a;
    const context = buildContext();
    if (detected.format === 'rpgmv') {
        const svc = new RpgMakerService_1.RpgMakerService(context);
        const rep = await svc.apply({
            dir: detected.dataDir,
            instantapply: false,
            autoline: req.options.autoline === true,
            isComment: req.options.isComment === true,
            useYaml: req.options.useYaml === true,
        });
        let completed = path_1.default.join(detected.dataDir, 'Completed');
        if (req.outputPath && path_1.default.resolve(req.outputPath) !== path_1.default.resolve(completed)) {
            if (fs_1.default.existsSync(req.outputPath)) {
                if (req.options.force === true) {
                    fs_1.default.rmSync(req.outputPath, { recursive: true, force: true });
                }
                else {
                    throw new types_1.OperationError(types_1.ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 이미 존재합니다', { outputPath: req.outputPath });
                }
            }
            fs_1.default.cpSync(completed, req.outputPath, { recursive: true });
            completed = req.outputPath;
        }
        result.artifacts = [completed];
        result.stats = { files: rep.appliedFiles.length, elapsedMs: Math.round(rep.elapsedMs) };
    }
    else {
        // Wolf: 게임 복사본에만 적용(계획서 §CLI 계약). 기본 출력: <게임 루트>/Completed
        const targetDir = (_a = req.outputPath) !== null && _a !== void 0 ? _a : path_1.default.join(path_1.default.dirname(detected.dataDir), 'Completed');
        if (fs_1.default.existsSync(targetDir)) {
            if (req.options.force === true) {
                fs_1.default.rmSync(targetDir, { recursive: true, force: true });
            }
            else {
                throw new types_1.OperationError(types_1.ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 이미 존재합니다', { targetDir });
            }
        }
        fs_1.default.cpSync(detected.dataDir, targetDir, { recursive: true, filter: (src) => !src.includes('_Extract') });
        const svc = new WolfService_1.WolfService(context);
        const rep = await svc.applyToCopy({ dataDir: detected.dataDir, targetDir });
        result.artifacts = [targetDir];
        result.stats = { entries: rep.appliedEntries };
    }
    result.ok = true;
}
/** patch: manifest ID·해시 검증 후 추출 작업본만 수정하고 줄 매핑을 재생성한다. */
async function opPatch(req, detected, result) {
    const extractDir = extractDirOf(detected);
    const outcome = (0, patcher_1.applyPatches)(extractDir, detected.format, req.patches);
    result.ok = true;
    result.artifacts = [path_1.default.join(extractDir, manifest_1.MANIFEST_FILE)];
    result.stats = { patched: outcome.patched, files: outcome.files };
}
async function main() {
    const result = (0, schema_1.emptyResult)();
    try {
        const req = (0, schema_1.validateRequest)(loadRequest(parseArgs(process.argv.slice(2))));
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
    }
    catch (err) {
        const opErr = (0, types_1.toOperationError)(err);
        result.ok = false;
        result.error = opErr.toJSON();
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
}
main().then((code) => {
    process.exitCode = code;
});
