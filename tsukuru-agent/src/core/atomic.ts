/**
 * 원자적 파일 쓰기 (계획서 §Manifest와 안전성: "모든 쓰기는 임시 디렉터리에서
 * 완료·검증한 뒤 교체합니다"). 파일 단위는 같은 디렉터리의 임시 파일에 쓴 뒤
 * rename으로 교체한다(같은 볼륨 내 rename은 원자적).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { findLinkedPathComponent } from './pathSafety';

/** 임시 산출물 정리 실패가 이미 결정된 작업 결과를 뒤집지 않도록 오류를 값으로 반환한다. */
export function removePathBestEffortSync(
    target: string,
    options: Parameters<typeof fs.rmSync>[1] = { force: true },
): Error | undefined {
    try {
        fs.rmSync(target, options);
        return undefined;
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
}

export interface AtomicFileWrite {
    file: string;
    data: string | Buffer;
}

interface StagedFileWrite extends AtomicFileWrite {
    file: string;
    temporary: string;
    backup: string;
    hadOriginal: boolean;
    installed: boolean;
}

/** 여러 파일을 모두 staging한 뒤 교체한다. 프로세스 내 실패 시 교체된 파일 전체를 롤백한다. */
export function atomicWriteFilesSync(writes: AtomicFileWrite[]): void {
    if (writes.length === 0) return;
    const transactionId = `${process.pid}-${crypto.randomUUID()}`;
    const seen = new Set<string>();
    const staged: StagedFileWrite[] = [];
    try {
        for (let index = 0; index < writes.length; index++) {
            const file = path.resolve(writes[index].file);
            const collisionKey = process.platform === 'win32'
                ? file.normalize('NFC').toLowerCase()
                : file;
            if (seen.has(collisionKey)) {
                throw new Error(`atomic write target is duplicated: ${file}`);
            }
            seen.add(collisionKey);
            const parent = path.dirname(file);
            const linkedParent = findLinkedPathComponent(parent);
            if (linkedParent) {
                throw new Error(`atomic write parent crosses a symbolic link/junction: ${linkedParent}`);
            }
            const parentStat = fs.lstatSync(parent);
            if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
                throw new Error(`atomic write parent is not a regular directory: ${parent}`);
            }
            let originalStat: fs.Stats | undefined;
            if (fs.existsSync(file)) {
                originalStat = fs.lstatSync(file);
                if (originalStat.isSymbolicLink() || !originalStat.isFile()) {
                    throw new Error(`atomic write target is not a regular file: ${file}`);
                }
            }
            const temporary = path.join(parent, `.${path.basename(file)}.tmp-${transactionId}-${index}`);
            const backup = path.join(parent, `.${path.basename(file)}.old-${transactionId}-${index}`);
            fs.writeFileSync(temporary, writes[index].data, {
                flag: 'wx',
                ...(originalStat ? { mode: originalStat.mode } : {}),
            });
            staged.push({
                file,
                data: writes[index].data,
                temporary,
                backup,
                hadOriginal: originalStat !== undefined,
                installed: false,
            });
        }

        for (const entry of staged) {
            if (entry.hadOriginal) fs.renameSync(entry.file, entry.backup);
        }
        for (const entry of staged) {
            fs.renameSync(entry.temporary, entry.file);
            entry.installed = true;
        }
    } catch (error) {
        for (const entry of staged.slice().reverse()) {
            try {
                if (entry.installed && fs.existsSync(entry.file)) fs.rmSync(entry.file, { force: true });
            } catch { /* 아래의 원본 복구를 계속 시도한다. */ }
        }
        for (const entry of staged) {
            try {
                if (entry.hadOriginal && fs.existsSync(entry.backup) && !fs.existsSync(entry.file)) {
                    fs.renameSync(entry.backup, entry.file);
                }
            } catch { /* 원래 오류를 보존한다. */ }
        }
        for (const entry of staged) {
            try {
                if (fs.existsSync(entry.temporary)) fs.rmSync(entry.temporary, { force: true });
            } catch { /* 정리 실패는 원래 오류를 가리지 않는다. */ }
        }
        throw error;
    }

    for (const entry of staged) {
        try {
            if (fs.existsSync(entry.backup)) fs.rmSync(entry.backup, { force: true });
        } catch { /* 교체 완료 후 남은 backup은 복구 가능한 잔여물로 둔다. */ }
    }
}

