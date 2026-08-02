"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.atomicWriteFileSync = atomicWriteFileSync;
exports.replaceDirSync = replaceDirSync;
exports.makeStagingDir = makeStagingDir;
/**
 * 원자적 파일 쓰기 (계획서 §Manifest와 안전성: "모든 쓰기는 임시 디렉터리에서
 * 완료·검증한 뒤 교체합니다"). 파일 단위는 같은 디렉터리의 임시 파일에 쓴 뒤
 * rename으로 교체한다(같은 볼륨 내 rename은 원자적).
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/** data를 file에 원자적으로 기록한다. 실패 시 원본을 보존한다. */
function atomicWriteFileSync(file, data) {
    const tmp = `${file}.tmp-${process.pid}`;
    try {
        fs_1.default.writeFileSync(tmp, data);
        fs_1.default.renameSync(tmp, file);
    }
    catch (err) {
        try {
            if (fs_1.default.existsSync(tmp)) {
                fs_1.default.rmSync(tmp);
            }
        }
        catch ( /* 정리 실패는 무시 */_a) { /* 정리 실패는 무시 */ }
        throw err;
    }
}
/**
 * stagingDir의 트리를 targetDir로 원자적으로 교체한다.
 * 호출 전에 stagingDir 구축이 완료·검증되어 있어야 한다.
 */
function replaceDirSync(stagingDir, targetDir) {
    const backupDir = `${targetDir}.old-${process.pid}`;
    if (fs_1.default.existsSync(backupDir)) {
        fs_1.default.rmSync(backupDir, { recursive: true, force: true });
    }
    const hadTarget = fs_1.default.existsSync(targetDir);
    if (hadTarget) {
        fs_1.default.renameSync(targetDir, backupDir);
    }
    try {
        fs_1.default.renameSync(stagingDir, targetDir);
    }
    catch (err) {
        // 롤백
        if (hadTarget && fs_1.default.existsSync(backupDir)) {
            fs_1.default.renameSync(backupDir, targetDir);
        }
        throw err;
    }
    if (fs_1.default.existsSync(backupDir)) {
        fs_1.default.rmSync(backupDir, { recursive: true, force: true });
    }
}
/** parentDir 안에 쓰기를 위한 임시 스테이징 디렉터리를 만든다. */
function makeStagingDir(parentDir, prefix) {
    const staging = path_1.default.join(parentDir, `${prefix}.tmp-${process.pid}`);
    if (fs_1.default.existsSync(staging)) {
        fs_1.default.rmSync(staging, { recursive: true, force: true });
    }
    fs_1.default.mkdirSync(staging, { recursive: true });
    return staging;
}
