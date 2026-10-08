import { ExtractManifest, ManifestEntry, sha256Text } from '../../core/manifest';
import { GlossaryTerm, RpgReviewOptions } from '../../core/schema';
import { ErrorCodes, OperationError } from '../../core/types';
import { RpgApplyPlan } from './applyPlan';
import { rpgMessageBlocks } from './messageQuality';
import { RpgTranslation } from './translation';

export interface ReviewEntry {
    id: string; sourceFile: string; dataPath: string; extractFile: string;
    lineStart: number; lineEnd: number;
    category: 'dialogue' | 'choice' | 'database' | 'system' | 'plugin' | 'script' | 'note' | 'other';
    source: string | null; text: string; sourceHash: string | null; currentHash: string;
    state: 'source-preserved' | 'changed' | 'unsupported'; supported: boolean;
    contextStatus: 'available' | 'unavailable' | 'not-applicable'; groupId?: string;
    command?: { code: number; index: number; listPath: string; indent?: number; eventIndex?: number; pageIndex?: number };
}

export interface ReviewGroup {
    id: string; file: string; listPath: string; headerIndex: number;
    lines: { id: string; source: string }[]; omittedLines: number; contextHash: string;
    speaker: { status: 'explicit' | 'unknown'; name?: string; basis: '101.parameters.4' | 'dynamic-name' | 'no-explicit-name' };
}

export interface RpgReviewReport {
    schemaVersion: 1; kind: 'rpg-review'; workspaceHash: string;
    totalEntries: number; omittedEntries: number; entries: ReviewEntry[]; groups: ReviewGroup[];
    preview?: {
        mode: 'offline'; approved: false; sourceLanguage: string; targetLanguage: string;
        entryIds: string[]; glossaryVersion: string | null; glossaryHash: string;
        terms: GlossaryTerm[]; omittedTerms: number; requestHash: string;
    };
}

const digest = (value: unknown): string => sha256Text(JSON.stringify(value));
const invalid = (message: string): never => { throw new OperationError(ErrorCodes.REQUEST_INVALID, message); };
const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function selectEntries(manifest: ExtractManifest, options: RpgReviewOptions): ManifestEntry[] {
    if (!options.entryIds) {
        const offset = options.offset ?? 0;
        if (offset >= manifest.entries.length && offset !== 0) invalid('review offset이 항목 수를 벗어납니다');
        return manifest.entries.slice(offset, offset + (options.limit ?? 100));
    }
    const selected = new Set(options.entryIds);
    const known = new Set(manifest.entries.map(entry => entry.id));
    if (selected.size !== options.entryIds.length || [...selected].some(id => !known.has(id))) {
        invalid('review ID가 중복되었거나 manifest에 없습니다');
    }
    return manifest.entries.filter(entry => selected.has(entry.id));
}

function commandContext(data: any, dataPath: string): ReviewEntry['command'] {
    const match = /^(.*\.list)\.(\d+)\.parameters(?:\.|$)/.exec(dataPath);
    if (!match) return undefined;
    const list = match[1].split('.').reduce((value, key) => value?.[key], data);
    const command = list?.[Number(match[2])];
    if (!Number.isInteger(command?.code)) return undefined;
    const event = /^events\.(\d+)\./.exec(match[1]) ?? /^(\d+)\./.exec(match[1]);
    const page = /(?:^|\.)pages\.(\d+)\./.exec(match[1]);
    return { code: command.code, index: Number(match[2]), listPath: match[1],
        ...(Number.isInteger(command.indent) ? { indent: command.indent } : {}),
        ...(event ? { eventIndex: Number(event[1]) } : {}), ...(page ? { pageIndex: Number(page[1]) } : {}) };
}

function category(entry: ManifestEntry, command: ReviewEntry['command']): ReviewEntry['category'] {
    if (command && [101, 401, 405].includes(command.code)) return 'dialogue';
    if (command && [102, 402].includes(command.code)) return 'choice';
    if (/note/i.test(entry.mv?.qpath ?? '') || /(?:^|\.)note$/.test(entry.dataPath)) return 'note';
    if (/plugin/i.test(entry.mv?.qpath ?? '') || (command && [356, 357].includes(command.code))) return 'plugin';
    if (/script/i.test(entry.mv?.qpath ?? '') || (command && [355, 655].includes(command.code))) return 'script';
    if (/System\.json$/i.test(entry.sourceFile)) return 'system';
    if (/\.(?:name|nickname|profile|description|message\d*)$/.test(entry.dataPath)) return 'database';
    return 'other';
}

function reviewRows(plan: RpgApplyPlan, manifest: ExtractManifest, translations: RpgTranslation[], options: RpgReviewOptions): ReviewEntry[] {
    const translated = new Map(translations.map(item => [item.entryId, item]));
    const buckets = new Map(plan.buckets.map(bucket => [bucket.extractFile, bucket]));
    return selectEntries(manifest, options).map(entry => {
        const bucket = buckets.get(entry.extractFile.replaceAll('\\', '/'));
        if (!bucket) throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'review bucket이 없습니다');
        const text = bucket.lines.slice(entry.lineStart, entry.lineEnd).join('\n');
        const currentHash = sha256Text(text);
        if (currentHash !== entry.hash.toLowerCase()) {
            throw new OperationError(ErrorCodes.PATCH_HASH_MISMATCH, 'review 대상의 현재 해시가 manifest와 다릅니다');
        }
        const item = translated.get(entry.id);
        const source = item?.source ?? null;
        const file = entry.sourceFile.replaceAll('\\', '/').slice('Backup/'.length);
        const command = commandContext(plan.backups.get(file), entry.dataPath);
        const kind = category(entry, command);
        return { id: entry.id, sourceFile: entry.sourceFile, dataPath: entry.dataPath,
            extractFile: entry.extractFile, lineStart: entry.lineStart, lineEnd: entry.lineEnd,
            category: kind, source, text, sourceHash: source === null ? null : sha256Text(source), currentHash,
            supported: !!item, state: source === null ? 'unsupported' : source === text ? 'source-preserved' : 'changed',
            contextStatus: kind === 'dialogue' ? 'unavailable' : 'not-applicable', ...(command ? { command } : {}) };
    });
}

