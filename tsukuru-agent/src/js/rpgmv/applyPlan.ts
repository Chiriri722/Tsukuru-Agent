import fs from 'fs';
import path from 'path';
import { readExtractManifest } from '../../core/contracts/manifestContract';
import { ExtractManifest, MANIFEST_FILE } from '../../core/manifest';
import { resolveContainedPathWithoutLinks } from '../../core/pathSafety';
import { ErrorCodes, OperationError } from '../../core/types';
import * as edTool from './edtool';

const MAX_BUCKETS = 100_000;
const MAX_ENTRIES = 2_000_000;
const MAX_TEXT_FILE_BYTES = 512 * 1024 * 1024;
const MAX_DATA_PATH_LENGTH = 16_384;
const UNSAFE_DATA_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const WINDOWS_RESERVED_STEM = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

type JsonRecord = Record<string, any>;

export interface RpgApplyEntry {
    start: number;
    end: number;
    originFile: string;
    dataPath: string;
    qpath: string;
    conf?: JsonRecord;
}

export interface RpgApplyBucket {
    name: string;
    extractFile: string;
    lines: string[];
    entries: RpgApplyEntry[];
}

export interface RpgApplyPlan {
    dataRoot: string;
    extractRoot: string;
    backupRoot: string;
    extractedDataPath: string;
    buckets: RpgApplyBucket[];
    backups: Map<string, unknown>;
    manifestPath?: string;
}

