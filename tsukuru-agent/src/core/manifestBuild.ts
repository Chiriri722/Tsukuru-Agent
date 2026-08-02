/**
 * 추출 결과로부터 Extract/manifest.json을 생성하는 빌더 (계획서 §Manifest와 안전성).
 *
 * hash 규칙: 작업용 txt에 기록된 원문(해당 항목의 줄 범위 내용을 '\n'으로 결합한
 * 형태)의 UTF-8 SHA-256. patch의 expectedHash는 이 값과 비교한다.
 * - MV: .extracteddata의 originText(txt 기록 형태와 동일)
 * - Wolf: decodeEncoding + 백슬래시 이스케이프 + 널 종료 제거 후 txt 기록 형태
 */
import path from 'path';
import { ExtractManifest, createManifest, sha256Text } from './manifest';
import { WolfExtDataEntry } from './context';
import { decodeEncoding } from '../utils';

/** RPG MV/MZ: 추출이 끝난 직후의 ctx().rpg.gb로부터 manifest를 생성한다. */
export function buildRpgManifest(gb: { [fileName: string]: any }): ExtractManifest {
    const manifest = createManifest('rpgmv');
    for (const jpath of Object.keys(gb)) {
        const data = gb[jpath].data ?? {};
        // extractFile은 추출 디렉터리(Extract/ 또는 _Extract/) 기준 상대 경로로 통일한다.
        const extractFile = jpath === 'ext_javascript.json'
            ? 'ext_javascript.js'
            : `${path.parse(jpath).name}.txt`;
        for (const cid of Object.keys(data)) {
            const e = data[cid];
            const lineStart = parseInt(cid);
            const originText = (e.originText ?? '') as string;
            manifest.entries.push({
                id: `${e.origin}#${e.val}`,
                sourceFile: `Backup/${e.origin}`,
                dataPath: String(e.val),
                extractFile,
                lineStart,
                lineEnd: e.m ?? lineStart,
                hash: sha256Text(originText),
                encoding: 'utf8',
                nullTerminated: false,
                mv: {
                    qpath: e.qpath ?? '',
                    conf: e.conf,
                    endLine: e.m ?? lineStart,
                    originFile: e.origin,
                },
            });
        }
    }
    return manifest;
}

/**
 * Wolf: makeText 완료 직후의 ctx().wolf.extData로부터 manifest를 생성한다.
 * (endsWithNull/textLineNumber가 채워진 상태여야 한다)
 */
export function buildWolfManifest(
    extData: WolfExtDataEntry[],
    sourceDir: string,
    encoding: string,
): ExtractManifest {
    const manifest = createManifest('wolf');
    for (let i = 0; i < extData.length; i++) {
        const e = extData[i];
        // makeText와 동일한 변환 순서(디코딩 → 이스케이프 → 널 제거)로 txt 표기를 재현한다.
        let decoded = decodeEncoding(e.str.str).replaceAll('\\\\', '\\\\\\\\');
        if (decoded.endsWith('\0')) {
            decoded = decoded.substring(0, decoded.length - 1);
        }
        const rel = sourceDir ? path.relative(sourceDir, e.sourceFile) : e.sourceFile;
        const lines = (e.textLineNumber ?? []).slice().sort((a, b) => a - b);
        manifest.entries.push({
            id: `${rel || e.sourceFile}#${i}`,
            sourceFile: rel || e.sourceFile,
            dataPath: e.codeStr,
            extractFile: `Texts/${e.extractFile}.txt`,
            lineStart: lines.length > 0 ? lines[0] : 0,
            lineEnd: lines.length > 0 ? lines[lines.length - 1] + 1 : 0,
            hash: sha256Text(decoded),
            encoding,
            nullTerminated: e.endsWithNull ?? false,
            wolf: {
                sourceFile: e.sourceFile,
                pos1: e.str.pos1,
                pos2: e.str.pos2,
                pos3: e.str.pos3,
                len: e.str.len,
            },
        });
    }
    return manifest;
}
