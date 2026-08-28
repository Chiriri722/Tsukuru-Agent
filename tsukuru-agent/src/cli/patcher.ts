/**
 * patch 작업 구현 (계획서 §CLI 계약 및 §Manifest와 안전성).
 * - id/expectedHash 검증 후 추출 작업본(txt)만 수정한다(원본·Backup 불변).
 * - 해시 불일치·중복 ID·매핑 손상이 하나라도 있으면 아무것도 변경하지 않는다.
 * - 여러 줄 치환 후에는 manifest와 .extracteddata의 줄 매핑을 재생성한다.
 * - 모든 기록은 하나의 rollback 가능한 원자적 파일 배치로 교체한다.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { encode, decode } from '@msgpack/msgpack';
import { OperationError, ErrorCodes } from '../core/types';
import { ExtractManifest, ManifestEntry, MANIFEST_FILE, sha256Text } from '../core/manifest';
import { PatchEntry } from '../core/schema';
import { AtomicFileWrite, atomicWriteFilesSync } from '../core/atomic';
import { DetectedFormat } from '../core/schema';
import { readExtractManifest } from '../core/contracts/manifestContract';
import { resolveContainedPathWithoutLinks } from '../core/pathSafety';
import * as edTool from '../js/rpgmv/edtool';

export interface PatchOutcome {
    patched: number;
    files: number;
}

export function resolveExtractArtifactPath(extractDir: string, relativePath: unknown): string {
    const resolution = resolveContainedPathWithoutLinks(extractDir, relativePath);
    if (resolution.ok === false && resolution.reason === 'linked') {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            `추출 파일 경로에 심볼릭 링크/정션이 있습니다: ${String(relativePath)}`,
        );
    }
    if (resolution.ok === false && resolution.reason === 'outside') {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `추출 폴더 밖을 가리키는 경로입니다: ${String(relativePath)}`);
    }
    if (resolution.ok === false) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `안전하지 않은 추출 파일 경로입니다: ${String(relativePath)}`);
    }
    return resolution.path;
}

/** extractDir(Extract/ 또는 _Extract/) 안의 작업본에 patches를 적용한다. */
export function applyPatches(extractDir: string, format: DetectedFormat, patches: PatchEntry[]): PatchOutcome {
    // 1. manifest 로드
    const manifestPath = resolveExtractArtifactPath(extractDir, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) {
        throw new OperationError(ErrorCodes.MANIFEST_MISSING, 'manifest.json이 없습니다. 먼저 extract를 실행하세요', { manifestPath });
    }
    const manifest: ExtractManifest = readExtractManifest(manifestPath);
    if (manifest.format !== format) {
        throw new OperationError(ErrorCodes.FORMAT_MISMATCH, `manifest 포맷(${manifest.format})과 실제 포맷(${format})이 다릅니다`);
    }

    // 2. ID 검증(중복·존재·주석 여부)
    const seen = new Set<string>();
    for (const p of patches) {
        if (seen.has(p.id)) {
            throw new OperationError(ErrorCodes.PATCH_DUPLICATE_ID, `중복 patch id입니다: ${p.id}`);
        }
        seen.add(p.id);
    }
    const byId = new Map<string, ManifestEntry>();
    for (const e of manifest.entries) {
        if (byId.has(e.id)) {
            throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, `manifest에 중복 id가 있습니다: ${e.id}`);
        }
        byId.set(e.id, e);
    }
    for (const p of patches) {
        const e = byId.get(p.id);
        if (!e) {
            throw new OperationError(ErrorCodes.PATCH_NOT_FOUND, `patch id를 찾을 수 없습니다: ${p.id}`);
        }
        const conf = e.mv?.conf as { isComment?: boolean } | undefined;
        if (conf?.isComment) {
            throw new OperationError(ErrorCodes.PATCH_NOT_FOUND, `주석 항목은 patch할 수 없습니다: ${p.id}`);
        }
    }

    // 3. 사전 해시·매핑 검증(어떤 쓰기보다 먼저 전부 검사)
    const fileLines = new Map<string, string[]>();
    const readLines = (rel: string): string[] => {
        if (!fileLines.has(rel)) {
            const fp = resolveExtractArtifactPath(extractDir, rel);
            if (!fs.existsSync(fp)) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `추출 텍스트 파일이 없습니다: ${rel}`);
            }
            fileLines.set(rel, fs.readFileSync(fp, 'utf8').split('\n'));
        }
        return fileLines.get(rel)!;
    };
    for (const p of patches) {
        const e = byId.get(p.id)!;
        const lines = readLines(e.extractFile);
        if (e.lineStart < 0 || e.lineEnd > lines.length || e.lineStart >= e.lineEnd) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `줄 매핑이 손상되었습니다: ${p.id} (${e.lineStart}..${e.lineEnd} / ${lines.length}줄)`);
        }
        const current = lines.slice(e.lineStart, e.lineEnd).join('\n');
        if (sha256Text(current) !== p.expectedHash) {
            throw new OperationError(ErrorCodes.PATCH_HASH_MISMATCH, `원문 해시가 일치하지 않습니다: ${p.id}`, { id: p.id });
        }
    }
    const byFile = new Map<string, { p: PatchEntry; e: ManifestEntry }[]>();
    for (const p of patches) {
        const e = byId.get(p.id)!;
        const arr = byFile.get(e.extractFile) ?? [];
        arr.push({ p, e });
        byFile.set(e.extractFile, arr);
    }
    for (const [file, arr] of byFile) {
        const sorted = arr.slice().sort((a, b) => a.e.lineStart - b.e.lineStart);
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].e.lineStart < sorted[i - 1].e.lineEnd) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `patch 범위가 겹칩니다: ${file}`);
            }
        }
    }

    // 4. 작업본 수정(파일별 lineStart 내림차순 스플라이스로 앞쪽 줄 번호 보존)
    for (const [file, arr] of byFile) {
        const lines = readLines(file);
        for (const { p, e } of arr.slice().sort((a, b) => b.e.lineStart - a.e.lineStart)) {
            lines.splice(e.lineStart, e.lineEnd - e.lineStart, ...p.text.split('\n'));
        }
    }

    // 5. manifest 줄 매핑·해시 재생성(파일별 delta walk)
    for (const [file, arr] of byFile) {
        const fileEntries = manifest.entries.filter((e) => e.extractFile === file).sort((a, b) => a.lineStart - b.lineStart);
        const patchById = new Map(arr.map((x) => [x.e.id, x.p.text.split('\n')]));
        let delta = 0;
        for (const e of fileEntries) {
            const oldStart = e.lineStart;
            const oldLen = e.lineEnd - oldStart;
            e.lineStart = oldStart + delta;
            const newText = patchById.get(e.id);
            if (newText !== undefined) {
                e.lineEnd = e.lineStart + newText.length;
                e.hash = sha256Text(newText.join('\n'));
                delta += newText.length - oldLen;
            } else {
                e.lineEnd = e.lineStart + oldLen;
            }
            if (e.mv) e.mv.endLine = e.lineEnd;
        }
    }

    // 6. .extracteddata 줄 매핑 재생성 + 모든 산출물의 단일 rollback 배치 기록
    const writes: AtomicFileWrite[] = [];
    const mappingWrite = regenerateExtractedData(extractDir, format, manifest, byFile);
    if (mappingWrite) writes.push(mappingWrite);
    for (const [file, lines] of fileLines) {
        if (byFile.has(file)) {
            writes.push({ file: resolveExtractArtifactPath(extractDir, file), data: lines.join('\n') });
        }
    }
    writes.push({ file: manifestPath, data: JSON.stringify(manifest, null, 2) });
    atomicWriteFilesSync(writes);
    return { patched: patches.length, files: byFile.size };
}

