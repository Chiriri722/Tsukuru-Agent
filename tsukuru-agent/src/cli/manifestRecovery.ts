/**
 * RPG MV/MZ의 오래되거나 손상된 manifest를 .extracteddata와 현재 Extract 텍스트로 복구한다.
 * 기존 manifest 원본은 같은 디렉터리에 보존하고 새 manifest만 원자적으로 교체한다.
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteFileSync, removePathBestEffortSync } from '../core/atomic';
import { ExtractManifest, MANIFEST_FILE, sha256Text } from '../core/manifest';
import { buildRpgManifest } from '../core/manifestBuild';
import { ErrorCodes, OperationError } from '../core/types';
import { resolveExtractArtifactPath } from './patcher';

const MAX_DATA_PATH_LENGTH = 16_384;
const UNSAFE_DATA_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export interface RpgManifestRecoveryOutcome {
    manifestPath: string;
    backupPath?: string;
    plannedBackupPath?: string;
    entries: number;
    files: number;
    hashesUpdated: number;
    dryRun: boolean;
    conflictPolicy: RpgManifestConflictPolicy;
    wouldReplaceExisting: boolean;
    wouldConflict: boolean;
}

export type RpgManifestConflictPolicy = 'backup-and-replace' | 'fail-if-present';

export interface RpgManifestRecoveryOptions {
    dryRun?: boolean;
    conflictPolicy?: RpgManifestConflictPolicy;
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

function assertBackupStringTarget(backup: unknown, dataPath: string, sourceFile: string): void {
    const segments = dataPath.split('.');
    let current: unknown = backup;
    for (const segment of segments) {
        if ((typeof current !== 'object' || current === null)
            || !Object.prototype.hasOwnProperty.call(current, segment)) {
            throw new OperationError(
                ErrorCodes.MAPPING_CORRUPT,
                `Backup JSON에서 RPG data path 대상을 찾을 수 없습니다: ${sourceFile}#${dataPath}`,
            );
        }
        current = (current as Record<string, unknown>)[segment];
    }
    if (typeof current !== 'string') {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            `Backup JSON의 RPG data path 대상은 문자열이어야 합니다: ${sourceFile}#${dataPath}`,
        );
    }
}

type RpgManifestEntry = ExtractManifest['entries'][number];

function assertUniqueEntryId(entry: RpgManifestEntry, ids: Set<string>): void {
    if (ids.has(entry.id)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata에 중복 ID가 있습니다: ${entry.id}`);
    }
    ids.add(entry.id);
}

function assertSafeDataPath(entry: RpgManifestEntry): void {
    const dataPath: unknown = entry.dataPath;
    if (typeof dataPath !== 'string' || dataPath.length === 0
        || dataPath.length > MAX_DATA_PATH_LENGTH || dataPath.includes('\0')
        || dataPath.split('.').some((segment) => segment.length === 0 || UNSAFE_DATA_SEGMENTS.has(segment))) {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            `RPG data path에 금지된 prototype 경로나 빈 세그먼트가 있습니다: ${entry.dataPath}`,
        );
    }
}

function loadValidatedBackup(
    dataDir: string,
    entry: RpgManifestEntry,
    validatedBackups: Map<string, unknown>,
): unknown {
    const sourcePath = resolveExtractArtifactPath(dataDir, entry.sourceFile);
    if (!fs.existsSync(sourcePath)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `Backup 원본 파일을 찾을 수 없습니다: ${entry.sourceFile}`);
    }
    const sourceStat = fs.lstatSync(sourcePath);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            `Backup 원본은 링크가 아닌 일반 파일이어야 합니다: ${entry.sourceFile}`,
        );
    }
    if (validatedBackups.has(sourcePath)) return validatedBackups.get(sourcePath);

    let backupSource = fs.readFileSync(sourcePath, 'utf8');
    if (backupSource.charCodeAt(0) === 0xFEFF) backupSource = backupSource.substring(1);
    try {
        const parsed = JSON.parse(backupSource);
        validatedBackups.set(sourcePath, parsed);
        return parsed;
    } catch (error) {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            `Backup JSON 파싱에 실패했습니다: ${entry.sourceFile}`,
            { cause: error instanceof Error ? error.message : String(error) },
        );
    }
}

function loadExtractLines(
    extractDir: string,
    entry: RpgManifestEntry,
    fileLines: Map<string, string[]>,
): string[] {
    const cached = fileLines.get(entry.extractFile);
    if (cached) return cached;
    const extractPath = resolveExtractArtifactPath(extractDir, entry.extractFile);
    if (!fs.existsSync(extractPath) || !fs.statSync(extractPath).isFile()) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `추출 텍스트 파일이 없습니다: ${entry.extractFile}`);
    }
    const lines = fs.readFileSync(extractPath, 'utf8').split('\n');
    fileLines.set(entry.extractFile, lines);
    return lines;
}

function assertValidLineMapping(entry: RpgManifestEntry, lines: string[]): void {
    if (!Number.isInteger(entry.lineStart) || !Number.isInteger(entry.lineEnd)
        || entry.lineStart < 0 || entry.lineEnd > lines.length || entry.lineStart >= entry.lineEnd) {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            `줄 매핑이 손상되었습니다: ${entry.id} (${entry.lineStart}..${entry.lineEnd} / ${lines.length}줄)`,
        );
    }
}

function refreshManifestHashes(
    manifest: ExtractManifest,
    dataDir: string,
    extractDir: string,
    oldHashes: Map<string, string>,
): { files: number; hashesUpdated: number } {
    const fileLines = new Map<string, string[]>();
    const validatedBackups = new Map<string, unknown>();
    const ids = new Set<string>();
    let hashesUpdated = 0;

    for (const entry of manifest.entries) {
        assertUniqueEntryId(entry, ids);
        assertSafeDataPath(entry);
        const backup = loadValidatedBackup(dataDir, entry, validatedBackups);
        const entryConf = entry.mv?.conf as { isComment?: boolean } | undefined;
        if (entryConf?.isComment !== true) {
            assertBackupStringTarget(backup, entry.dataPath, entry.sourceFile);
        }
        const lines = loadExtractLines(extractDir, entry, fileLines);
        assertValidLineMapping(entry, lines);
        const currentHash = sha256Text(lines.slice(entry.lineStart, entry.lineEnd).join('\n'));
        if (oldHashes.get(entry.id) !== currentHash) hashesUpdated++;
        entry.hash = currentHash;
    }
    return { files: fileLines.size, hashesUpdated };
}

function writeRecoveredManifest(
    manifestPath: string,
    manifest: ExtractManifest,
    oldRaw: Buffer | undefined,
    plannedBackupPath: string | undefined,
): string | undefined {
    let backupPath: string | undefined;
    let backupWritten = false;
    try {
        if (oldRaw && plannedBackupPath) {
            if (fs.existsSync(plannedBackupPath)) {
                throw new OperationError(
                    ErrorCodes.OUTPUT_CONFLICT,
                    'manifest 복구 백업 경로가 작업 중 충돌했습니다',
                    { backupPath: plannedBackupPath },
                );
            }
            backupPath = plannedBackupPath;
            atomicWriteFileSync(backupPath, oldRaw);
            backupWritten = true;
        }
        atomicWriteFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        return backupPath;
    } catch (error) {
        if (backupWritten && backupPath && fs.existsSync(backupPath)
            && fs.readFileSync(backupPath).equals(oldRaw!)) {
            removePathBestEffortSync(backupPath, { force: true });
        }
        throw error;
    }
}

/** dataDir은 Backup/Extract/.extracteddata를 포함하는 RPG 추출 팩 루트이다. */
export function recoverRpgManifest(
    dataDir: string,
    extractedMain: unknown,
    options: RpgManifestRecoveryOptions = {},
): RpgManifestRecoveryOutcome {
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
    const manifestPath = resolveExtractArtifactPath(extractDir, MANIFEST_FILE);
    const oldRaw = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : undefined;
    const dryRun = options.dryRun === true;
    const conflictPolicy = options.conflictPolicy ?? 'backup-and-replace';
    const wouldReplaceExisting = oldRaw !== undefined;
    const wouldConflict = wouldReplaceExisting && conflictPolicy === 'fail-if-present';
    const oldHashes = readOldHashes(oldRaw);
    const { files, hashesUpdated } = refreshManifestHashes(manifest, dataDir, extractDir, oldHashes);

    const plannedBackupPath = oldRaw && conflictPolicy === 'backup-and-replace'
        ? availableBackupPath(extractDir)
        : undefined;
    if (dryRun) {
        return {
            manifestPath,
            plannedBackupPath,
            entries: manifest.entries.length,
            files,
            hashesUpdated,
            dryRun,
            conflictPolicy,
            wouldReplaceExisting,
            wouldConflict,
        };
    }
    if (wouldConflict) {
        throw new OperationError(
            ErrorCodes.OUTPUT_CONFLICT,
            '기존 manifest가 있어 conflictPolicy=fail-if-present 복구를 중단했습니다',
            { manifestPath },
        );
    }

    const backupPath = writeRecoveredManifest(manifestPath, manifest, oldRaw, plannedBackupPath);
    return {
        manifestPath,
        backupPath,
        entries: manifest.entries.length,
        files,
        hashesUpdated,
        dryRun,
        conflictPolicy,
        wouldReplaceExisting,
        wouldConflict,
    };
}
