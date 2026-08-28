import fs from 'fs';
import path from 'path';
import { ExtractManifest, MANIFEST_FILE } from './manifest';
import { PatchEntry } from './schema';
import { ErrorCodes, OperationError } from './types';
import { readExtractManifest } from './contracts/manifestContract';
import { resolveContainedPathWithoutLinks } from './pathSafety';

export interface TranslationDictionaryStats {
    files: number;
    entries: number;
    selected: number;
    skippedUnknown: number;
    skippedBlank: number;
    skippedUnchanged: number;
    skippedComment: number;
}

export interface TranslationDictionaryOutcome {
    patches: PatchEntry[];
    stats: TranslationDictionaryStats;
    warnings: string[];
}

const MAX_DICTIONARY_FILE_BYTES = 64 * 1024 * 1024;

function resolveDictionaryExtractPath(extractDir: string, relativePath: unknown): string {
    const resolution = resolveContainedPathWithoutLinks(extractDir, relativePath);
    if (resolution.ok === false && resolution.reason === 'linked') {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            `추출 파일 경로에 심볼릭 링크/정션이 있습니다: ${String(relativePath)}`,
        );
    }
    if (resolution.ok === false && resolution.reason === 'outside') {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `Extract 폴더 밖을 가리키는 경로입니다: ${String(relativePath)}`);
    }
    if (resolution.ok === false) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `안전하지 않은 추출 파일 경로입니다: ${String(relativePath)}`);
    }
    return resolution.path;
}

/** RPG manifest ID를 키로 사용하는 최상위 *_trans.json 사전을 안전한 patch 목록으로 변환한다. */
export function loadRpgTranslationDictionary(extractDir: string, translationDirectory: string): TranslationDictionaryOutcome {
    const stat = fs.existsSync(translationDirectory) ? fs.lstatSync(translationDirectory) : null;
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
        throw new OperationError(ErrorCodes.PATH_NOT_FOUND, 'translationDirectory가 유효한 디렉터리가 아닙니다', { translationDirectory });
    }
    const manifestPath = resolveDictionaryExtractPath(extractDir, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) {
        throw new OperationError(ErrorCodes.MANIFEST_MISSING, 'manifest.json이 없습니다', { manifestPath });
    }
    const manifest: ExtractManifest = readExtractManifest(manifestPath);
    if (manifest.format !== 'rpgmv' || !Array.isArray(manifest.entries)) {
        throw new OperationError(ErrorCodes.FORMAT_MISMATCH, 'RPG MV/MZ manifest만 번역 사전 자동 조립을 지원합니다');
    }
    const byId = new Map<string, ExtractManifest['entries'][number]>();
    for (const entry of manifest.entries) {
        if (byId.has(entry.id)) {
            throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, `manifest에 중복 id가 있습니다: ${entry.id}`);
        }
        byId.set(entry.id, entry);
    }
    const files = fs.readdirSync(translationDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && !entry.name.startsWith('._') && entry.name.endsWith('_trans.json'))
        .map((entry) => entry.name)
        .sort();
    if (files.length === 0) {
        throw new OperationError(ErrorCodes.PATCH_EMPTY, 'translationDirectory에 *_trans.json 파일이 없습니다', { translationDirectory });
    }
    const stats: TranslationDictionaryStats = {
        files: files.length,
        entries: 0,
        selected: 0,
        skippedUnknown: 0,
        skippedBlank: 0,
        skippedUnchanged: 0,
        skippedComment: 0,
    };
    const seen = new Set<string>();
    const patches: PatchEntry[] = [];
    const fileLines = new Map<string, string[]>();
    for (const file of files) {
        const filePath = path.join(translationDirectory, file);
        if (fs.statSync(filePath).size > MAX_DICTIONARY_FILE_BYTES) {
            throw new OperationError(ErrorCodes.REQUEST_INVALID, `번역 사전 파일이 너무 큽니다: ${file}`);
        }
        let dictionary: unknown;
        try {
            dictionary = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {
            throw new OperationError(ErrorCodes.REQUEST_INVALID, `번역 사전 JSON 파싱에 실패했습니다: ${file}`);
        }
        if (typeof dictionary !== 'object' || dictionary === null || Array.isArray(dictionary)) {
            throw new OperationError(ErrorCodes.REQUEST_INVALID, `번역 사전은 JSON 객체여야 합니다: ${file}`);
        }
        for (const [id, text] of Object.entries(dictionary)) {
            stats.entries += 1;
            if (seen.has(id)) {
                throw new OperationError(ErrorCodes.PATCH_DUPLICATE_ID, `번역 사전에 중복 id가 있습니다: ${id}`);
            }
            seen.add(id);
            if (typeof text !== 'string') {
                throw new OperationError(ErrorCodes.REQUEST_INVALID, `번역 사전 값은 문자열이어야 합니다: ${file} / ${id}`);
            }
            const entry = byId.get(id);
            if (!entry) {
                stats.skippedUnknown += 1;
                continue;
            }
            const conf = entry.mv?.conf as { isComment?: boolean } | undefined;
            if (conf?.isComment) {
                stats.skippedComment += 1;
                continue;
            }
            if (text.length === 0) {
                stats.skippedBlank += 1;
                continue;
            }
            if (!fileLines.has(entry.extractFile)) {
                const extractPath = resolveDictionaryExtractPath(extractDir, entry.extractFile);
                if (!fs.existsSync(extractPath)) {
                    throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `추출 텍스트 파일이 없습니다: ${entry.extractFile}`);
                }
                fileLines.set(entry.extractFile, fs.readFileSync(extractPath, 'utf8').split('\n'));
            }
            const lines = fileLines.get(entry.extractFile)!;
            if (entry.lineStart < 0 || entry.lineEnd > lines.length || entry.lineStart >= entry.lineEnd) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `줄 매핑이 손상되었습니다: ${id}`);
            }
            const current = lines.slice(entry.lineStart, entry.lineEnd).join('\n');
            if (text === current) {
                stats.skippedUnchanged += 1;
                continue;
            }
            patches.push({ id, expectedHash: entry.hash, text });
            stats.selected += 1;
        }
    }
    const warnings: string[] = [];
    if (stats.skippedUnknown > 0) warnings.push(`manifest에 없는 번역 사전 항목 ${stats.skippedUnknown}개를 건너뛰었습니다`);
    if (stats.skippedBlank > 0) warnings.push(`빈 번역 사전 항목 ${stats.skippedBlank}개를 건너뛰었습니다`);
    if (stats.skippedComment > 0) warnings.push(`주석 번역 사전 항목 ${stats.skippedComment}개를 건너뛰었습니다`);
    return { patches, stats, warnings };
}
