import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { finalizeValidationReport } from '../reportPolicy';
import { StructuralIssue, StructuralValidationReport } from '../types';

function decodeTyranoText(bytes: Buffer): { text: string; encoding: 'utf8' | 'shiftJis' | 'unknown' } {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return { text: bytes.subarray(3).toString('utf8'), encoding: 'utf8' };
    }
    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
    } catch {
        const text = iconv.decode(bytes, 'shift_jis');
        if (iconv.encode(text, 'shift_jis').equals(bytes)) {
            return { text, encoding: 'shiftJis' };
        }
        return { text, encoding: 'unknown' };
    }
}

function inspectTjsDelimiters(text: string, file: string): StructuralIssue[] {
    const issues: StructuralIssue[] = [];
    const stack: Array<{ opener: string; closer: string; line: number; column: number }> = [];
    const closers: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    let line = 1;
    let column = 0;
    let quote: "'" | '"' | '`' | null = null;
    let quoteStart: { line: number; column: number } | null = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    let blockCommentStart: { line: number; column: number } | null = null;

    for (let index = 0; index < text.length; index++) {
        const current = text[index];
        const next = text[index + 1];
        column++;
        if (current === '\n') {
            if (quote && quote !== '`') {
                if (escaped) {
                    escaped = false;
                } else if (quoteStart) {
                    issues.push({
                        code: 'TYRANO_TJS_UNTERMINATED_STRING',
                        severity: 'error',
                        file,
                        line: quoteStart.line,
                        column: quoteStart.column,
                        message: `Tyrano TJS ${quote} 문자열이 줄 끝에서 닫히지 않았습니다`,
                    });
                    quote = null;
                    quoteStart = null;
                }
            }
            line++;
            column = 0;
            lineComment = false;
            continue;
        }
        if (lineComment) continue;
        if (blockComment) {
            if (current === '*' && next === '/') {
                blockComment = false;
                blockCommentStart = null;
                index++;
                column++;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === quote) {
                quote = null;
                quoteStart = null;
            }
            continue;
        }
        if (current === '/' && next === '/') {
            lineComment = true;
            index++;
            column++;
            continue;
        }
        if (current === '/' && next === '*') {
            blockComment = true;
            blockCommentStart = { line, column };
            index++;
            column++;
            continue;
        }
        if (current === "'" || current === '"' || current === '`') {
            quote = current;
            quoteStart = { line, column };
            continue;
        }
        if (closers[current]) {
            stack.push({ opener: current, closer: closers[current], line, column });
            continue;
        }
        if (current === ')' || current === ']' || current === '}') {
            const opener = stack[stack.length - 1];
            if (opener?.closer === current) {
                stack.pop();
            } else {
                issues.push({
                    code: 'TYRANO_TJS_UNEXPECTED_CLOSER',
                    severity: 'error',
                    file,
                    line,
                    column,
                    message: `Tyrano TJS 닫힘 기호 ${current} 앞에 대응하는 열림 기호가 없습니다`,
                });
            }
        }
    }
    if (blockComment && blockCommentStart) {
        issues.push({
            code: 'TYRANO_TJS_UNTERMINATED_COMMENT',
            severity: 'error',
            file,
            line: blockCommentStart.line,
            column: blockCommentStart.column,
            message: 'Tyrano TJS 블록 주석이 닫히지 않았습니다',
        });
    }
    if (quote && quoteStart) {
        issues.push({
            code: 'TYRANO_TJS_UNTERMINATED_STRING',
            severity: 'error',
            file,
            line: quoteStart.line,
            column: quoteStart.column,
            message: `Tyrano TJS ${quote} 문자열이 파일 끝에서 닫히지 않았습니다`,
        });
    }
    for (const opener of stack) {
        issues.push({
            code: 'TYRANO_TJS_UNCLOSED_DELIMITER',
            severity: 'error',
            file,
            line: opener.line,
            column: opener.column,
            message: `Tyrano TJS ${opener.opener} 기호에 대응하는 ${opener.closer} 기호가 없습니다`,
        });
    }
    return issues;
}

