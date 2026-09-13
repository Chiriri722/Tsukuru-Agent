import { ErrorCodes, OperationError } from './types';

export type QualityStatus = 'pass' | 'fail' | 'not-run' | 'needs-review';
export interface TranslationIssue {
    code: string;
    severity: 'error' | 'warning' | 'info';
    file: string;
    entryId?: string;
    reason?: string;
}
export interface TranslationQualityReport {
    mechanical: 'pass' | 'fail' | 'not-run';
    language: 'pass' | 'needs-review' | 'not-run';
    context: 'pass' | 'needs-review' | 'not-run';
    semantics: 'not-run';
    entriesChecked: number;
    sourcePreserved: number;
    issueCount: number;
    omittedCount: number;
    issues: TranslationIssue[];
}
export interface TranslationCandidate {
    file: string;
    entryId: string;
    source: string;
    text: string;
}
export const MAX_TRANSLATION_ISSUES = 100;
export const diagnosticLabel = (value: string): string => value.slice(0, 320);

/** Preserve command names, arguments and literal-backslash pairs, including unknown plugins. */
function controlTokens(text: string): string[] {
    const tokens: string[] = [];
    for (let index = 0; index < text.length; index++) {
        if (text[index] !== '\\' && text[index] !== '\x1b') continue;
        const start = index;
        if (text[index + 1] === text[index]) {
            tokens.push(text.slice(index, index + 2));
            index++;
            continue;
        }
        const command = /^[A-Za-z]+|^[\$\.\|!><^{}]/.exec(text.slice(index + 1));
        if (!command) {
            tokens.push(text[index]);
            continue;
        }
        index += command[0].length;
        if (text[index + 1] === '[') {
            let depth = 0;
            do {
                index++;
                if (text[index] === '[') depth++;
                if (text[index] === ']') depth--;
            } while (depth > 0 && index + 1 < text.length);
        }
        tokens.push(text.slice(start, index + 1));
    }
    return tokens;
}

function placeholders(text: string): { named: string[]; positional: string[] } {
    const named = text.match(/\$\{[\w.]+\}|\{\{[\w.]+\}\}|(?<![\\{])\{[\w.]+\}(?!})|%\d+\$[-+0 #]*\d*(?:\.\d+)?[a-zA-Z]|%[1-9]\d*/g) ?? [];
    const positional = text.replace(/%%|%\d+\$[-+0 #]*\d*(?:\.\d+)?[a-zA-Z]/g, '')
        .match(/%[-+0 #]*\d*(?:\.\d+)?[sdfiuoxXegGc]/g) ?? [];
    return { named: named.sort(), positional };
}

function sameTokens(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function inspectTranslations(candidates: TranslationCandidate[]): TranslationQualityReport {
    const report: TranslationQualityReport = {
        mechanical: candidates.length ? 'pass' : 'not-run', language: candidates.length ? 'pass' : 'not-run',
        context: 'not-run', semantics: 'not-run', entriesChecked: candidates.length,
        sourcePreserved: 0, issueCount: 0, omittedCount: 0, issues: [],
    };
    for (const candidate of candidates) {
        const { source, text } = candidate;
        if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)) {
            report.language = 'needs-review';
            const reason = source === text ? 'source-preserved; confirm intentional retention'
                : /(?:^|[.#])(name|nickname|displayName|gameTitle)$/.test(candidate.entryId) ? 'proper-name field; confirm spelling'
                : /credits?/i.test(candidate.entryId) ? 'credits field; confirm intentional retention'
                : 'Japanese or Han characters; human language review required';
            addTranslationIssue(report, { code: 'RPG_TRANSLATION_JAPANESE', severity: 'warning',
                file: candidate.file, entryId: candidate.entryId, reason });
        }
        if (source === text) { report.sourcePreserved++; continue; }
        const codes: string[] = [];
        if (source.trim().length > 0 && text.trim().length === 0) codes.push('RPG_TRANSLATION_BLANK');
        if ((text.match(/\uFFFD/g)?.length ?? 0) > (source.match(/\uFFFD/g)?.length ?? 0)) {
            codes.push('RPG_TRANSLATION_REPLACEMENT_CHARACTER');
        }
        if (!sameTokens(controlTokens(source), controlTokens(text))) codes.push('RPG_TRANSLATION_CONTROL_MISMATCH');
        const before = placeholders(source);
        const after = placeholders(text);
        if (!sameTokens(before.named, after.named) || !sameTokens(before.positional, after.positional)) {
            codes.push('RPG_TRANSLATION_PLACEHOLDER_MISMATCH');
        }
        for (const code of codes) addTranslationIssue(report, {
            code, severity: 'error', file: candidate.file, entryId: candidate.entryId,
        });
    }
    return report;
}

export function addTranslationIssue(report: TranslationQualityReport, issue: TranslationIssue): void {
    if (issue.severity === 'error') report.mechanical = 'fail';
    report.issueCount++;
    const bounded = {
        ...issue, file: diagnosticLabel(issue.file),
        ...(issue.entryId ? { entryId: diagnosticLabel(issue.entryId) } : {}),
        ...(issue.reason ? { reason: diagnosticLabel(issue.reason) } : {}),
    };
    if (report.issues.length < MAX_TRANSLATION_ISSUES) report.issues.push(bounded);
    else if (issue.severity === 'error') {
        const reviewIndex = report.issues.findIndex(candidate => candidate.severity !== 'error');
        if (reviewIndex >= 0) report.issues[reviewIndex] = bounded;
    }
    report.omittedCount = report.issueCount - report.issues.length;
}

export function translationQualitySummary(quality: TranslationQualityReport): string | undefined {
    const review = [quality.language === 'needs-review' ? '언어' : '', quality.context === 'needs-review' ? '메시지 문맥' : ''].filter(Boolean);
    return review.length ? `번역 ${review.join('·')} 감수가 필요합니다(진단 ${quality.issueCount}개)` : undefined;
}

export function assertTranslationQuality(quality: TranslationQualityReport): void {
    if (quality.mechanical === 'fail') {
        throw new OperationError(ErrorCodes.TRANSLATION_LINT, '번역 무결성 검사에 실패했습니다', { quality });
    }
}
