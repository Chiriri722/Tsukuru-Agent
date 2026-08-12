"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFormat = detectFormat;
exports.detectProject = detectProject;
/**
 * 프로젝트 포맷 판별 및 경로 정규화 (계획서 §CLI 계약 format:auto).
 * Electron 비의존.
 *
 * 판별 순서(Key Question 5 결정):
 * 1. Wolf 마커 우선(.wolf 아카이브, data 폼더 내 .mps) — 더 특징적
 * 2. RPG MV/MZ 마커(data 폼더 내 .json)
 * 3. projectPath 자체가 data 폼더인 경우
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const container_1 = require("../core/container");
function isDir(p) {
    try {
        return fs_1.default.statSync(p).isDirectory();
    }
    catch (_a) {
        return false;
    }
}
function isFile(p) {
    try {
        return fs_1.default.statSync(p).isFile();
    }
    catch (_a) {
        return false;
    }
}
function containsExt(dir, ext) {
    try {
        return fs_1.default.readdirSync(dir).some((f) => f.toLowerCase().endsWith(ext));
    }
    catch (_a) {
        return false;
    }
}
function isPortableRpgExtractionPack(projectPath) {
    return isDir(projectPath)
        && isDir(path_1.default.join(projectPath, 'Backup'))
        && containsExt(path_1.default.join(projectPath, 'Backup'), '.json')
        && isFile(path_1.default.join(projectPath, 'Extract', 'manifest.json'));
}
/** 판별 실패 시 null. */
function detectFormat(projectPath) {
    const roots = [projectPath, path_1.default.join(projectPath, 'www')];
    // 원본 data 폴더에서 Backup/Extract/.extracteddata만 따로 옮긴 휴대용 작업 팩.
    if (isPortableRpgExtractionPack(projectPath)) {
        return { format: 'rpgmv', dataDir: projectPath };
    }
    // 1. Wolf 마커
    for (const root of roots) {
        if (!isDir(root)) {
            continue;
        }
        if (isFile(path_1.default.join(root, 'Data.wolf'))) {
            const dd = ['data', 'Data'].map((n) => path_1.default.join(root, n)).find(isDir);
            if (dd) {
                return { format: 'wolf', dataDir: dd };
            }
        }
        for (const name of ['data', 'Data']) {
            const dd = path_1.default.join(root, name);
            if (isDir(dd) && containsExt(dd, '.mps')) {
                return { format: 'wolf', dataDir: dd };
            }
        }
    }
    // 2. RPG MV/MZ 마커
    for (const root of roots) {
        if (!isDir(root)) {
            continue;
        }
        for (const name of ['data', 'Data']) {
            const dd = path_1.default.join(root, name);
            if (isDir(dd) && containsExt(dd, '.json')) {
                return { format: 'rpgmv', dataDir: dd };
            }
        }
    }
    // 3. projectPath 자체가 data 폼더
    if (isDir(projectPath)) {
        if (containsExt(projectPath, '.mps')) {
            return { format: 'wolf', dataDir: projectPath };
        }
        if (containsExt(projectPath, '.json')) {
            return { format: 'rpgmv', dataDir: projectPath };
        }
    }
    return null;
}
/** v2 탐지: loose directory와 Electron/NW.js wrapper를 엔진 프로파일로 정규화한다. */
function detectProject(projectPath) {
    var _a;
    const container = (0, container_1.inspectContainer)(projectPath);
    const engine = container.engine.type;
    if (engine !== 'unknown') {
        const base = path_1.default.join(container.rootPath, container.engine.root);
        const dataCandidates = [
            path_1.default.join(base, 'data'),
            path_1.default.join(base, 'Data'),
            path_1.default.join(container.rootPath, 'www', 'data'),
            path_1.default.join(container.rootPath, 'www', 'Data'),
        ];
        const dataDir = container.type === 'electron-asar'
            ? path_1.default.join(base, 'data')
            : ((_a = dataCandidates.find(isDir)) !== null && _a !== void 0 ? _a : path_1.default.join(base, 'data'));
        return { format: engine, dataDir, container };
    }
    const legacy = detectFormat(projectPath);
    return legacy ? { ...legacy, container } : null;
}