/** data를 file에 원자적으로 기록한다. 실패 시 원본을 보존한다. */
export function atomicWriteFileSync(file: string, data: string | Buffer): void {
    atomicWriteFilesSync([{ file, data }]);
}

interface StagedArtifactReplacement {
    name: string;
    staged: string;
    target: string;
    backup: string;
    hadOriginal: boolean;
    installed: boolean;
}

function removeArtifactSync(target: string): void {
    if (!fs.existsSync(target)) return;
    const stat = fs.lstatSync(target);
    fs.rmSync(target, stat.isDirectory()
        ? { recursive: true, force: true }
        : { force: true });
}

function attachRecoveryError(primaryError: unknown, recoveryError: unknown): void {
    if (!(primaryError instanceof Error)) return;
    try {
        Object.defineProperty(primaryError, 'recoveryError', {
            value: recoveryError,
            enumerable: false,
            configurable: true,
        });
    } catch { /* 최초 오류를 그대로 보존한다. */ }
}

/** Replace a fixed set of sibling files/directories, restoring the whole old set on failure. */
export function replaceArtifactGroupSync(
    stagingRootPath: string,
    targetRootPath: string,
    artifactNames: string[],
): void {
    if (artifactNames.length === 0) return;
    const stagingRoot = path.resolve(stagingRootPath);
    const targetRoot = path.resolve(targetRootPath);
    const linkedRoot = findLinkedPathComponent(stagingRoot) ?? findLinkedPathComponent(targetRoot);
    if (linkedRoot) {
        throw new Error(`artifact replacement crosses a symbolic link/junction: ${linkedRoot}`);
    }
    for (const [label, root] of [['staging', stagingRoot], ['target', targetRoot]] as const) {
        const stat = fs.lstatSync(root);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(`${label} artifact root is not a regular directory: ${root}`);
        }
    }

    const transactionId = `${process.pid}-${crypto.randomUUID()}`;
    const seen = new Set<string>();
    const entries: StagedArtifactReplacement[] = [];
    for (let index = 0; index < artifactNames.length; index++) {
        const name = artifactNames[index];
        if (typeof name !== 'string' || name.length === 0 || path.basename(name) !== name || name.includes('\0')) {
            throw new Error(`invalid artifact name: ${String(name)}`);
        }
        const collisionKey = process.platform === 'win32' ? name.normalize('NFC').toLowerCase() : name;
        if (seen.has(collisionKey)) throw new Error(`artifact name is duplicated: ${name}`);
        seen.add(collisionKey);
        const staged = path.join(stagingRoot, name);
        const target = path.join(targetRoot, name);
        const backup = path.join(targetRoot, `.${name}.old-${transactionId}-${index}`);
        const stagedStat = fs.lstatSync(staged);
        if (stagedStat.isSymbolicLink() || (!stagedStat.isFile() && !stagedStat.isDirectory())) {
            throw new Error(`staged artifact is not a regular file/directory: ${staged}`);
        }
        let hadOriginal = false;
        if (fs.existsSync(target)) {
            const targetStat = fs.lstatSync(target);
            if (targetStat.isSymbolicLink() || (!targetStat.isFile() && !targetStat.isDirectory())) {
                throw new Error(`target artifact is not a regular file/directory: ${target}`);
            }
            hadOriginal = true;
        }
        if (fs.existsSync(backup)) throw new Error(`artifact backup path already exists: ${backup}`);
        entries.push({ name, staged, target, backup, hadOriginal, installed: false });
    }

    try {
        for (const entry of entries) {
            if (entry.hadOriginal) fs.renameSync(entry.target, entry.backup);
        }
        for (const entry of entries) {
            if (fs.existsSync(entry.target)) {
                throw new Error(`artifact target appeared during replacement: ${entry.target}`);
            }
            fs.renameSync(entry.staged, entry.target);
            entry.installed = true;
        }
    } catch (error) {
        for (const entry of entries.slice().reverse()) {
            if (!entry.installed || !fs.existsSync(entry.target)) continue;
            try {
                if (!fs.existsSync(entry.staged)) fs.renameSync(entry.target, entry.staged);
                else removeArtifactSync(entry.target);
            } catch { /* 아래의 원본 복구를 계속 시도한다. */ }
        }
        for (const entry of entries) {
            try {
                if (entry.hadOriginal && fs.existsSync(entry.backup) && !fs.existsSync(entry.target)) {
                    fs.renameSync(entry.backup, entry.target);
                }
            } catch { /* 원래 오류를 보존한다. */ }
        }
        throw error;
    }

    for (const entry of entries) {
        try {
            removeArtifactSync(entry.backup);
        } catch { /* 설치된 새 묶음은 유효하므로 복구 가능한 old backup을 남긴다. */ }
    }
}