function corrupt(message: string, details?: unknown): OperationError {
    return new OperationError(ErrorCodes.MAPPING_CORRUPT, message, details);
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveSafeChild(root: string, relativePath: string, label: string): string {
    const resolved = resolveContainedPathWithoutLinks(root, relativePath);
    if (resolved.ok === false) {
        throw corrupt(`${label} 경로가 작업 루트를 벗어나거나 링크를 통과합니다`, {
            root,
            relativePath,
            reason: resolved.reason,
        });
    }
    return resolved.path;
}

function requireDirectory(root: string, relativePath: string, label: string): string {
    const resolved = resolveSafeChild(root, relativePath, label);
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(resolved);
    } catch (error) {
        throw corrupt(`${label} 디렉터리를 찾을 수 없습니다`, {
            path: resolved,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw corrupt(`${label}은 링크가 아닌 디렉터리여야 합니다`, { path: resolved });
    }
    return resolved;
}

function requireRegularFile(root: string, relativePath: string, label: string): string {
    const resolved = resolveSafeChild(root, relativePath, label);
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(resolved);
    } catch (error) {
        throw corrupt(`${label} 파일을 찾을 수 없습니다`, {
            path: resolved,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw corrupt(`${label}은 링크가 아닌 일반 파일이어야 합니다`, { path: resolved });
    }
    return resolved;
}

function isSafeJsonFileName(fileName: unknown): fileName is string {
    if (typeof fileName !== 'string' || fileName.length === 0 || fileName.includes('\0')) return false;
    if (fileName.includes('/') || fileName.includes('\\') || path.basename(fileName) !== fileName) return false;
    if (!fileName.endsWith('.json') || fileName === '.json') return false;
    const stem = fileName.slice(0, -'.json'.length);
    if (stem.endsWith('.') || stem.endsWith(' ') || WINDOWS_RESERVED_STEM.test(stem)) return false;
    return true;
}

function normalizedCollisionKey(value: string): string {
    return value.normalize('NFC').toLowerCase();
}

function registerWithoutAlias(
    value: string,
    seen: Map<string, string>,
    label: string,
): void {
    const key = normalizedCollisionKey(value);
    const existing = seen.get(key);
    if (existing !== undefined && existing !== value) {
        throw corrupt(`${label}에 대소문자 또는 유니코드 별칭 충돌이 있습니다`, {
            first: existing,
            second: value,
        });
    }
    seen.set(key, value);
}

function validateDataPath(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_DATA_PATH_LENGTH || value.includes('\0')) {
        throw corrupt('.extracteddata data path가 올바르지 않습니다', { dataPath: value });
    }
    const segments = value.split('.');
    if (segments.some((segment) => segment.length === 0 || UNSAFE_DATA_SEGMENTS.has(segment))) {
        throw corrupt('.extracteddata data path에 금지된 prototype 경로가 포함되어 있습니다', {
            dataPath: value,
        });
    }
    return value;
}

function parseBackup(backupRoot: string, fileName: string): unknown {
    const backupPath = requireRegularFile(backupRoot, fileName, 'RPG Backup 원본');
    let source = fs.readFileSync(backupPath, 'utf8');
    if (source.charCodeAt(0) === 0xFEFF) source = source.substring(1);
    try {
        return JSON.parse(source);
    } catch {
        throw corrupt('RPG Backup JSON 파싱에 실패했습니다', {
            fileName,
            cause: 'JSON_PARSE_ERROR',
        });
    }
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isRecord(value)) return value;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
    return result;
}

function canonicalJson(value: unknown): string {
    return value === undefined ? '<undefined>' : JSON.stringify(canonicalize(value));
}

function mappingCoreSignature(bucket: RpgApplyBucket, entry: RpgApplyEntry): string {
    return JSON.stringify([
        `${entry.originFile}#${entry.dataPath}`,
        `Backup/${entry.originFile}`,
        entry.dataPath,
        bucket.extractFile,
        entry.start,
        entry.end,
    ]);
}

function manifestCoreSignature(entry: ExtractManifest['entries'][number]): string {
    return JSON.stringify([
        entry.id,
        entry.sourceFile.replaceAll('\\', '/'),
        entry.dataPath,
        entry.extractFile.replaceAll('\\', '/'),
        entry.lineStart,
        entry.lineEnd,
    ]);
}

function isExtractionOnlyComment(entry: RpgApplyEntry): boolean {
    return isRecord(entry.conf) && entry.conf.isComment === true;
}

function manifestMetadataMatches(
    manifestEntry: ExtractManifest['entries'][number],
    mappingEntry: RpgApplyEntry,
): boolean {
    if (!manifestEntry.mv) return true;
    const metadata = manifestEntry.mv as Partial<NonNullable<typeof manifestEntry.mv>>;
    if (metadata.qpath !== undefined && metadata.qpath !== mappingEntry.qpath) return false;
    if (metadata.conf !== undefined && canonicalJson(metadata.conf) !== canonicalJson(mappingEntry.conf)) return false;
    if (metadata.endLine !== undefined && metadata.endLine !== mappingEntry.end) return false;
    if (metadata.originFile !== undefined && metadata.originFile !== mappingEntry.originFile) return false;
    return true;
}

function validateManifestConsistency(manifest: ExtractManifest, buckets: RpgApplyBucket[]): void {
    if (manifest.format !== 'rpgmv') {
        throw corrupt('RPG .extracteddata와 manifest 형식이 일치하지 않습니다', {
            manifestFormat: manifest.format,
        });
    }
    const expected = new Map<string, { entry: RpgApplyEntry; optional: boolean }>();
    let requiredEntries = 0;
    for (const bucket of buckets) {
        for (const entry of bucket.entries) {
            const signature = mappingCoreSignature(bucket, entry);
            const optional = isExtractionOnlyComment(entry);
            expected.set(signature, { entry, optional });
            if (!optional) requiredEntries++;
        }
    }
    if (manifest.entries.length < requiredEntries || manifest.entries.length > expected.size) {
        throw corrupt('RPG .extracteddata와 manifest 항목 수가 일치하지 않습니다', {
            mappingEntries: expected.size,
            requiredMappingEntries: requiredEntries,
            optionalCommentEntries: expected.size - requiredEntries,
            manifestEntries: manifest.entries.length,
        });
    }
    for (const entry of manifest.entries) {
        const signature = manifestCoreSignature(entry);
        const candidate = expected.get(signature);
        if (!candidate || !manifestMetadataMatches(entry, candidate.entry)) {
            throw corrupt('RPG .extracteddata와 manifest 매핑이 일치하지 않습니다', {
                manifestEntry: entry.id,
            });
        }
        expected.delete(signature);
    }
    const missingRequired = Array.from(expected.values()).filter((candidate) => !candidate.optional);
    if (missingRequired.length !== 0) {
        throw corrupt('RPG .extracteddata에 manifest와 다른 필수 매핑이 남아 있습니다', {
            missingEntries: missingRequired.length,
        });
    }
}

function readOptionalManifest(extractRoot: string): { manifest?: ExtractManifest; manifestPath?: string } {
    const resolution = resolveContainedPathWithoutLinks(extractRoot, MANIFEST_FILE);
    if (resolution.ok === false) {
        throw corrupt('RPG manifest 경로가 링크를 통과하거나 Extract를 벗어납니다', {
            reason: resolution.reason,
        });
    }
    if (!fs.existsSync(resolution.path)) return {};
    const stat = fs.lstatSync(resolution.path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw corrupt('RPG manifest는 링크가 아닌 일반 파일이어야 합니다', {
            manifestPath: resolution.path,
        });
    }
    return { manifest: readExtractManifest(resolution.path), manifestPath: resolution.path };
}

export function loadRpgApplyPlan(dataDir: string): RpgApplyPlan {
    const dataRoot = path.resolve(dataDir);
    const extractRoot = requireDirectory(dataRoot, 'Extract', 'RPG Extract');
    const backupRoot = requireDirectory(dataRoot, 'Backup', 'RPG Backup');
    const extractedDataPath = requireRegularFile(dataRoot, '.extracteddata', 'RPG .extracteddata');
    const mapping = edTool.readFile(extractedDataPath);
    const bucketNames = Object.keys(mapping.main);
    if (bucketNames.length === 0 || bucketNames.length > MAX_BUCKETS) {
        throw corrupt('.extracteddata bucket 수가 올바르지 않습니다', {
            maximum: MAX_BUCKETS,
            observed: bucketNames.length,
        });
    }

    const bucketAliases = new Map<string, string>();
    const originAliases = new Map<string, string>();
    const extractAliases = new Map<string, string>();
    const origins = new Set<string>();
    const identities = new Set<string>();
    const buckets: RpgApplyBucket[] = [];
    let entryCount = 0;

    for (const bucketName of bucketNames) {
        if (!isSafeJsonFileName(bucketName)) {
            throw corrupt('.extracteddata bucket 이름이 안전한 JSON 파일명이 아닙니다', { bucketName });
        }
        registerWithoutAlias(bucketName, bucketAliases, '.extracteddata bucket');
        const rawBucket = mapping.main[bucketName];
        if (!isRecord(rawBucket) || !isRecord(rawBucket.data)) {
            throw corrupt('.extracteddata bucket data 구조가 올바르지 않습니다', { bucketName });
        }
        const lineKeys = Object.keys(rawBucket.data);
        if (lineKeys.length === 0) {
            throw corrupt('.extracteddata bucket에 적용할 항목이 없습니다', { bucketName });
        }
        const extractFile = bucketName === 'ext_javascript.json'
            ? 'ext_javascript.js'
            : `${path.parse(bucketName).name}.txt`;
        registerWithoutAlias(extractFile, extractAliases, 'RPG Extract 파일');
        const extractPath = requireRegularFile(extractRoot, extractFile, 'RPG Extract 텍스트');
        const extractStat = fs.lstatSync(extractPath);
        if (extractStat.size > MAX_TEXT_FILE_BYTES) {
            throw corrupt('RPG Extract 텍스트가 허용 크기를 초과했습니다', {
                extractFile,
                maximum: MAX_TEXT_FILE_BYTES,
                observed: extractStat.size,
            });
        }
        const lines = fs.readFileSync(extractPath, 'utf8').split('\n');
        const entries: RpgApplyEntry[] = [];

        for (const lineKey of lineKeys) {
            if (!/^(0|[1-9]\d*)$/.test(lineKey)) {
                throw corrupt('.extracteddata 줄 시작 위치가 정수가 아닙니다', { bucketName, lineKey });
            }
            const start = Number(lineKey);
            const rawEntry = rawBucket.data[lineKey];
            if (!isRecord(rawEntry)) {
                throw corrupt('.extracteddata 줄 매핑 항목이 JSON 객체가 아닙니다', { bucketName, lineKey });
            }
            const end = rawEntry.m;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
                || start < 0 || end <= start || end > lines.length) {
                throw corrupt('.extracteddata 줄 범위가 손상되었습니다', {
                    bucketName,
                    lineKey,
                    end,
                    availableLines: lines.length,
                });
            }
            const originFile = rawEntry.origin ?? bucketName;
            if (!isSafeJsonFileName(originFile)) {
                throw corrupt('.extracteddata origin 경로가 안전한 JSON 파일명이 아닙니다', {
                    bucketName,
                    lineKey,
                    originFile,
                });
            }
            registerWithoutAlias(originFile, originAliases, '.extracteddata origin');
            const dataPath = validateDataPath(rawEntry.val);
            if (rawEntry.conf !== undefined && !isRecord(rawEntry.conf)) {
                throw corrupt('.extracteddata conf가 JSON 객체가 아닙니다', { bucketName, lineKey });
            }
            if (rawEntry.qpath !== undefined && typeof rawEntry.qpath !== 'string') {
                throw corrupt('.extracteddata qpath가 문자열이 아닙니다', { bucketName, lineKey });
            }
            const identity = `${originFile}#${dataPath}`;
            if (identities.has(identity)) {
                throw corrupt('.extracteddata에 중복 데이터 ID가 있습니다', { identity });
            }
            identities.add(identity);
            origins.add(originFile);
            entries.push({
                start,
                end,
                originFile,
                dataPath,
                qpath: rawEntry.qpath ?? '',
                conf: rawEntry.conf,
            });
            entryCount++;
            if (entryCount > MAX_ENTRIES) {
                throw corrupt('.extracteddata 항목 수가 허용 한도를 초과했습니다', {
                    maximum: MAX_ENTRIES,
                    observed: entryCount,
                });
            }
        }
        buckets.push({ name: bucketName, extractFile, lines, entries });
    }

    const backups = new Map<string, unknown>();
    for (const origin of origins) backups.set(origin, parseBackup(backupRoot, origin));

    const { manifest, manifestPath } = readOptionalManifest(extractRoot);
    if (manifest) validateManifestConsistency(manifest, buckets);

    return {
        dataRoot,
        extractRoot,
        backupRoot,
        extractedDataPath,
        buckets,
        backups,
        manifestPath,
    };
}

