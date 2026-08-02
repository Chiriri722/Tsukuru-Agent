/**
 * patch 작업 구현 (계획서 §CLI 계약 및 §Manifest와 안전성).
 * - id/expectedHash 검증 후 추출 작업본(txt)만 수정한다(원본·Backup 불변).
 * - 해시 불일치·중복 ID·매핑 손상이 하나라도 있으면 아무것도 변경하지 않는다.
 * - 여러 줄 치환 후에는 manifest와 .extracteddata의 줄 매핑을 재생성한다.
 * - 모든 기록은 원자적 쓰기(atomicWriteFileSync).
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import iconv from 'iconv-lite';
import { encode, decode } from '@msgpack/msgpack';
import { OperationError, ErrorCodes } from '../core/types';
import { ExtractManifest, ManifestEntry, MANIFEST_FILE, sha256Text } from '../core/manifest';
import { PatchEntry } from '../core/schema';
import { atomicWriteFileSync } from '../core/atomic';
import { DetectedFormat } from '../core/schema';

export interface PatchOutcome {
    patched: number;
    files: number;
}

/** extractDir(Extract/ 또는 _Extract/) 안의 작업본에 patches를 적용한다. */
export function applyPatches(extractDir: string, format: DetectedFormat, patches: PatchEntry[]): PatchOutcome {
    // 1. manifest 로드
    const manifestPath = path.join(extractDir, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) {
        throw new OperationError(ErrorCodes.MANIFEST_MISSING, 'manifest.json이 없습니다. 먼저 extract를 실행하세요', { manifestPath });
    }
    let manifest: ExtractManifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, 'manifest.json 파싱에 실패했습니다', { manifestPath });
    }
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
            const fp = path.join(extractDir, rel);
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
        }
    }

    // 6. .extracteddata 줄 매핑 재생성 + 모든 산출물 원자적 기록
    regenerateExtractedData(extractDir, format, manifest, byFile);
    for (const [file, lines] of fileLines) {
        if (byFile.has(file)) {
            atomicWriteFileSync(path.join(extractDir, file), lines.join('\n'));
        }
    }
    atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return { patched: patches.length, files: byFile.size };
}

/** .extracteddata의 줄 매핑을 갱신된 manifest 기준으로 재생성한다. */
function regenerateExtractedData(
    extractDir: string,
    format: DetectedFormat,
    manifest: ExtractManifest,
    byFile: Map<string, { p: PatchEntry; e: ManifestEntry }[]>,
): void {
    if (format === 'rpgmv') {
        // RPG: data 폼더의 .extracteddata(gb) — data 키(cid)와 m을 새 줄 번호로 재구성
        const dataDir = path.dirname(extractDir);
        const edPath = path.join(dataDir, '.extracteddata');
        const readF = fs.readFileSync(edPath);
        let ext_data: any = JSON.parse(iconv.decode(zlib.inflateSync(readF), 'utf8'));
        while (ext_data.main === undefined) {
            ext_data = ext_data.dat;
        }
        for (const [file] of byFile) {
            const bucket = file === 'ext_javascript.js' ? 'ext_javascript.json' : `${path.parse(file).name}.json`;
            const gbEntry = ext_data.main[bucket];
            if (!gbEntry || !gbEntry.data) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata에 버킷이 없습니다: ${bucket}`);
            }
            const fileEntries = manifest.entries.filter((e) => e.extractFile === file);
            const newData: { [cid: string]: unknown } = {};
            for (const e of fileEntries) {
                const matchKey = Object.keys(gbEntry.data).find((cid) => {
                    const d = gbEntry.data[cid];
                    return d.origin === e.mv?.originFile && String(d.val) === e.dataPath;
                });
                if (matchKey === undefined) {
                    throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata 항목을 찾을 수 없습니다: ${e.id}`);
                }
                newData[String(e.lineStart)] = { ...gbEntry.data[matchKey], m: e.lineEnd };
            }
            gbEntry.data = newData;
        }
        atomicWriteFileSync(edPath, zlib.deflateSync(iconv.encode(JSON.stringify({ dat: ext_data }), 'utf8')));
    } else {
        // Wolf: _Extract/.extracteddata(msgpack+zlib) — textLineNumber를 새 줄 번호로 재구성
        const edPath = path.join(extractDir, '.extracteddata');
        const ca = decode(zlib.inflateSync(fs.readFileSync(edPath))) as any;
        for (const [file] of byFile) {
            const fileEntries = manifest.entries.filter((e) => e.extractFile === file);
            for (const e of fileEntries) {
                const idx = parseInt(e.id.substring(e.id.lastIndexOf('#') + 1), 10);
                const ext = ca.ext?.[idx];
                if (!ext) {
                    throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `.extracteddata 항목을 찾을 수 없습니다: ${e.id}`);
                }
                const len = e.lineEnd - e.lineStart;
                ext.textLineNumber = Array.from({ length: len }, (_, k) => e.lineStart + k);
            }
        }
        atomicWriteFileSync(edPath, zlib.deflateSync(Buffer.from(encode(ca))));
    }
}