/**
 * stagingDir의 트리를 targetDir로 원자적으로 교체한다.
 * 호출 전에 stagingDir 구축이 완료·검증되어 있어야 한다.
 */
export function replaceDirSync(stagingDir: string, targetDir: string): void {
    const staging = path.resolve(stagingDir);
    const target = path.resolve(targetDir);
    const stagingFromTarget = path.relative(target, staging);
    const targetFromStaging = path.relative(staging, target);
    const nested = (relative: string) => relative === ''
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    if (nested(stagingFromTarget) || nested(targetFromStaging)) {
        throw new Error('staging and target directories must not contain one another');
    }
    const stagingStat = fs.lstatSync(staging);
    if (stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) {
        throw new Error(`staging path is not a regular directory: ${staging}`);
    }
    const linkedStaging = findLinkedPathComponent(path.dirname(staging));
    const linkedTarget = findLinkedPathComponent(path.dirname(target));
    if (linkedStaging || linkedTarget) {
        throw new Error(`directory replacement crosses a symbolic link/junction: ${linkedStaging ?? linkedTarget}`);
    }
    const backupDir = path.join(
        path.dirname(target),
        `.${path.basename(target)}.old-${process.pid}-${crypto.randomUUID()}`,
    );
    const hadTarget = fs.existsSync(target);
    if (hadTarget) {
        const targetStat = fs.lstatSync(target);
        if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
            throw new Error(`target path is not a regular directory: ${target}`);
        }
        fs.renameSync(target, backupDir);
    }
    try {
        fs.renameSync(staging, target);
    } catch (err) {
        // 롤백
        if (hadTarget && fs.existsSync(backupDir) && !fs.existsSync(target)) {
            try {
                fs.renameSync(backupDir, target);
            } catch (recoveryError) {
                attachRecoveryError(err, recoveryError);
            }
        }
        throw err;
    }
    if (fs.existsSync(backupDir)) {
        try {
            fs.rmSync(backupDir, { recursive: true, force: true });
        } catch { /* 새 디렉터리는 이미 설치됐으므로 복구 가능한 backup을 남긴다. */ }
    }
}

/** parentDir 안에 쓰기를 위한 임시 스테이징 디렉터리를 만든다. */
export function makeStagingDir(parentDir: string, prefix: string): string {
    const parent = path.resolve(parentDir);
    const linkedParent = findLinkedPathComponent(parent);
    if (linkedParent) {
        throw new Error(`staging parent crosses a symbolic link/junction: ${linkedParent}`);
    }
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    const stat = fs.lstatSync(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`staging parent is not a regular directory: ${parent}`);
    }
    if (typeof prefix !== 'string' || prefix.length === 0 || path.basename(prefix) !== prefix) {
        throw new Error(`invalid staging prefix: ${prefix}`);
    }
    return fs.mkdtempSync(path.join(parent, `${prefix}.tmp-${process.pid}-`));
}