export function inspectTyranoProject(projectRoot: string): StructuralValidationReport {
    const root = path.resolve(projectRoot);
    const files: string[] = [];
    const issues: StructuralIssue[] = [];
    const invalidFiles = new Set<string>();
    let linkedPathCount = 0;
    const visit = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const child = path.join(current, entry.name);
            if (entry.isSymbolicLink()) {
                const relative = path.relative(root, child).replace(/\\/g, '/');
                issues.push({
                    code: 'TYRANO_LINKED_PATH',
                    severity: 'critical',
                    file: relative,
                    message: 'Tyrano 프로젝트의 심볼릭 링크/정션은 검증할 수 없습니다',
                });
                invalidFiles.add(relative);
                linkedPathCount++;
                continue;
            }
            if (entry.isDirectory()) visit(child);
            else if (entry.isFile() && /\.(?:ks|tjs)$/i.test(entry.name)) files.push(child);
        }
    };
    visit(root);
    const encodingCounts = { utf8: 0, shiftJis: 0, unknown: 0 };
    for (const file of files) {
        const relative = path.relative(root, file).replace(/\\/g, '/');
        const decoded = decodeTyranoText(fs.readFileSync(file));
        encodingCounts[decoded.encoding]++;
        const text = decoded.text;
        if (decoded.encoding === 'unknown') {
            issues.push({
                code: 'TYRANO_ENCODING_UNCERTAIN',
                severity: 'warning',
                file: relative,
                message: 'Tyrano 텍스트가 올바른 UTF-8 또는 왕복 가능한 Shift_JIS인지 확인할 수 없습니다',
            });
        }
        if (file.toLowerCase().endsWith('.tjs')) {
            const tjsIssues = inspectTjsDelimiters(text, relative);
            issues.push(...tjsIssues);
            if (tjsIssues.some((issue) => issue.severity !== 'warning')) invalidFiles.add(relative);
            continue;
        }
        const lines = text.split(/\r?\n/);
        const blocks: Array<{ tag: string; expected: string; line: number; column: number }> = [];
        const openers: Record<string, string> = {
            if: 'endif',
            macro: 'endmacro',
            ignore: 'endignore',
            iscript: 'endscript',
            while: 'endwhile',
            for: 'endfor',
        };
        const knownClosers = new Set(Object.values(openers));
        let inScript = false;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            if (inScript) {
                const endScript = /\[\s*endscript\b[^\]]*\]/i.exec(line);
                if (endScript) {
                    inScript = false;
                    if (blocks[blocks.length - 1]?.expected === 'endscript') blocks.pop();
                }
                continue;
            }
            if (/^\s*;/.test(line)) continue;
            for (let cursor = 0; cursor < line.length; cursor++) {
                if (line[cursor] !== '[') continue;
                const start = cursor;
                let quote: string | null = null;
                let escaped = false;
                for (cursor = start + 1; cursor < line.length; cursor++) {
                    const current = line[cursor];
                    if (escaped) {
                        escaped = false;
                        continue;
                    }
                    if (current === '\\') {
                        escaped = true;
                        continue;
                    }
                    if (quote) {
                        if (current === quote) quote = null;
                        continue;
                    }
                    if (current === '"' || current === "'") {
                        quote = current;
                        continue;
                    }
                    if (current === ']') break;
                }
                if (cursor >= line.length) {
                    issues.push({
                        code: 'TYRANO_KS_UNTERMINATED_TAG',
                        severity: 'error',
                        file: relative,
                        line: lineIndex + 1,
                        column: start + 1,
                        message: 'Tyrano KS 태그의 닫는 대괄호가 없습니다',
                    });
                    invalidFiles.add(relative);
                    break;
                }
                const tagName = line.slice(start + 1, cursor).trim().split(/\s+/)[0]?.toLowerCase();
                if (tagName && openers[tagName]) {
                    blocks.push({ tag: tagName, expected: openers[tagName], line: lineIndex + 1, column: start + 1 });
                    if (tagName === 'iscript') inScript = true;
                } else if (tagName && knownClosers.has(tagName)) {
                    if (blocks[blocks.length - 1]?.expected === tagName) {
                        blocks.pop();
                    } else {
                        issues.push({
                            code: 'TYRANO_KS_UNEXPECTED_CLOSER',
                            severity: 'error',
                            file: relative,
                            line: lineIndex + 1,
                            column: start + 1,
                            message: `Tyrano KS 제어 태그 순서가 맞지 않습니다: ${tagName}`,
                        });
                        invalidFiles.add(relative);
                    }
                }
            }
        }
        for (const block of blocks) {
            issues.push({
                code: 'TYRANO_KS_UNCLOSED_BLOCK',
                severity: 'error',
                file: relative,
                line: block.line,
                column: block.column,
                message: `Tyrano KS ${block.tag} 블록에 ${block.expected} 태그가 없습니다`,
            });
            invalidFiles.add(relative);
        }
    }
    const invalidEntries = invalidFiles.size;
    const entriesChecked = files.length + linkedPathCount;
    return finalizeValidationReport({
        profile: 'tyrano',
        ok: invalidEntries === 0,
        filesChecked: entriesChecked,
        entriesChecked,
        validEntries: entriesChecked - invalidEntries,
        invalidEntries,
        encodingCounts,
        encodingWarnings: issues.filter((issue) => issue.code === 'TYRANO_ENCODING_UNCERTAIN').length,
        tokenErrors: issues.filter((issue) => issue.severity !== 'warning').length,
        issues,
    });
}
