import fs from 'fs';
import * as encoding from 'encoding-japanese';
import { RpgApplyPlan, RpgApplyEntry, RpgApplyBucket, readRpgDataPath } from './applyPlan';
import { resolveContainedPathWithoutLinks } from '../../core/pathSafety';
import { ErrorCodes, OperationError } from '../../core/types';
import { inspectTranslations, TranslationCandidate, diagnosticLabel } from '../../core/translationLint';
import { inspectRpgMessageQuality } from './messageQuality';

export interface RpgTranslation extends TranslationCandidate {
    entry: RpgApplyEntry;
    bucket: RpgApplyBucket;
}

/** Two-column external-message CSV; quoted commas/newlines and doubled quotes are retained. */
export function parseRpgMessageCsv(source: string, strictColumns = false): Record<string, string> {
    const result: Record<string, string> = Object.create(null);
    let row: string[] = [];
    let field = '';
    let quoted = false;
    let closed = false;
    const finishRow = (): void => {
        row.push(field);
        const blank = row.length === 1 && !closed && row[0].trim() === '';
        if (strictColumns && row.length !== 2 && !blank) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, '외부 메시지 CSV 출력은 두 열이어야 합니다');
        }
        result[blank ? '' : row[0]] = row[1] ?? '';
        row = []; field = ''; closed = false;
    };
    const text = source.replace(/^\uFEFF/, '');
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
            if (char !== '"') field += char;
            else if (text[index + 1] === '"') { field += '"'; index++; }
            else { quoted = false; closed = true; }
        } else if (char === ',') {
            row.push(field); field = ''; closed = false;
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[index + 1] === '\n') index++;
            finishRow();
        } else if (char === '"' && /^\s*$/.test(field) && !closed) { field = ''; quoted = true; }
        else if (closed && /\s/.test(char)) continue;
        else if (closed) throw new OperationError(ErrorCodes.MAPPING_CORRUPT, '외부 메시지 CSV 따옴표 형식이 잘못되었습니다');
        else field += char;
    }
    if (quoted) throw new OperationError(ErrorCodes.MAPPING_CORRUPT, '외부 메시지 CSV 따옴표가 닫히지 않았습니다');
    if (field.trim() !== '' || row.length > 0 || closed) finishRow();
    return result;
}

function readExternalMessages(plan: RpgApplyPlan): Record<string, string> | undefined {
    for (const root of [plan.backupRoot, plan.dataRoot]) {
        const resolved = resolveContainedPathWithoutLinks(root, 'ExternMessage.csv');
        if (!resolved.ok) throw new OperationError(ErrorCodes.MAPPING_CORRUPT, '외부 메시지 CSV 경로가 안전하지 않습니다');
        if (!fs.existsSync(resolved.path)) continue;
        const stat = fs.lstatSync(resolved.path);
        if (!stat.isFile() || stat.size > 64 * 1024 * 1024) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, '외부 메시지 CSV가 일반 파일이 아니거나 너무 큽니다');
        }
        const utf8 = new Uint8Array(encoding.convert(fs.readFileSync(resolved.path), 'UTF8', 'AUTO'));
        return parseRpgMessageCsv(new TextDecoder('utf-8', { fatal: true }).decode(utf8));
    }
    return undefined;
}

export function rpgEntryContext(bucket: RpgApplyBucket, entry: RpgApplyEntry): Record<string, string> {
    return { file: diagnosticLabel(entry.originFile), bucket: diagnosticLabel(bucket.name),
        entryId: diagnosticLabel(`${entry.originFile}#${entry.dataPath}`), dataPath: diagnosticLabel(entry.dataPath) };
}

function translatedText(bucket: RpgApplyBucket, entry: RpgApplyEntry, autoline: boolean): string {
    const lines = bucket.lines.slice(entry.start, entry.end);
    if (autoline && entry.conf?.type === 'event' && entry.conf?.code === 401) {
        const maxBytes = entry.conf.face ? 80 : 60;
        return lines.map(line => {
            if (Buffer.byteLength(line, 'utf8') <= maxBytes) return line;
            const words = line.split(' ');
            if (words.length > 1) {
                const splitAt = Math.max(0, Math.floor(words.length / 2) - 1);
                words[splitAt] = `\n${words[splitAt]}`;
            }
            return words.join(' ');
        }).join('\n');
    }
    return lines.join('\n');
}

export function planRpgTranslations(
    plan: RpgApplyPlan,
    options: { isComment?: boolean; autoline?: boolean } = {},
    replacements?: ReadonlyMap<string, string>,
): { translations: RpgTranslation[]; quality: ReturnType<typeof inspectTranslations> } {
    const translations: RpgTranslation[] = [];
    let external: Record<string, string> | undefined;
    let externalLoaded = false;
    for (const bucket of plan.buckets) for (const entry of bucket.entries) {
        if (entry.conf?.isComment === true || (entry.conf !== undefined && options.isComment)) continue;
        const entryId = `${entry.originFile}#${entry.dataPath}`;
        const text = replacements?.get(entryId) ?? translatedText(bucket, entry, options.autoline === true);
        let source: string;
        try { source = readRpgDataPath(plan.backups.get(entry.originFile), entry.dataPath); }
        catch (error) {
            if (error instanceof OperationError) throw new OperationError(error.code, error.message, rpgEntryContext(bucket, entry));
            throw error;
        }
        // Only the exact reference form is expanded by the extractor. Never exempt mixed text/tokens.
        const reference = /^\\M\[([^\[\]\r\n]+)\]$/.exec(source);
        if (reference && source !== text) {
            if (!externalLoaded) { external = readExternalMessages(plan); externalLoaded = true; }
            if (!external || !Object.prototype.hasOwnProperty.call(external, reference[1])) {
                throw new OperationError(ErrorCodes.TRANSLATION_LINT, '외부 메시지 치환의 CSV 원문을 확인할 수 없습니다', {
                    ...rpgEntryContext(bucket, entry), code: 'RPG_TRANSLATION_SOURCE_UNAVAILABLE', status: 'not-run',
                });
            }
            source = external[reference[1]];
        }
        translations.push({ file: entry.originFile, entryId, source, text, entry, bucket });
    }
    const quality = inspectTranslations(translations);
    inspectRpgMessageQuality(plan, translations, quality);
    return { translations, quality };
}
