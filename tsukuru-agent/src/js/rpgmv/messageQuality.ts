import { RpgApplyPlan } from './applyPlan';
import type { RpgTranslation } from './translation';
import { addTranslationIssue, TranslationQualityReport } from '../../core/translationLint';

function quoteShape(text: string): { balanced: boolean; style: string } {
    const stack: string[] = [];
    const closing: Record<string, string> = { '「': '」', '『': '』', '“': '”', '‘': '’' };
    const closers = new Set(Object.values(closing));
    const style = new Set<string>();
    let invalid = false;
    let asciiQuote = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === '\\') { index++; continue; }
        if (char === '"') { asciiQuote = !asciiQuote; style.add('"'); }
        else if (closing[char]) { stack.push(closing[char]); style.add(char); }
        else if (closers.has(char) && stack.pop() !== char) invalid = true;
    }
    return { balanced: !invalid && stack.length === 0 && !asciiQuote, style: [...style].sort().join('') };
}

function eventLists(file: string, data: any): { path: string; commands: any[] }[] {
    const lists: { path: string; commands: any[] }[] = [];
    const add = (value: any, prefix: string): void => {
        if (Array.isArray(value?.list)) lists.push({ path: `${prefix}.list`, commands: value.list });
    };
    if (/^Map\d+\.json$/i.test(file) && Array.isArray(data?.events)) {
        data.events.forEach((event: any, eventId: number) => {
            if (Array.isArray(event?.pages)) event.pages.forEach((page: any, pageId: number) => add(page, `events.${eventId}.pages.${pageId}`));
        });
    } else if (file === 'CommonEvents.json' && Array.isArray(data)) data.forEach((event, id) => add(event, String(id)));
    else if (file === 'Troops.json' && Array.isArray(data)) data.forEach((troop, id) => {
        if (Array.isArray(troop?.pages)) troop.pages.forEach((page: any, pageId: number) => add(page, `${id}.pages.${pageId}`));
    });
    return lists;
}

/** Event/page/list and indent come from Backup, never editable Extract adjacency or conf. */
export function inspectRpgMessageQuality(plan: RpgApplyPlan, translations: RpgTranslation[], quality: TranslationQualityReport): void {
    const translated = new Map(translations.map(item => [item.entryId, item.text]));
    let blocks = 0;
    for (const [file, data] of plan.backups) for (const list of eventLists(file, data)) {
        for (let index = 0; index < list.commands.length; index++) {
            const header = list.commands[index];
            if (header?.code === 401) {
                quality.context = 'needs-review';
                addTranslationIssue(quality, { code: 'RPG_MESSAGE_CONTEXT_UNAVAILABLE', severity: 'warning', file,
                    entryId: `${file}#${list.path}.${index}.parameters.0`,
                    reason: '401 command has no contiguous 101 header at the same indent' });
            }
            if (header?.code !== 101) continue;
            const originalLines: string[] = [];
            const translatedLines: string[] = [];
            let firstId: string | undefined;
            for (let line = index + 1; line < list.commands.length; line++) {
                const command = list.commands[line];
                if (command?.code !== 401 || command.indent !== header.indent) break;
                if (typeof command.parameters?.[0] !== 'string') break;
                const id = `${file}#${list.path}.${line}.parameters.0`;
                if (!firstId) firstId = id;
                originalLines.push(command.parameters[0]);
                translatedLines.push(translated.get(id) ?? command.parameters[0]);
                index = line;
            }
            if (!firstId) continue;
            blocks++;
            const before = quoteShape(originalLines.join('\n'));
            const after = quoteShape(translatedLines.join('\n'));
            if (!after.balanced) {
                quality.context = 'needs-review';
                addTranslationIssue(quality, { code: 'RPG_MESSAGE_QUOTES', severity: 'warning', file, entryId: firstId,
                    reason: before.balanced ? 'unbalanced within one 101/401 message block' : 'source block already unbalanced; review retained fragments' });
            } else if (before.balanced && before.style !== after.style) {
                addTranslationIssue(quality, { code: 'RPG_MESSAGE_QUOTE_STYLE', severity: 'info', file, entryId: firstId,
                    reason: 'balanced quote-style change; confirm intended rendering' });
            }
        }
    }
    if (quality.context !== 'needs-review') quality.context = blocks ? 'pass' : 'not-run';
}
