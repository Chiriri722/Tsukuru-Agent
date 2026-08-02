/**
 * 원자적 파일 쓰기 (계획서 §Manifest와 안전성: "모든 쓰기는 임시 디렉터리에서
 * 완료·검증한 뒤 교체합니다"). 파일 단위는 같은 디렉터리의 임시 파일에 쓴 뒤
 * rename으로 교체한다(같은 볼륨 내 rename은 원자적).
 */
import fs from 'fs';
import path from 'path';

/** data를 file에 원자적으로 기록한다. 실패 시 원본을 보존한다. */
export function atomicWriteFileSync(file: string, data: string | Buffer): void {
    const tmp = `${file}.tmp-${process.pid}`;
    try {
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, file);
    } catch (err) {
        try {
            if (fs.existsSync(tmp)) {
                fs.rmSync(tmp);
            }
        } catch { /* 정리 실패는 무시 */ }
        throw err;
    }
}

/**
 * stagingDir의 트리를 targetDir로 원자적으로 교체한다.
 * 호출 전에 stagingDir 구축이 완료·검증되어 있어야 한다.
 */
export function replaceDirSync(stagingDir: string, targetDir: string): void {
    const backupDir = `${targetDir}.old-${process.pid}`;
    if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
    }
    const hadTarget = fs.existsSync(targetDir);
    if (hadTarget) {
        fs.renameSync(targetDir, backupDir);
    }
    try {
        fs.renameSync(stagingDir, targetDir);
    } catch (err) {
        // 롤백
        if (hadTarget && fs.existsSync(backupDir)) {
            fs.renameSync(backupDir, targetDir);
        }
        throw err;
    }
    if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
    }
}

/** parentDir 안에 쓰기를 위한 임시 스테이징 디렉터리를 만든다. */
export function makeStagingDir(parentDir: string, prefix: string): string {
    const staging = path.join(parentDir, `${prefix}.tmp-${process.pid}`);
    if (fs.existsSync(staging)) {
        fs.rmSync(staging, { recursive: true, force: true });
    }
    fs.mkdirSync(staging, { recursive: true });
    return staging;
}
