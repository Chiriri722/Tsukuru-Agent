/**
 * RPG MV/MZ의 오래되거나 손상된 manifest를 .extracteddata와 현재 Extract 텍스트로 복구한다.
 * 기존 manifest 원본은 같은 디렉터리에 보존하고 새 manifest만 원자적으로 교체한다.
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteFileSync } from '../core/atomic';
import { ExtractManifest, MANIFEST_FILE, sha256Text } from '../core/manifest';
import { buildRpgManifest } from '../core/manifestBuild';
import { ErrorCodes, OperationError } from '../core/types';
import { resolveExtractArtifactPath } from './patcher';

export interface RpgManifestRecoveryOutcome {
    manifestPath: string;
    backupPath?: string;
    entries: number;
    files: number;
    hashesUpdated: number;
}

function availableBackupPath(extractDir: string): string {
    const base = path.join(extractDir, 'manifest.pre-recovery.json');
    if (!fs.existsSync(base)) return base;
    for (let suffix = 1; suffix < 10_000; suffix++) {
        const candidate = path.join(extractDir, `manifest.pre-recovery.${suffix}.json`);
        if (!fs.existsSync(candidate)) return candidate;
    }
    throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, 'manifest 복구 백업 파일 이름을 확보할 수 없습니다');
}

function readOldHashes(raw: Buffer | undefined): Map<string, string> {
    if (!raw) return new Map();
    try {
        const parsed = JSON.parse(raw.toString('utf8')) as Partial<ExtractManifest>;
        if (!Array.isArray(parsed.entries)) return new Map();
        return new Map(parsed.entries
            .filter((entry) => typeof entry?.id === 'string' && typeof entry?.hash === 'string')
            .map((entry) => [entry.id, entry.hash]));
    } catch {
        return new Map();
    }
}

/** dataDir은 Backup/Extract/.extracteddata를 포함하는 RPG 추출 팩 루트이다. */
export function recoverRpgManifest(dataDir: string, extractedMain: unknown): RpgManifestRecoveryOutcome {
    if (typeof extractedMain !== 'object' || extractedMain === null || Array.isArray(extractedMain)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, '.extracteddata의 main 매핑이 올바르지 않습니다');
    }
    const extractDir = path.join(dataDir, 'Extract');
    if (!fs.existsSync(extractDir) || !fs.statSync(extractDir).isDirectory()) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'Extract 디렉터리가 없습니다', { extractDir });
    }

    const manifest = buildRpgManifest(extractedMain as Parameters<typeof buildRpgManifest>[0]);
    if (manifest.entries.length === 0) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, '.extracteddata에 복구할 manifest 항목이 없습니다');
    }
    const manifestPath = path.join(extractDir, MANIFEST_FILE);
    const oldRaw = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : undefined;
    const oldHashes = readOldHashes(oldRaw);
    const fileLines = new Map<string, string[]>();
    const ids = new Set<string>();
    let hashesUpdated = 0;

    for (const entry of manifest.entries) {
        if (ids.has(entry.id)) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata에 중복 ID가 있습니다: ${entry.id}`);
        }
        ids.add(entry.id);
        const sourcePath = path.resolve(dataDir, entry.sourceFile);
        const relativeSource = path.relative(path.resolve(dataDir), sourcePath);
        if (!relativeSource || relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource) || !fs.existsSync(sourcePath)) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `Backup 원본 파일을 찾을 수 없습니다: ${entry.sourceFile}`);
        }
        if (!fileLines.has(entry.extractFile)) {
            const extractPath = resolveExtractArtifactPath(extractDir, entry.extractFile);
            if (!fs.existsSync(extractPath) || !fs.statSync(extractPath).isFile()) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `추출 텍스트 파일이 없습니다: ${entry.extractFile}`);
            }
            fileLines.set(entry.extractFile, fs.readFileSync(extractPath, 'utf8').split('\n'));
        }
        const lines = fileLines.get(entry.extractFile)!;
        if (!Number.isInteger(entry.lineStart) || !Number.isInteger(entry.lineEnd)
            || entry.lineStart < 0 || entry.lineEnd > lines.length || entry.lineStart >= entry.lineEnd) {
            throw new OperationError(
                ErrorCodes.MAPPING_CORRUPT,
                `줄 매핑이 손상되었습니다: ${entry.id} (${entry.lineStart}..${entry.lineEnd} / ${lines.length}줄)`,
            );
        }
        const currentHash = sha256Text(lines.slice(entry.lineStart, entry.lineEnd).join('\n'));
        if (oldHashes.get(entry.id) !== currentHash) hashesUpdated++;
        entry.hash = currentHash;
    }

    let backupPath: string | undefined;
    if (oldRaw) {
        backupPath = availableBackupPath(extractDir);
        atomicWriteFileSync(backupPath, oldRaw);
    }
    atomicWriteFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return {
        manifestPath,
        backupPath,
        entries: manifest.entries.length,
        files: fileLines.size,
        hashesUpdated,
    };
}