function reviewGroups(plan: RpgApplyPlan, entries: ReviewEntry[]): ReviewGroup[] {
    const rows = new Map(entries.map(entry => [entry.id, entry]));
    const groups: ReviewGroup[] = [];
    for (const block of rpgMessageBlocks(plan)) {
        if (!block.header) continue;
        const selected = block.lines.filter(line => rows.has(line.id));
        if (!selected.length) continue;
        const name = block.header.parameters?.[4];
        const speaker: ReviewGroup['speaker'] = typeof name === 'string' && name.trim() && !name.includes('\\')
            ? { status: 'explicit', name, basis: '101.parameters.4' }
            : { status: 'unknown', basis: typeof name === 'string' && name.includes('\\') ? 'dynamic-name' : 'no-explicit-name' };
        const id = `${block.file}#${block.listPath}.${block.headerIndex}`;
        // ponytail: cap source context at 50 lines; paginate a dedicated reader if larger blocks matter.
        groups.push({ id, file: block.file, listPath: block.listPath, headerIndex: block.headerIndex,
            lines: block.lines.slice(0, 50), omittedLines: Math.max(0, block.lines.length - 50),
            contextHash: digest([block.header, block.lines]), speaker });
        for (const line of selected) { rows.get(line.id)!.groupId = id; rows.get(line.id)!.contextStatus = 'available'; }
    }
    return groups;
}

function glossaryDefinitions(entries: GlossaryTerm[]): GlossaryTerm[] {
    const priorities = { user: 3, manual: 2, derived: 1 };
    const seen = new Map<string, string>();
    const winners = new Map<string, GlossaryTerm>();
    for (const entry of entries) {
        const key = JSON.stringify([entry.term, entry.priority]);
        if (seen.has(key) && seen.get(key) !== entry.translation) invalid('동일 우선순위 용어 정의가 충돌합니다');
        seen.set(key, entry.translation);
        const previous = winners.get(entry.term);
        if (!previous || priorities[entry.priority] > priorities[previous.priority]) winners.set(entry.term, entry);
    }
    return [...winners.values()].sort((a, b) => b.term.length - a.term.length || lexical(a.term, b.term));
}

/** Match occurrences, not global substring exclusion: an independent short term survives. */
function relevantTerms(definitions: GlossaryTerm[], texts: string[]): GlossaryTerm[] {
    const selected = new Set<string>();
    for (const text of texts) {
        const occupied = new Uint8Array(text.length);
        for (const definition of definitions) {
            let start = text.indexOf(definition.term);
            while (start !== -1) {
                const end = start + definition.term.length;
                if (!occupied.subarray(start, end).some(Boolean)) {
                    selected.add(definition.term);
                    occupied.fill(1, start, end);
                }
                start = text.indexOf(definition.term, start + 1);
            }
        }
    }
    return definitions.filter(entry => selected.has(entry.term));
}

export function buildRpgReview(
    plan: RpgApplyPlan, manifest: ExtractManifest, translations: RpgTranslation[], options: RpgReviewOptions,
): RpgReviewReport {
    const entries = reviewRows(plan, manifest, translations, options);
    const groups = reviewGroups(plan, entries);
    const report: RpgReviewReport = { schemaVersion: 1, kind: 'rpg-review',
        workspaceHash: digest([digest(manifest), plan.buckets.map(digest),
            [...plan.backups].sort(([a], [b]) => lexical(a, b)).map(digest)]),
        totalEntries: manifest.entries.length, omittedEntries: manifest.entries.length - entries.length, entries, groups };
    if (options.preview) {
        assertReviewSize(report);
        const config = options.preview;
        const glossary = config.glossary ?? { version: null, entries: [] };
        const definitions = glossaryDefinitions(glossary.entries);
        const texts = [...entries.flatMap(entry => entry.supported && entry.source !== null ? [entry.source] : []),
            ...groups.flatMap(group => group.lines.map(line => line.source))];
        const relevant = relevantTerms(definitions, texts);
        const preview = { mode: 'offline' as const, approved: false as const,
            sourceLanguage: config.sourceLanguage, targetLanguage: config.targetLanguage,
            entryIds: entries.filter(entry => entry.supported).map(entry => entry.id),
            glossaryVersion: glossary.version, glossaryHash: digest(glossary),
            terms: relevant.slice(0, config.maxTerms ?? 32), omittedTerms: Math.max(0, relevant.length - (config.maxTerms ?? 32)) };
        report.preview = { ...preview, requestHash: digest([report, preview]) };
    }
    return report;
}

export function assertReviewSize(report: RpgReviewReport): void {
    if (Buffer.byteLength(JSON.stringify(report, null, 2) + '\n', 'utf8') > 16 * 1024 * 1024) {
        throw new OperationError(ErrorCodes.RESOURCE_LIMIT_EXCEEDED, 'review 보고서가 16 MiB를 초과했습니다. 선택 범위를 줄이세요');
    }
}