export function readRpgDataPath(target: unknown, dataPath: string): string {
    const segments = validateDataPath(dataPath).split('.');
    let current: any = target;
    for (let index = 0; index < segments.length; index++) {
        if ((typeof current !== 'object' || current === null)) {
            throw corrupt('RPG Backup 구조가 .extracteddata data path와 일치하지 않습니다', {
                dataPath,
                segment: segments[index],
            });
        }
        const segment = segments[index];
        if (!Object.prototype.hasOwnProperty.call(current, segment)) {
            throw corrupt('RPG Backup에 .extracteddata data path가 존재하지 않습니다', {
                dataPath,
                segment,
            });
        }
        if (index === segments.length - 1) {
            if (typeof current[segment] !== 'string') {
                throw corrupt('RPG Backup의 번역 대상이 문자열이 아닙니다', { dataPath });
            }
            return current[segment];
        } else {
            current = current[segment];
        }
    }
    throw corrupt('RPG data path가 비어 있습니다');
}

export function setRpgDataPath(target: unknown, dataPath: string, value: string): void {
    readRpgDataPath(target, dataPath);
    const segments = dataPath.split('.');
    let current: any = target;
    for (const segment of segments.slice(0, -1)) current = current[segment];
    current[segments[segments.length - 1]] = value;
}
