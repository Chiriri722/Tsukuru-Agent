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
exports.runAgent = runAgent;
/**
 * tsukuru-agent CLI 진입점 (계획서 §CLI 계약).
 *   tsukuru-agent run --request -
 *   tsukuru-agent run --request request.json
 * stdout은 최종 결과 JSON 전용이며, 모든 로그·진행률은 stderr로 본낸다.
 */
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const asar = __importStar(require("@electron/asar"));
const schema_1 = require("../core/schema");
const types_1 = require("../core/types");
const context_1 = require("../core/context");
const sinks_1 = require("../core/sinks");
const formatDetect_1 = require("./formatDetect");
const patcher_1 = require("./patcher");
const RpgMakerService_1 = require("../js/rpgmv/RpgMakerService");
const WolfService_1 = require("../js/wolf/WolfService");
const TyranoService_1 = require("../js/tyrano/TyranoService");
const GDevelopService_1 = require("../js/gdevelop/GDevelopService");
const dataBaseO = __importStar(require("../js/rpgmv/datas.js"));
const manifest_1 = require("../core/manifest");
const validator_1 = require("../core/validator");
const container_1 = require("../core/container");
const runtimeDiagnostics_1 = require("../core/runtimeDiagnostics");
const containerProvenance_1 = require("../core/containerProvenance");
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
    var _a;
    if (!fs_1.default.existsSync(req.projectPath)) {
        throw new types_1.OperationError(types_1.ErrorCodes.PATH_NOT_FOUND, '프로젝트 경로가 존재하지 않습니다', { projectPath: req.projectPath });
    }
    const detected = (0, formatDetect_1.detectProject)(req.projectPath);
    if (!detected) {
        throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_UNKNOWN, '프로젝트 포맷을 판별할 수 없습니다(data 폼더의 .json/.mps 또는 Data.wolf를 찾지 못했습니다)', { projectPath: req.projectPath });
    }
    const compatible = req.format === 'auto'
        || req.format === detected.format
        || (req.format === 'rpgmv' && detected.format === 'rpgmz')
        || (req.format === 'rpgmz-electron' && detected.format === 'rpgmz')
        || (req.format === 'gdevelop-electron' && detected.format === 'gdevelop')
        || (req.format === 'nwjs-webgame' && ((_a = detected.container) === null || _a === void 0 ? void 0 : _a.type) === 'nwjs-package');
    if (!compatible) {
        throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_MISMATCH, `요청 포맷(${req.format})과 실제 포맷(${detected.format})이 다릅니다`, { detected });
    }
    return detected;
}
function attachDiagnostics(detected, result) {
    var _a, _b, _c;
    const container = detected.container;
    if (!container) {
        return;
    }
    result.container = {
        type: container.type,
        path: container.archivePath
            ? path_1.default.relative(container.rootPath, container.archivePath).replace(/\\/g, '/')
            : null,
        root: container.engine.root,
        confidence: container.engine.confidence,
        integrity: (_a = container.archive) === null || _a === void 0 ? void 0 : _a.integrity,
        invalidEntryCount: (_c = (_b = container.archive) === null || _b === void 0 ? void 0 : _b.invalidEntryCount) !== null && _c !== void 0 ? _c : 0,
    };
    result.engine = {
        type: container.engine.type,
        wrapper: container.engine.wrapper,
        features: container.engine.features,
        confidence: container.engine.confidence,
    };
}
function publicScores(scores) {
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
function extractDirOf(detected) {
    if (detected.format === 'gdevelop')
        return path_1.default.join(gdevelopProjectRoot(detected), '_Extract');
    return detected.format === 'rpgmv' || detected.format === 'rpgmz'
        ? path_1.default.join(detected.dataDir, 'Extract')
        : path_1.default.join(detected.dataDir, '_Extract');
}
function gdevelopProjectRoot(detected) {
    var _a, _b, _c, _d;
    const containerRoot = (_b = (_a = detected.container) === null || _a === void 0 ? void 0 : _a.rootPath) !== null && _b !== void 0 ? _b : path_1.default.dirname(detected.dataDir);
    const engineRoot = (_d = (_c = detected.container) === null || _c === void 0 ? void 0 : _c.engine.root) !== null && _d !== void 0 ? _d : '';
    const candidate = path_1.default.join(containerRoot, ...engineRoot.split('/').filter(Boolean));
    if (fs_1.default.existsSync(path_1.default.join(candidate, 'data.js')) || fs_1.default.existsSync(path_1.default.join(candidate, 'www', 'data.js')))
        return candidate;
    return containerRoot;
}
function tyranoProjectRoot(detected) {
    var _a, _b, _c, _d;
    const containerRoot = (_b = (_a = detected.container) === null || _a === void 0 ? void 0 : _a.rootPath) !== null && _b !== void 0 ? _b : path_1.default.dirname(detected.dataDir);
    const engineRoot = (_d = (_c = detected.container) === null || _c === void 0 ? void 0 : _c.engine.root) !== null && _d !== void 0 ? _d : '';
    const candidate = path_1.default.join(containerRoot, engineRoot);
    if (path_1.default.basename(candidate).toLowerCase() === 'data' && fs_1.default.existsSync(path_1.default.join(candidate, 'scenario'))) {
        return path_1.default.dirname(candidate);
    }
    if (fs_1.default.existsSync(path_1.default.join(candidate, 'data', 'scenario')))
        return candidate;
    if (path_1.default.basename(detected.dataDir).toLowerCase() === 'data' && fs_1.default.existsSync(path_1.default.join(detected.dataDir, 'scenario'))) {
        return path_1.default.dirname(detected.dataDir);
    }
    return containerRoot;
}
function structuralIssueMessage(issue) {
    var _a;
    const position = issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : '';
    return `[${issue.code}] ${(_a = issue.file) !== null && _a !== void 0 ? _a : '(project)'}${position}: ${issue.message}`;
}
function writeStructuralSummary(result) {
    const validation = result.validation;
    if (!validation)
        return;
    process.stderr.write(`[Tsukuru Agent] validation=${validation.profile} files=${validation.filesChecked} entries=${validation.entriesChecked} invalid=${validation.invalidEntries} token-errors=${validation.tokenErrors} encoding-warnings=${validation.encodingWarnings}\n`);
}
/** verify: 읽기 전용으로 포맷·경로·manifest·매핑·출력 조건을 검사한다. */
async function opVerify(req, detected, result) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8;
    const issues = [];
    const extractDir = extractDirOf(detected);
    let entries = 0;
    let change = { filesChanged: 0, bytesChanged: 0, textBytesChanged: 0, protectedFilesChanged: 0, protectedScriptDamage: 0 };
    let comparisonPerformed = false;
    if (((_a = detected.container) === null || _a === void 0 ? void 0 : _a.type) === 'electron-asar') {
        const archive = detected.container.archive;
        const runtime = detected.container.archivePath
            ? await (0, runtimeDiagnostics_1.inspectElectronRuntime)(detected.container.rootPath, detected.container.archivePath, path_1.default.relative(detected.container.rootPath, detected.container.archivePath))
            : undefined;
        result.runtime = runtime;
        let containerIntegrity = archive && archive.fileCount > 0 && archive.integrity !== 'unreadable'
            ? (archive.invalidEntryCount > 0 ? 70 : 100)
            : 50;
        if (runtime === null || runtime === void 0 ? void 0 : runtime.blocked)
            containerIntegrity = 0;
        else if (((_b = runtime === null || runtime === void 0 ? void 0 : runtime.signature) === null || _b === void 0 ? void 0 : _b.status) === 'hash-mismatch')
            containerIntegrity = Math.min(containerIntegrity, 40);
        const critical = detected.container.engine.type === 'unknown' ? ['engine-unknown'] : [];
        if (runtime === null || runtime === void 0 ? void 0 : runtime.blocked)
            critical.push('electron-asar-integrity-mismatch');
        if (((_c = runtime === null || runtime === void 0 ? void 0 : runtime.signature) === null || _c === void 0 ? void 0 : _c.status) === 'hash-mismatch')
            critical.push('authenticode-hash-mismatch');
        const scores = (0, validator_1.scoreVerification)({
            extractionCoverage: 0,
            mappingIntegrity: 0,
            reinsertionValidity: 0,
            protectedScriptIntegrity: 50,
            containerIntegrity,
            critical,
        });
        result.scores = publicScores(scores);
        result.change = { filesChanged: 0, bytesChanged: 0, textBytesChanged: 0, protectedFilesChanged: 0, protectedScriptDamage: 0 };
        result.stats = { entries: (_d = archive === null || archive === void 0 ? void 0 : archive.fileCount) !== null && _d !== void 0 ? _d : 0, score: scores.total };
        result.warnings = ['ASAR 컨테이너는 식별되었지만 추출 산출물은 아직 없습니다', ...((_e = runtime === null || runtime === void 0 ? void 0 : runtime.warnings) !== null && _e !== void 0 ? _e : [])];
        result.ok = false;
        result.error = { code: types_1.ErrorCodes.VERIFY_FAILED, message: '검증 실패: ASAR 추출 산출물이 없습니다', details: result.warnings };
        if (req.options.humanSummary === true && result.scores && result.engine) {
            process.stderr.write(`[Tsukuru Agent] container=${(_g = (_f = result.container) === null || _f === void 0 ? void 0 : _f.type) !== null && _g !== void 0 ? _g : 'unknown'} engine=${result.engine.type} wrapper=${(_h = result.engine.wrapper) !== null && _h !== void 0 ? _h : 'none'}\n`);
            process.stderr.write(`[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}\n`);
            process.stderr.write(`[Tsukuru Agent] extraction=${result.scores.extractionCoverage}% reinsert=${result.scores.reinsertionValidity}% protected-script-damage=unassessed\n`);
            process.stderr.write(`[Tsukuru Agent] runtime-risk=${(_j = runtime === null || runtime === void 0 ? void 0 : runtime.risk) !== null && _j !== void 0 ? _j : 'unassessed'} fuse=${(_l = (_k = runtime === null || runtime === void 0 ? void 0 : runtime.fuses) === null || _k === void 0 ? void 0 : _k.embeddedAsarIntegrityValidation) !== null && _l !== void 0 ? _l : 'unknown'} asar-integrity=${(_o = (_m = runtime === null || runtime === void 0 ? void 0 : runtime.asarIntegrity) === null || _m === void 0 ? void 0 : _m.status) !== null && _o !== void 0 ? _o : 'unassessed'} signature=${(_q = (_p = runtime === null || runtime === void 0 ? void 0 : runtime.signature) === null || _p === void 0 ? void 0 : _p.status) !== null && _q !== void 0 ? _q : 'unassessed'}\n`);
        }
        return;
    }
    if (detected.format === 'tyrano') {
        const projectRoot = tyranoProjectRoot(detected);
        const extractManifest = path_1.default.join(projectRoot, 'data', '_Extract', manifest_1.MANIFEST_FILE);
        if (fs_1.default.existsSync(extractManifest)) {
            let validation;
            try {
                validation = new TyranoService_1.TyranoService().verifyWorkspace(projectRoot);
            }
            catch (error) {
                const operationError = (0, types_1.toOperationError)(error);
                validation = (0, validator_1.inspectTyranoProject)(projectRoot);
                let manifestEntries = 0;
                try {
                    const parsedManifest = JSON.parse(fs_1.default.readFileSync(extractManifest, 'utf8'));
                    manifestEntries = Array.isArray(parsedManifest.entries) ? parsedManifest.entries.length : 0;
                }
                catch ( /* 아래 issue가 manifest 실패를 대표한다. */_9) { /* 아래 issue가 manifest 실패를 대표한다. */ }
                const details = operationError.details && typeof operationError.details === 'object'
                    ? operationError.details
                    : {};
                const issueCode = operationError.code === types_1.ErrorCodes.SOURCE_CHANGED
                    ? 'TYRANO_SOURCE_CHANGED'
                    : operationError.code === types_1.ErrorCodes.PATCH_HASH_MISMATCH
                        ? 'TYRANO_EXTRACT_HASH_MISMATCH'
                        : operationError.code === types_1.ErrorCodes.ENCODING_UNREPRESENTABLE
                            ? 'TYRANO_ENCODING_UNREPRESENTABLE'
                            : operationError.code === types_1.ErrorCodes.MAPPING_CORRUPT
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
            const scores = (0, validator_1.scoreVerification)({
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
            if (!result.ok)
                result.error = { code: types_1.ErrorCodes.VERIFY_FAILED, message: '검증 실패: Tyrano 작업본을 안전하게 재삽입할 수 없습니다', details: result.warnings };
            if (req.options.humanSummary === true && result.scores && result.engine) {
                process.stderr.write(`[Tsukuru Agent] container=${(_s = (_r = result.container) === null || _r === void 0 ? void 0 : _r.type) !== null && _s !== void 0 ? _s : 'unknown'} engine=${result.engine.type} wrapper=${(_t = result.engine.wrapper) !== null && _t !== void 0 ? _t : 'none'}\n`);
                process.stderr.write(`[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}\n`);
                process.stderr.write(`[Tsukuru Agent] extraction=100% reinsert=${result.scores.reinsertionValidity}% protected-script-integrity=${result.scores.protectedScriptIntegrity}%\n`);
                writeStructuralSummary(result);
            }
            return;
        }
        const validation = (0, validator_1.inspectTyranoProject)(projectRoot);
        result.validation = validation;
        const mappingIntegrity = validation.entriesChecked > 0
            ? Math.round(validation.validEntries / validation.entriesChecked * 100)
            : 0;
        const structuralIssues = validation.issues.map(structuralIssueMessage);
        const warnings = [
            'Tyrano 원본 구조 검사는 완료했지만 data/_Extract 작업본이 없습니다. 먼저 extract를 실행하세요',
            ...structuralIssues,
        ];
        const scores = (0, validator_1.scoreVerification)({
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
            code: types_1.ErrorCodes.VERIFY_FAILED,
            message: validation.ok
                ? '검증 제한: Tyrano 추출 작업본이 없습니다'
                : `검증 실패: Tyrano 구조 오류 ${validation.tokenErrors}건`,
            details: warnings,
        };
        if (req.options.humanSummary === true && result.scores && result.engine) {
            process.stderr.write(`[Tsukuru Agent] container=${(_v = (_u = result.container) === null || _u === void 0 ? void 0 : _u.type) !== null && _v !== void 0 ? _v : 'unknown'} engine=${result.engine.type} wrapper=${(_w = result.engine.wrapper) !== null && _w !== void 0 ? _w : 'none'}\n`);
            process.stderr.write(`[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}\n`);
            process.stderr.write(`[Tsukuru Agent] extraction=0% reinsert=0% protected-script-integrity=${result.scores.protectedScriptIntegrity}%\n`);
            writeStructuralSummary(result);
        }
        return;
    }
    if (detected.format === 'gdevelop') {
        const projectRoot = gdevelopProjectRoot(detected);
        const extractManifest = path_1.default.join(projectRoot, '_Extract', manifest_1.MANIFEST_FILE);
        let validation;
        if (!fs_1.default.existsSync(extractManifest)) {
            validation = {
                profile: 'gdevelop', ok: false, filesChecked: fs_1.default.existsSync(path_1.default.join(projectRoot, 'data.js')) ? 1 : 0,
                entriesChecked: 0, validEntries: 0, invalidEntries: 0,
                encodingCounts: { utf8: 0, shiftJis: 0, unknown: 0 }, encodingWarnings: 0, tokenErrors: 1,
                issues: [{
                        code: 'GDEVELOP_MANIFEST_MISSING', severity: 'critical', file: null,
                        message: 'GDevelop _Extract 작업본이 없습니다. 먼저 extract를 실행하세요',
                    }],
            };
        }
        else {
            try {
                validation = new GDevelopService_1.GDevelopService().verifyWorkspace(projectRoot);
            }
            catch (error) {
                const operationError = (0, types_1.toOperationError)(error);
                let manifestEntries = 0;
                try {
                    const parsedManifest = JSON.parse(fs_1.default.readFileSync(extractManifest, 'utf8'));
                    manifestEntries = Array.isArray(parsedManifest.entries) ? parsedManifest.entries.length : 0;
                }
                catch ( /* 아래 issue가 manifest 실패를 대표한다. */_10) { /* 아래 issue가 manifest 실패를 대표한다. */ }
                validation = {
                    profile: 'gdevelop', ok: false, filesChecked: 1,
                    entriesChecked: manifestEntries, validEntries: Math.max(0, manifestEntries - 1),
                    invalidEntries: manifestEntries > 0 ? 1 : 0,
                    encodingCounts: { utf8: 1, shiftJis: 0, unknown: 0 }, encodingWarnings: 0, tokenErrors: 1,
                    issues: [{
                            code: operationError.code === types_1.ErrorCodes.SOURCE_CHANGED
                                ? 'GDEVELOP_SOURCE_CHANGED'
                                : operationError.code === types_1.ErrorCodes.PATCH_HASH_MISMATCH
                                    ? 'GDEVELOP_EXTRACT_HASH_MISMATCH'
                                    : 'GDEVELOP_REINSERTION_FAILED',
                            severity: 'critical', file: null, message: operationError.message,
                        }],
                };
            }
        }
        result.validation = validation;
        const scores = (0, validator_1.scoreVerification)({
            extractionCoverage: validation.entriesChecked > 0 ? 100 : 0,
            mappingIntegrity: validation.entriesChecked > 0
                ? Math.round(validation.validEntries / validation.entriesChecked * 100)
                : 0,
            reinsertionValidity: validation.ok ? 100 : 0,
            protectedScriptIntegrity: validation.ok ? 100 : 0,
            containerIntegrity: ((_x = detected.container) === null || _x === void 0 ? void 0 : _x.archive)
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
        if (!result.ok)
            result.error = { code: types_1.ErrorCodes.VERIFY_FAILED, message: '검증 실패: GDevelop 작업본을 안전하게 재삽입할 수 없습니다', details: result.warnings };
        if (req.options.humanSummary === true && result.scores && result.engine) {
            process.stderr.write(`[Tsukuru Agent] container=${(_z = (_y = result.container) === null || _y === void 0 ? void 0 : _y.type) !== null && _z !== void 0 ? _z : 'unknown'} engine=${result.engine.type} wrapper=${(_0 = result.engine.wrapper) !== null && _0 !== void 0 ? _0 : 'none'}\n`);
            process.stderr.write(`[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}\n`);
            process.stderr.write(`[Tsukuru Agent] extraction=${result.scores.extractionCoverage}% reinsert=${result.scores.reinsertionValidity}% protected-script-integrity=${result.scores.protectedScriptIntegrity}%\n`);
            writeStructuralSummary(result);
        }
        return;
    }
    let manifest;
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
                }
                else {
                    entries = m.entries.length;
                    if (entries === 0)
                        issues.push('manifest entries가 비어 있습니다');
                    const textFiles = new Set(m.entries.map((e) => e.extractFile));
                    for (const t of textFiles) {
                        const textPath = (0, patcher_1.resolveExtractArtifactPath)(extractDir, t);
                        if (!fs_1.default.existsSync(textPath))
                            issues.push(`추출 텍스트 파일이 없습니다: ${String(t)}`);
                    }
                }
            }
            catch (err) {
                if (err instanceof types_1.OperationError)
                    throw err;
                throw new types_1.OperationError(types_1.ErrorCodes.MANIFEST_CORRUPT, 'manifest.json 파싱에 실패했습니다', { manifestPath });
            }
        }
        // .extracteddata location differs by format (MV: data dir / Wolf: inside _Extract)
        const edPath = detected.format === 'rpgmv' || detected.format === 'rpgmz'
            ? path_1.default.join(detected.dataDir, '.extracteddata')
            : path_1.default.join(extractDir, '.extracteddata');
        if (!fs_1.default.existsSync(edPath)) {
            issues.push('.extracteddata 파일이 없습니다(apply에 필요합니다)');
        }
    }
    const artifactIssueCount = issues.length;
    if ((detected.format === 'rpgmv' || detected.format === 'rpgmz') && manifest) {
        const validation = (0, validator_1.inspectRpgProject)(detected.dataDir, manifest);
        result.validation = validation;
        issues.push(...validation.issues.map(structuralIssueMessage));
    }
    else if (detected.format === 'wolf' && manifest) {
        const validation = (0, validator_1.inspectWolfBinaryMappings)(detected.dataDir, manifest);
        result.validation = validation;
        issues.push(...validation.issues.map(structuralIssueMessage));
    }
    if (req.outputPath) {
        const sourcePath = path_1.default.resolve(req.projectPath);
        const outputPath = path_1.default.resolve(req.outputPath);
        if (sourcePath === outputPath) {
            issues.push('원본 경로와 출력 경로는 같을 수 없습니다');
        }
        else if (!fs_1.default.existsSync(outputPath) || !fs_1.default.statSync(outputPath).isDirectory()) {
            issues.push(`비교할 출력 디렉터리가 없습니다: ${req.outputPath}`);
        }
        else {
            try {
                const before = (0, validator_1.snapshotDirectory)(sourcePath);
                const after = (0, validator_1.snapshotDirectory)(outputPath);
                const diff = (0, validator_1.diffFileMaps)(before, after);
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
            }
            catch (err) {
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
    const ready = issues.length === 0 && extractionReady && ((_2 = (_1 = result.validation) === null || _1 === void 0 ? void 0 : _1.ok) !== null && _2 !== void 0 ? _2 : true);
    const deep = req.options.verifyDepth === 'deep';
    const structuralCritical = (_4 = (_3 = result.validation) === null || _3 === void 0 ? void 0 : _3.issues.filter((issue) => issue.severity === 'critical').map((issue) => issue.code)) !== null && _4 !== void 0 ? _4 : [];
    const scores = (0, validator_1.scoreVerification)({
        extractionCoverage: extractionReady ? 100 : 0,
        mappingIntegrity,
        reinsertionValidity: ready ? (deep && comparisonPerformed ? 80 : 50) : 0,
        protectedScriptIntegrity: comparisonPerformed ? (change.protectedScriptDamage === 0 ? 100 : 0) : 50,
        containerIntegrity: ((_5 = detected.container) === null || _5 === void 0 ? void 0 : _5.archive) ? (detected.container.archive.integrity === 'unreadable' ? 50 : 100) : 100,
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
        result.error = { code: types_1.ErrorCodes.VERIFY_FAILED, message: `검증 실패: ${issues.length}건`, details: issues };
    }
    if (req.options.humanSummary === true && result.scores && result.engine) {
        process.stderr.write(`[Tsukuru Agent] container=${(_7 = (_6 = result.container) === null || _6 === void 0 ? void 0 : _6.type) !== null && _7 !== void 0 ? _7 : 'unknown'} engine=${result.engine.type} wrapper=${(_8 = result.engine.wrapper) !== null && _8 !== void 0 ? _8 : 'none'}\n`);
        process.stderr.write(`[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}\n`);
        const damageSummary = comparisonPerformed ? `${result.change.protectedScriptDamage}%` : 'unassessed';
        process.stderr.write(`[Tsukuru Agent] extraction=${result.scores.extractionCoverage}% reinsert=${result.scores.reinsertionValidity}% protected-script-damage=${damageSummary}\n`);
        writeStructuralSummary(result);
    }
}
async function opExtract(req, detected, result) {
    var _a, _b, _c, _d, _e, _f;
    if (((_a = detected.container) === null || _a === void 0 ? void 0 : _a.type) === 'electron-asar') {
        await opExtractAsar(req, detected, result);
        return;
    }
    if (((_b = detected.container) === null || _b === void 0 ? void 0 : _b.type) === 'nwjs-package') {
        await opExtractNw(req, detected, result);
        return;
    }
    const context = buildContext();
    if (detected.format === 'rpgmv' || detected.format === 'rpgmz') {
        const svc = new RpgMakerService_1.RpgMakerService(context);
        const rep = await svc.extract(rpgExtractOptions(req, detected.dataDir));
        result.artifacts = [path_1.default.join(detected.dataDir, 'Extract'), path_1.default.join(detected.dataDir, 'Backup'), path_1.default.join(detected.dataDir, '.extracteddata'), (_c = rep.manifestPath) !== null && _c !== void 0 ? _c : ''].filter((a) => a !== '');
        result.stats = { files: rep.extractedFiles.length, entries: (_d = rep.manifestEntries) !== null && _d !== void 0 ? _d : 0, textBytes: rep.textBytes, elapsedMs: Math.round(rep.elapsedMs) };
    }
    else if (detected.format === 'wolf') {
        const svc = new WolfService_1.WolfService(context);
        const rep = await svc.extract({ folder: detected.dataDir, config: wolfConfig(req) });
        result.artifacts = [(_e = rep.extractDir) !== null && _e !== void 0 ? _e : '', (_f = rep.manifestPath) !== null && _f !== void 0 ? _f : ''].filter((a) => a !== '');
        result.stats = { entries: rep.extractedEntries };
    }
    else if (detected.format === 'tyrano') {
        const rep = new TyranoService_1.TyranoService().extract({ projectRoot: tyranoProjectRoot(detected), force: req.options.force === true });
        result.artifacts = [rep.extractDir, rep.manifestPath];
        result.stats = { files: rep.extractedFiles, entries: rep.extractedEntries };
    }
    else if (detected.format === 'gdevelop') {
        const rep = new GDevelopService_1.GDevelopService().extract({ projectRoot: gdevelopProjectRoot(detected), force: req.options.force === true });
        result.artifacts = [rep.extractDir, rep.manifestPath];
        result.stats = { files: rep.extractedFiles, entries: rep.extractedEntries };
    }
    else {
        throw new types_1.OperationError(types_1.ErrorCodes.NOT_IMPLEMENTED, `현재 엔진 프로파일은 진단만 지원합니다: ${detected.format}`, { format: detected.format });
    }
    result.ok = true;
}
function isWithinPath(parent, child) {
    const relative = path_1.default.relative(path_1.default.resolve(parent), path_1.default.resolve(child));
    return relative === '' || (!relative.startsWith('..' + path_1.default.sep) && !path_1.default.isAbsolute(relative));
}
function pathsOverlap(left, right) {
    return isWithinPath(left, right) || isWithinPath(right, left);
}
function sha256File(filePath) {
    const hash = crypto_1.default.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const handle = fs_1.default.openSync(filePath, 'r');
    try {
        let bytesRead = 0;
        do {
            bytesRead = fs_1.default.readSync(handle, buffer, 0, buffer.length, null);
            if (bytesRead > 0)
                hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
        return hash.digest('hex');
    }
    finally {
        fs_1.default.closeSync(handle);
    }
}
function normalizeRelative(value) {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}
function equalPathLists(left, right) {
    if (left.length !== right.length)
        return false;
    const sortedLeft = [...left].map(normalizeRelative).sort();
    const sortedRight = [...right].map(normalizeRelative).sort();
    return sortedLeft.every((entry, index) => entry === sortedRight[index]);
}
function assertNoSymbolicLinkInPath(root, relative) {
    let current = path_1.default.resolve(root);
    if (fs_1.default.lstatSync(current).isSymbolicLink()) {
        throw new types_1.OperationError(types_1.ErrorCodes.CONTAINER_PROVENANCE_INVALID, 'ASAR 작업본 루트는 심볼릭 링크/정션일 수 없습니다', { root });
    }
    for (const segment of normalizeRelative(relative).split('/')) {
        current = path_1.default.join(current, segment);
        if (!fs_1.default.existsSync(current)) {
            throw new types_1.OperationError(types_1.ErrorCodes.SOURCE_CHANGED, 'ASAR 작업본에서 원본 파일이 누락되었습니다', { relative });
        }
        if (fs_1.default.lstatSync(current).isSymbolicLink()) {
            throw new types_1.OperationError(types_1.ErrorCodes.CONTAINER_PROVENANCE_INVALID, 'ASAR 작업본에 심볼릭 링크/정션을 사용할 수 없습니다', { relative });
        }
    }
    return current;
}
function copyArchiveWorkingFiles(workingRoot, stagingRoot, provenance) {
    fs_1.default.mkdirSync(stagingRoot, { recursive: true });
    for (const relative of provenance.archiveFiles) {
        const source = assertNoSymbolicLinkInPath(workingRoot, relative);
        if (!fs_1.default.lstatSync(source).isFile()) {
            throw new types_1.OperationError(types_1.ErrorCodes.SOURCE_CHANGED, 'ASAR 작업본의 원본 파일이 일반 파일이 아닙니다', { relative });
        }
        const target = path_1.default.join(stagingRoot, ...relative.split('/'));
        if (!isWithinPath(stagingRoot, target)) {
            throw new types_1.OperationError(types_1.ErrorCodes.CONTAINER_PROVENANCE_INVALID, 'ASAR staging 경로가 안전하지 않습니다', { relative });
        }
        fs_1.default.mkdirSync(path_1.default.dirname(target), { recursive: true });
        fs_1.default.copyFileSync(source, target);
        fs_1.default.chmodSync(target, fs_1.default.statSync(source).mode);
    }
}
function copyTreeWithoutLinks(source, target) {
    fs_1.default.mkdirSync(path_1.default.dirname(target), { recursive: true });
    fs_1.default.cpSync(source, target, {
        recursive: true,
        preserveTimestamps: true,
        filter: (candidate) => {
            if (fs_1.default.lstatSync(candidate).isSymbolicLink()) {
                throw new types_1.OperationError(types_1.ErrorCodes.VERIFY_FAILED, '심볼릭 링크/정션이 있는 게임 복사본은 만들 수 없습니다', { path: candidate });
            }
            return true;
        },
    });
}
function copyApplyArtifacts(workingData, stagingData) {
    for (const name of ['Extract', 'Backup', '.extracteddata']) {
        const source = path_1.default.join(workingData, name);
        if (!fs_1.default.existsSync(source)) {
            throw new types_1.OperationError(types_1.ErrorCodes.PATH_NOT_FOUND, `ASAR 작업본에 apply 필수 산출물이 없습니다: ${name}`, { source });
        }
        copyTreeWithoutLinks(source, path_1.default.join(stagingData, name));
    }
}
function overlayDirectory(source, target) {
    if (!fs_1.default.existsSync(source))
        return;
    fs_1.default.mkdirSync(target, { recursive: true });
    for (const entry of fs_1.default.readdirSync(source)) {
        copyTreeWithoutLinks(path_1.default.join(source, entry), path_1.default.join(target, entry));
    }
}
function verifyProtectedWorkingFiles(workingRoot, sourceArchive, provenance) {
    const changed = [];
    for (const relative of provenance.archiveFiles.filter(validator_1.isProtectedPath)) {
        const workingFile = assertNoSymbolicLinkInPath(workingRoot, relative);
        const archiveEntry = relative.split('/').join(path_1.default.sep);
        const original = asar.extractFile(sourceArchive, archiveEntry, false);
        if (!original.equals(fs_1.default.readFileSync(workingFile)))
            changed.push(relative);
    }
    if (changed.length > 0) {
        throw new types_1.OperationError(types_1.ErrorCodes.VERIFY_FAILED, 'ASAR 작업본의 보호 스크립트가 원본과 다릅니다', { changed });
    }
}
function containerApplyOutputPath(req, sourceRoot, workingRoot) {
    var _a;
    const source = path_1.default.resolve(sourceRoot);
    const working = path_1.default.resolve(workingRoot);
    const output = path_1.default.resolve((_a = req.outputPath) !== null && _a !== void 0 ? _a : path_1.default.join(path_1.default.dirname(source), path_1.default.basename(source) + '_Completed'));
    if (pathsOverlap(source, output) || pathsOverlap(working, output)) {
        throw new types_1.OperationError(types_1.ErrorCodes.OUTPUT_CONFLICT, '컨테이너 출력은 원본과 작업본 양쪽 경로 바깥이어야 합니다', { outputPath: output });
    }
    if (fs_1.default.existsSync(output) && req.options.force !== true) {
        throw new types_1.OperationError(types_1.ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 이미 존재합니다', { outputPath: output });
    }
    return output;
}
async function verifyProtectedNwWorkingFiles(workingRoot, sourceInfo, provenance) {
    const originalRoot = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'tsukuru-agent-nw-protected-'));
    try {
        await (0, container_1.extractContainer)(sourceInfo, originalRoot);
        const changed = [];
        for (const relative of provenance.archiveFiles.filter(validator_1.isProtectedPath)) {
            const workingFile = assertNoSymbolicLinkInPath(workingRoot, relative);
            const originalFile = assertNoSymbolicLinkInPath(originalRoot, relative);
            if (!fs_1.default.readFileSync(originalFile).equals(fs_1.default.readFileSync(workingFile)))
                changed.push(relative);
        }
        if (changed.length > 0) {
            throw new types_1.OperationError(types_1.ErrorCodes.VERIFY_FAILED, 'NW.js 작업본의 보호 스크립트가 원본과 다릅니다', { changed });
        }
    }
    finally {
        fs_1.default.rmSync(originalRoot, { recursive: true, force: true });
    }
}
async function opApplyNwWorking(req, detected, result, provenance) {
    if (detected.format !== 'gdevelop' || provenance.engine.type !== 'gdevelop') {
        throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_MISMATCH, 'NW.js 작업본은 현재 GDevelop 엔진만 적용할 수 있습니다', { format: detected.format });
    }
    const sourcePath = req.options.containerSourcePath;
    if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
        throw new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, 'NW.js apply에는 options.containerSourcePath 원본 경로가 필요합니다');
    }
    const sourceInfo = (0, container_1.inspectContainer)(sourcePath);
    if (sourceInfo.type !== 'nwjs-package' || !sourceInfo.archive || !sourceInfo.archivePath || !sourceInfo.packagePath) {
        throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_MISMATCH, 'containerSourcePath에서 package.nw를 찾지 못했습니다', { sourcePath });
    }
    const sourceArchiveRelative = normalizeRelative(path_1.default.relative(sourceInfo.rootPath, sourceInfo.packagePath));
    if (sourceArchiveRelative !== provenance.archiveRelativePath || sourceInfo.archive.sha256 !== provenance.archiveSha256) {
        throw new types_1.OperationError(types_1.ErrorCodes.SOURCE_CHANGED, '지정한 원본 package.nw가 작업본 provenance와 일치하지 않습니다', {
            expectedPath: provenance.archiveRelativePath,
            actualPath: sourceArchiveRelative,
            expectedSha256: provenance.archiveSha256,
            actualSha256: sourceInfo.archive.sha256,
        });
    }
    if (sourceInfo.engine.type !== provenance.engine.type || sourceInfo.engine.root !== provenance.engine.root
        || !equalPathLists(sourceInfo.archive.fileEntries, provenance.archiveFiles)) {
        throw new types_1.OperationError(types_1.ErrorCodes.SOURCE_CHANGED, '원본 package.nw 엔진 또는 파일 목록이 provenance와 일치하지 않습니다');
    }
    const workingRoot = path_1.default.resolve(req.projectPath);
    const output = containerApplyOutputPath(req, sourceInfo.rootPath, workingRoot);
    const outputParent = path_1.default.dirname(output);
    fs_1.default.mkdirSync(outputParent, { recursive: true });
    const tempRoot = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'tsukuru-agent-nw-pack-'));
    const archiveWorking = path_1.default.join(tempRoot, 'archive-working');
    const engineOutput = path_1.default.join(tempRoot, 'engine-output');
    const repackRoot = path_1.default.join(tempRoot, 'repack');
    const outputStagingRoot = fs_1.default.mkdtempSync(path_1.default.join(outputParent, '.tsukuru-agent-nw-output-'));
    const outputStaging = path_1.default.join(outputStagingRoot, 'payload');
    try {
        copyArchiveWorkingFiles(workingRoot, archiveWorking, provenance);
        await verifyProtectedNwWorkingFiles(workingRoot, sourceInfo, provenance);
        const engineSegments = provenance.engine.root.split('/').filter(Boolean);
        const workingEngineRoot = path_1.default.join(workingRoot, ...engineSegments);
        const archiveEngineRoot = path_1.default.join(archiveWorking, ...engineSegments);
        const extractArtifacts = path_1.default.join(workingEngineRoot, '_Extract');
        if (!fs_1.default.existsSync(extractArtifacts)) {
            throw new types_1.OperationError(types_1.ErrorCodes.PATH_NOT_FOUND, 'NW.js GDevelop 작업본에 _Extract가 없습니다', { extractArtifacts });
        }
        copyTreeWithoutLinks(extractArtifacts, path_1.default.join(archiveEngineRoot, '_Extract'));
        const before = (0, validator_1.snapshotDirectory)(archiveWorking);
        const applied = new GDevelopService_1.GDevelopService().applyToCopy({ projectRoot: archiveEngineRoot, outputRoot: engineOutput });
        let packageRoot = engineOutput;
        if (engineSegments.length > 0) {
            copyTreeWithoutLinks(archiveWorking, repackRoot);
            const repackEngineRoot = path_1.default.join(repackRoot, ...engineSegments);
            fs_1.default.rmSync(repackEngineRoot, { recursive: true, force: true });
            copyTreeWithoutLinks(engineOutput, repackEngineRoot);
            packageRoot = repackRoot;
        }
        const change = (0, validator_1.diffFileMaps)(before, (0, validator_1.snapshotDirectory)(packageRoot));
        if (change.protectedScriptDamage > 0) {
            throw new types_1.OperationError(types_1.ErrorCodes.VERIFY_FAILED, 'NW.js apply 과정에서 보호 스크립트가 변경되었습니다', { change });
        }
        copyTreeWithoutLinks(sourceInfo.rootPath, outputStaging);
        const outputArchive = path_1.default.join(outputStaging, ...provenance.archiveRelativePath.split('/'));
        fs_1.default.rmSync(outputArchive, { force: true });
        await (0, container_1.packContainer)(sourceInfo, packageRoot, outputArchive);
        const verified = (0, container_1.verifyContainerOutput)(outputArchive, provenance.requiredEntries);
        if (!verified.archive || verified.archive.invalidEntryCount > 0 || verified.archive.unsafeLinkCount > 0
            || verified.engine.type !== provenance.engine.type || verified.engine.root !== provenance.engine.root
            || !equalPathLists(verified.archive.fileEntries, provenance.archiveFiles)) {
            throw new types_1.OperationError(types_1.ErrorCodes.VERIFY_FAILED, '재포장한 package.nw 구조 검증에 실패했습니다', { verified });
        }
        if (sha256File(sourceInfo.archivePath) !== provenance.archiveSha256) {
            throw new types_1.OperationError(types_1.ErrorCodes.SOURCE_CHANGED, '작업 도중 원본 package.nw가 변경되었습니다', { source: sourceInfo.archivePath });
        }
        if (fs_1.default.existsSync(output)) {
            if (req.options.force !== true)
                throw new types_1.OperationError(types_1.ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 작업 도중 생성되었습니다', { outputPath: output });
            fs_1.default.rmSync(output, { recursive: true, force: true });
        }
        fs_1.default.renameSync(outputStaging, output);
        const finalArchive = path_1.default.join(output, ...provenance.archiveRelativePath.split('/'));
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
    }
    finally {
        fs_1.default.rmSync(tempRoot, { recursive: true, force: true });
        fs_1.default.rmSync(outputStagingRoot, { recursive: true, force: true });
    }
}
async function opApplyAsarWorking(req, detected, result, provenance) {
    var _a, _b;
    if (detected.format !== 'rpgmv' && detected.format !== 'rpgmz') {
        throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_MISMATCH, 'ASAR 작업본의 RPG Maker 엔진을 판별할 수 없습니다', { format: detected.format });
    }
    const sourcePath = req.options.containerSourcePath;
    if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
        throw new types_1.OperationError(types_1.ErrorCodes.REQUEST_INVALID, 'ASAR apply에는 options.containerSourcePath 원본 경로가 필요합니다');
    }
    const sourceInfo = (0, container_1.inspectContainer)(sourcePath);
    if (sourceInfo.type !== 'electron-asar' || !sourceInfo.archive || !sourceInfo.archivePath) {
        throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_MISMATCH, 'containerSourcePath에서 Electron app.asar를 찾지 못했습니다', { sourcePath });
    }
    const sourceArchiveRelative = normalizeRelative(path_1.default.relative(sourceInfo.rootPath, sourceInfo.archivePath));
    if (sourceArchiveRelative !== provenance.archiveRelativePath
        || sourceInfo.archive.sha256 !== provenance.archiveSha256) {
        throw new types_1.OperationError(types_1.ErrorCodes.SOURCE_CHANGED, '지정한 원본 ASAR가 작업본 provenance와 일치하지 않습니다', {
            expectedPath: provenance.archiveRelativePath,
            actualPath: sourceArchiveRelative,
            expectedSha256: provenance.archiveSha256,
            actualSha256: sourceInfo.archive.sha256,
        });
    }
    if (sourceInfo.engine.type !== provenance.engine.type || sourceInfo.engine.root !== provenance.engine.root) {
        throw new types_1.OperationError(types_1.ErrorCodes.SOURCE_CHANGED, '원본 ASAR 엔진 프로파일이 작업본 provenance와 일치하지 않습니다', {
            expected: provenance.engine,
            actual: sourceInfo.engine,
        });
    }
    if (!equalPathLists(sourceInfo.archive.fileEntries, provenance.archiveFiles)
        || !equalPathLists(sourceInfo.archive.unpackedEntries, provenance.unpackedFiles)) {
        throw new types_1.OperationError(types_1.ErrorCodes.SOURCE_CHANGED, '원본 ASAR 파일 목록이 작업본 provenance와 일치하지 않습니다');
    }
    const workingRoot = path_1.default.resolve(req.projectPath);
    const output = containerApplyOutputPath(req, sourceInfo.rootPath, workingRoot);
    const outputParent = path_1.default.dirname(output);
    fs_1.default.mkdirSync(outputParent, { recursive: true });
    const packStaging = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'tsukuru-agent-pack-'));
    const outputStagingRoot = fs_1.default.mkdtempSync(path_1.default.join(outputParent, '.tsukuru-agent-output-'));
    const outputStaging = path_1.default.join(outputStagingRoot, 'payload');
    try {
        copyArchiveWorkingFiles(workingRoot, packStaging, provenance);
        verifyProtectedWorkingFiles(workingRoot, sourceInfo.archivePath, provenance);
        const before = (0, validator_1.snapshotDirectory)(packStaging);
        const engineRoot = path_1.default.join(packStaging, ...provenance.engine.root.split('/').filter(Boolean));
        const workingEngineRoot = path_1.default.join(workingRoot, ...provenance.engine.root.split('/').filter(Boolean));
        const dataDir = path_1.default.join(engineRoot, 'data');
        copyApplyArtifacts(path_1.default.join(workingEngineRoot, 'data'), dataDir);
        const context = buildContext();
        const svc = new RpgMakerService_1.RpgMakerService(context);
        const rep = await svc.apply({
            dir: dataDir,
            instantapply: false,
            autoline: req.options.autoline === true,
            isComment: req.options.isComment === true,
            useYaml: req.options.useYaml === true,
        });
        const completed = path_1.default.join(dataDir, 'Completed');
        overlayDirectory(path_1.default.join(completed, 'data'), dataDir);
        overlayDirectory(path_1.default.join(completed, 'js'), path_1.default.join(engineRoot, 'js'));
        for (const artifact of ['Extract', 'Backup', 'Completed', '.extracteddata']) {
            fs_1.default.rmSync(path_1.default.join(dataDir, artifact), { recursive: true, force: true });
        }
        fs_1.default.rmSync(path_1.default.join(packStaging, containerProvenance_1.CONTAINER_PROVENANCE_FILE), { force: true });
        const after = (0, validator_1.snapshotDirectory)(packStaging);
        const change = (0, validator_1.diffFileMaps)(before, after);
        if (change.protectedScriptDamage > 0) {
            throw new types_1.OperationError(types_1.ErrorCodes.VERIFY_FAILED, 'apply 과정에서 보호 스크립트가 변경되었습니다', { change });
        }
        copyTreeWithoutLinks(sourceInfo.rootPath, outputStaging);
        const outputArchive = path_1.default.join(outputStaging, ...provenance.archiveRelativePath.split('/'));
        fs_1.default.rmSync(outputArchive, { force: true });
        await (0, container_1.packContainer)(sourceInfo, packStaging, outputArchive);
        const verified = (0, container_1.verifyContainerOutput)(outputArchive, provenance.requiredEntries);
        if (!verified.archive || verified.archive.invalidEntryCount > 0 || verified.archive.unsafeLinkCount > 0
            || verified.engine.type !== provenance.engine.type || verified.engine.root !== provenance.engine.root
            || !equalPathLists(verified.archive.fileEntries, provenance.archiveFiles)
            || !equalPathLists(verified.archive.unpackedEntries, provenance.unpackedFiles)) {
            throw new types_1.OperationError(types_1.ErrorCodes.VERIFY_FAILED, '재포장한 ASAR의 구조 검증에 실패했습니다', { verified });
        }
        const runtime = await (0, runtimeDiagnostics_1.inspectElectronRuntime)(outputStaging, outputArchive, provenance.archiveRelativePath);
        if (runtime.blocked) {
            throw new types_1.OperationError(types_1.ErrorCodes.RUNTIME_INTEGRITY, (_a = runtime.blockReason) !== null && _a !== void 0 ? _a : 'Electron 런타임 무결성 검증에 실패했습니다', runtime);
        }
        if (req.options.launchProbe === true) {
            if (!runtime.executable) {
                throw new types_1.OperationError(types_1.ErrorCodes.LAUNCH_PROBE_FAILED, '실행 프로브에 사용할 Electron 실행 파일을 찾지 못했습니다', runtime);
            }
            const executableRelative = path_1.default.relative(outputStaging, runtime.executable);
            const probeRoot = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'tsukuru-agent-launch-'));
            const probePayload = path_1.default.join(probeRoot, 'payload');
            try {
                copyTreeWithoutLinks(outputStaging, probePayload);
                runtime.launchProbe = await (0, runtimeDiagnostics_1.runLaunchProbe)(path_1.default.join(probePayload, executableRelative), [], { timeoutMs: req.options.launchTimeoutMs });
                if (runtime.launchProbe.status === 'failed' || runtime.launchProbe.status === 'exited-error') {
                    throw new types_1.OperationError(types_1.ErrorCodes.LAUNCH_PROBE_FAILED, '재포장 게임의 실행 프로브가 실패했습니다', runtime.launchProbe);
                }
            }
            finally {
                fs_1.default.rmSync(probeRoot, { recursive: true, force: true });
            }
        }
        if (sha256File(sourceInfo.archivePath) !== provenance.archiveSha256) {
            throw new types_1.OperationError(types_1.ErrorCodes.SOURCE_CHANGED, '작업 도중 원본 ASAR가 변경되었습니다', { source: sourceInfo.archivePath });
        }
        if (fs_1.default.existsSync(output)) {
            if (req.options.force !== true) {
                throw new types_1.OperationError(types_1.ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 작업 도중 생성되었습니다', { outputPath: output });
            }
            fs_1.default.rmSync(output, { recursive: true, force: true });
        }
        fs_1.default.renameSync(outputStaging, output);
        const finalArchive = path_1.default.join(output, ...provenance.archiveRelativePath.split('/'));
        const remapRuntimePath = (value) => path_1.default.join(output, path_1.default.relative(outputStaging, value));
        runtime.executable = runtime.executable ? remapRuntimePath(runtime.executable) : null;
        runtime.executableCandidates = runtime.executableCandidates.map(remapRuntimePath);
        if (runtime.launchProbe)
            runtime.launchProbe.executable = (_b = runtime.executable) !== null && _b !== void 0 ? _b : runtime.launchProbe.executable;
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
    }
    finally {
        fs_1.default.rmSync(packStaging, { recursive: true, force: true });
        fs_1.default.rmSync(outputStagingRoot, { recursive: true, force: true });
    }
}
async function opApply(req, detected, result) {
    var _a, _b, _c, _d;
    const provenance = (0, containerProvenance_1.readContainerProvenance)(req.projectPath);
    if (provenance) {
        if (provenance.containerType === 'nwjs-package')
            await opApplyNwWorking(req, detected, result, provenance);
        else
            await opApplyAsarWorking(req, detected, result, provenance);
        return;
    }
    if (((_a = detected.container) === null || _a === void 0 ? void 0 : _a.type) === 'electron-asar') {
        throw new types_1.OperationError(types_1.ErrorCodes.NOT_IMPLEMENTED, '원본 ASAR 직접 적용은 아직 지원하지 않습니다. 먼저 별도 작업 디렉터리로 추출하세요', { format: detected.format });
    }
    const context = buildContext();
    if (detected.format === 'rpgmv' || detected.format === 'rpgmz') {
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
    else if (detected.format === 'wolf') {
        // Wolf: 게임 복사본에만 적용(계획서 §CLI 계약). 기본 출력: <게임 루트>/Completed
        const targetDir = (_b = req.outputPath) !== null && _b !== void 0 ? _b : path_1.default.join(path_1.default.dirname(detected.dataDir), 'Completed');
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
    else if (detected.format === 'tyrano') {
        const projectRoot = tyranoProjectRoot(detected);
        const targetDir = (_c = req.outputPath) !== null && _c !== void 0 ? _c : path_1.default.join(path_1.default.dirname(projectRoot), 'Completed');
        const rep = new TyranoService_1.TyranoService().applyToCopy({ projectRoot, outputRoot: targetDir, force: req.options.force === true });
        result.artifacts = [rep.outputRoot];
        result.stats = { files: rep.appliedFiles, entries: rep.appliedEntries };
        result.validation = rep.validation;
    }
    else if (detected.format === 'gdevelop') {
        const projectRoot = gdevelopProjectRoot(detected);
        const targetDir = (_d = req.outputPath) !== null && _d !== void 0 ? _d : path_1.default.join(path_1.default.dirname(projectRoot), 'Completed');
        const rep = new GDevelopService_1.GDevelopService().applyToCopy({ projectRoot, outputRoot: targetDir, force: req.options.force === true });
        result.artifacts = [rep.outputRoot];
        result.stats = { files: rep.appliedFiles, entries: rep.appliedEntries };
        result.validation = rep.validation;
    }
    else {
        throw new types_1.OperationError(types_1.ErrorCodes.NOT_IMPLEMENTED, `현재 엔진 프로파일은 진단만 지원합니다: ${detected.format}`, { format: detected.format });
    }
    result.ok = true;
}
/** patch: manifest ID·해시 검증 후 추출 작업본만 수정하고 줄 매핑을 재생성한다. */
async function opPatch(req, detected, result) {
    var _a;
    if (((_a = detected.container) === null || _a === void 0 ? void 0 : _a.type) === 'electron-asar') {
        throw new types_1.OperationError(types_1.ErrorCodes.NOT_IMPLEMENTED, '원본 ASAR 직접 패치는 아직 지원하지 않습니다. 먼저 별도 작업 디렉터리로 추출하세요', { format: detected.format });
    }
    const extractDir = extractDirOf(detected);
    if (detected.format !== 'rpgmv' && detected.format !== 'rpgmz' && detected.format !== 'wolf' && detected.format !== 'tyrano' && detected.format !== 'gdevelop') {
        throw new types_1.OperationError(types_1.ErrorCodes.NOT_IMPLEMENTED, `현재 엔진 프로파일은 진단만 지원합니다: ${detected.format}`, { format: detected.format });
    }
    const patchFormat = detected.format === 'wolf'
        ? 'wolf'
        : detected.format === 'tyrano'
            ? 'tyrano'
            : detected.format === 'gdevelop'
                ? 'gdevelop'
                : 'rpgmv';
    const patchExtractDir = detected.format === 'tyrano'
        ? path_1.default.join(tyranoProjectRoot(detected), 'data', '_Extract')
        : detected.format === 'gdevelop'
            ? path_1.default.join(gdevelopProjectRoot(detected), '_Extract')
            : extractDir;
    const outcome = (0, patcher_1.applyPatches)(patchExtractDir, patchFormat, req.patches);
    result.ok = true;
    result.artifacts = [path_1.default.join(patchExtractDir, manifest_1.MANIFEST_FILE)];
    result.stats = { patched: outcome.patched, files: outcome.files };
}
/** Node/Electron 공용 실행기. argv는 'run' 서브커맨드부터 시작한다. */
async function runAgent(argv) {
    const result = (0, schema_1.emptyResult)();
    try {
        const req = (0, schema_1.validateRequest)(loadRequest(parseArgs(argv)));
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
    }
    catch (err) {
        const opErr = (0, types_1.toOperationError)(err);
        result.ok = false;
        result.error = opErr.toJSON();
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
}
function containerOutputPath(req, sourceRoot) {
    var _a;
    const source = path_1.default.resolve(sourceRoot);
    const output = path_1.default.resolve((_a = req.outputPath) !== null && _a !== void 0 ? _a : path_1.default.join(path_1.default.dirname(source), path_1.default.basename(source) + '_tsukuru'));
    if (pathsOverlap(source, output)) {
        throw new types_1.OperationError(types_1.ErrorCodes.OUTPUT_CONFLICT, '컨테이너 출력은 원본 경로 바깥이어야 합니다', { outputPath: output });
    }
    if (fs_1.default.existsSync(output)) {
        if (req.options.force === true)
            fs_1.default.rmSync(output, { recursive: true, force: true });
        else
            throw new types_1.OperationError(types_1.ErrorCodes.OUTPUT_CONFLICT, '출력 경로가 이미 존재합니다', { outputPath: output });
    }
    return output;
}
async function opExtractAsar(req, detected, result) {
    var _a;
    if (!detected.container || (detected.format !== 'rpgmv' && detected.format !== 'rpgmz')) {
        throw new types_1.OperationError(types_1.ErrorCodes.NOT_IMPLEMENTED, '현재 ASAR 엔진 프로파일은 진단만 지원합니다', { format: detected.format });
    }
    const output = containerOutputPath(req, detected.container.rootPath);
    const staging = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'tsukuru-agent-asar-'));
    let completed = false;
    try {
        await (0, container_1.extractContainer)(detected.container, staging);
        const provenance = (0, containerProvenance_1.createContainerProvenance)(detected.container, staging);
        const dataDir = path_1.default.join(staging, detected.container.engine.root, 'data');
        if (!fs_1.default.existsSync(dataDir))
            throw new types_1.OperationError(types_1.ErrorCodes.FORMAT_UNKNOWN, 'ASAR 안에서 MZ data 폴더를 찾지 못했습니다', { dataDir });
        const context = buildContext();
        const svc = new RpgMakerService_1.RpgMakerService(context);
        const rep = await svc.extract(rpgExtractOptions(req, dataDir));
        fs_1.default.cpSync(staging, output, { recursive: true });
        (0, container_1.copyExternalResources)(detected.container, output);
        const provenancePath = (0, containerProvenance_1.writeContainerProvenance)(output, provenance);
        result.artifacts = [output, path_1.default.join(output, detected.container.engine.root, 'data', 'Extract'), path_1.default.join(output, detected.container.engine.root, 'data', '.extracteddata'), provenancePath];
        result.stats = { files: rep.extractedFiles.length, entries: (_a = rep.manifestEntries) !== null && _a !== void 0 ? _a : 0, textBytes: rep.textBytes, elapsedMs: Math.round(rep.elapsedMs) };
        result.ok = true;
        completed = true;
    }
    finally {
        fs_1.default.rmSync(staging, { recursive: true, force: true });
        if (!completed && fs_1.default.existsSync(output))
            fs_1.default.rmSync(output, { recursive: true, force: true });
    }
}
async function opExtractNw(req, detected, result) {
    if (!detected.container || detected.container.type !== 'nwjs-package' || detected.format !== 'gdevelop') {
        throw new types_1.OperationError(types_1.ErrorCodes.NOT_IMPLEMENTED, '현재 package.nw 엔진 프로파일은 GDevelop만 추출할 수 있습니다', { format: detected.format });
    }
    const output = containerOutputPath(req, detected.container.rootPath);
    const staging = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'tsukuru-agent-nw-'));
    let completed = false;
    try {
        await (0, container_1.extractContainer)(detected.container, staging);
        const provenance = (0, containerProvenance_1.createContainerProvenance)(detected.container, staging);
        const engineRoot = path_1.default.join(staging, ...detected.container.engine.root.split('/').filter(Boolean));
        const rep = new GDevelopService_1.GDevelopService().extract({ projectRoot: engineRoot, force: req.options.force === true });
        fs_1.default.cpSync(staging, output, { recursive: true });
        const provenancePath = (0, containerProvenance_1.writeContainerProvenance)(output, provenance);
        const outputEngineRoot = path_1.default.join(output, ...detected.container.engine.root.split('/').filter(Boolean));
        result.artifacts = [output, path_1.default.join(outputEngineRoot, '_Extract'), provenancePath];
        result.stats = { files: rep.extractedFiles, entries: rep.extractedEntries };
        result.ok = true;
        completed = true;
    }
    finally {
        fs_1.default.rmSync(staging, { recursive: true, force: true });
        if (!completed && fs_1.default.existsSync(output))
            fs_1.default.rmSync(output, { recursive: true, force: true });
    }
}