/** .extracteddata의 줄 매핑을 갱신된 manifest 기준으로 재생성한다. */
function regenerateExtractedData(
    extractDir: string,
    format: DetectedFormat,
    manifest: ExtractManifest,
    byFile: Map<string, { p: PatchEntry; e: ManifestEntry }[]>,
): AtomicFileWrite | undefined {
    if (format === 'tyrano' || format === 'gdevelop') {
        // Tyrano/GDevelop manifest 자체가 원본 위치 매핑을 보유하므로 별도 legacy mapping 파일이 없다.
        return undefined;
    }
    if (format === 'rpgmv') {
        // RPG: data 폼더의 .extracteddata(gb) — data 키(cid)와 m을 새 줄 번호로 재구성
        const dataDir = path.dirname(extractDir);
        const edPath = resolveExtractArtifactPath(dataDir, '.extracteddata');
        const ext_data: any = edTool.readFile(edPath);
        for (const [file] of byFile) {
            const bucket = file === 'ext_javascript.js' ? 'ext_javascript.json' : `${path.parse(file).name}.json`;
            const gbEntry = ext_data.main[bucket];
            if (!gbEntry || typeof gbEntry.data !== 'object' || gbEntry.data === null || Array.isArray(gbEntry.data)) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata에 버킷이 없습니다: ${bucket}`);
            }
            const byIdentity = new Map<string, string>();
            for (const cid of Object.keys(gbEntry.data)) {
                const data = gbEntry.data[cid];
                if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                    throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata 항목이 올바르지 않습니다: ${bucket}#${cid}`);
                }
                const identity = `${String(data.origin)}#${String(data.val)}`;
                if (byIdentity.has(identity)) {
                    throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata에 중복 항목이 있습니다: ${identity}`);
                }
                byIdentity.set(identity, cid);
            }
            const fileEntries = manifest.entries.filter((e) => e.extractFile === file);
            const newData: { [cid: string]: unknown } = {};
            for (const e of fileEntries) {
                const matchKey = byIdentity.get(`${String(e.mv?.originFile)}#${e.dataPath}`);
                if (matchKey === undefined) {
                    throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata 항목을 찾을 수 없습니다: ${e.id}`);
                }
                newData[String(e.lineStart)] = { ...gbEntry.data[matchKey], m: e.lineEnd };
            }
            gbEntry.data = newData;
        }
        return { file: edPath, data: edTool.serialize(ext_data) };
    } else {
        // Wolf: _Extract/.extracteddata(msgpack+zlib) — textLineNumber를 새 줄 번호로 재구성
        const edPath = resolveExtractArtifactPath(extractDir, '.extracteddata');
        let ca: any;
        try {
            const stat = fs.lstatSync(edPath);
            if (stat.isSymbolicLink() || !stat.isFile()) {
                throw new Error('mapping path is not a regular file');
            }
            if (stat.size > 256 * 1024 * 1024) {
                throw new Error(`compressed mapping exceeds 268435456 bytes: ${stat.size}`);
            }
            const inflated = zlib.inflateSync(fs.readFileSync(edPath), { maxOutputLength: 512 * 1024 * 1024 });
            ca = decode(inflated) as any;
        } catch (error) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'Wolf .extracteddata 파싱에 실패했습니다', {
                edPath,
                cause: error instanceof Error ? error.message : String(error),
            });
        }
        if (typeof ca !== 'object' || ca === null || !Array.isArray(ca.ext)) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'Wolf .extracteddata ext 매핑이 올바르지 않습니다');
        }
        for (const [file] of byFile) {
            const fileEntries = manifest.entries.filter((e) => e.extractFile === file);
            for (const e of fileEntries) {
                const idx = parseInt(e.id.substring(e.id.lastIndexOf('#') + 1), 10);
                if (!Number.isSafeInteger(idx) || idx < 0) {
                    throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata 인덱스가 올바르지 않습니다: ${e.id}`);
                }
                const ext = ca.ext?.[idx];
                if (!ext || typeof ext !== 'object' || Array.isArray(ext)) {
                    throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata 항목을 찾을 수 없습니다: ${e.id}`);
                }
                const len = e.lineEnd - e.lineStart;
                ext.textLineNumber = Array.from({ length: len }, (_, k) => e.lineStart + k);
            }
        }
        return { file: edPath, data: zlib.deflateSync(Buffer.from(encode(ca))) };
    }
}
