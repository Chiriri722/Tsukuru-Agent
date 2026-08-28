import fs from 'fs';
import path from 'path';
import { Node, parse } from 'acorn';
import { sha256Text } from '../../core/manifest';
import { resolveContainedPathWithoutLinks } from '../../core/pathSafety';
import { ErrorCodes, OperationError } from '../../core/types';

type AstNode = Node & Record<string, unknown>;

export interface GDevelopCodeCandidate {
    file: string;
    value: string;
    start: number;
    end: number;
    quote: '"' | "'";
    callee: 'setString' | 'setBBText';
    candidateIndex: number;
}

export interface GDevelopAmbiguousCandidate {
    file: string;
    value: string;
    start: number;
    end: number;
    reason: string;
}

export interface GDevelopCodeAnalysis {
    files: string[];
    safeCandidates: GDevelopCodeCandidate[];
    approvedContextCandidates: GDevelopCodeCandidate[];
    ambiguousCandidates: GDevelopAmbiguousCandidate[];
    parseErrors: Array<{ file: string; message: string }>;
}

function isAstNode(value: unknown): value is AstNode {
    return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function childNodes(node: AstNode): AstNode[] {
    const children: AstNode[] = [];
    for (const [key, value] of Object.entries(node)) {
        if (['start', 'end', 'loc', 'range', 'type'].includes(key)) continue;
        if (isAstNode(value)) children.push(value);
        else if (Array.isArray(value)) {
            for (const child of value) if (isAstNode(child)) children.push(child);
        }
    }
    return children;
}

function identifierName(node: unknown): string | null {
    if (!isAstNode(node) || node.type !== 'Identifier') return null;
    return typeof node.name === 'string' ? node.name : null;
}

function approvedGeneratedSetter(call: AstNode, literal: AstNode): 'setString' | 'setBBText' | null {
    if (call.type !== 'CallExpression' || !Array.isArray(call.arguments) || call.arguments[0] !== literal) return null;
    const callee = call.callee;
    if (!isAstNode(callee) || callee.type !== 'MemberExpression' || callee.computed === true) return null;
    const method = identifierName(callee.property);
    if (method !== 'setString' && method !== 'setBBText') return null;
    const indexedObject = callee.object;
    if (!isAstNode(indexedObject) || indexedObject.type !== 'MemberExpression' || indexedObject.computed !== true) return null;
    const generatedCollection = indexedObject.object;
    if (!isAstNode(generatedCollection) || generatedCollection.type !== 'MemberExpression') return null;
    const collectionName = identifierName(generatedCollection.property);
    if (!collectionName || !/^GD[A-Za-z0-9_$]+Objects\d+$/.test(collectionName)) return null;
    return method;
}

function ambiguousReason(value: string, approved: boolean): string {
    if (value.trim() === '') return 'empty-or-whitespace';
    if (/^(?:[a-z]+:)?\/\//i.test(value) || /[\\/]/.test(value)
        || /\.(?:png|jpe?g|webp|gif|svg|json|js|css|mp3|ogg|wav|mp4|webm|ttf|woff2?)$/i.test(value)) {
        return 'resource-or-url';
    }
    if (/^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(value)) return 'identifier-like';
    if (!/\p{L}/u.test(value)) return 'no-letter-content';
    return approved ? 'approved-generated-text' : 'unapproved-ast-context';
}

export function analyzeGDevelopCodeSource(source: string, file: string): {
    safeCandidates: GDevelopCodeCandidate[];
    approvedContextCandidates: GDevelopCodeCandidate[];
    ambiguousCandidates: GDevelopAmbiguousCandidate[];
} {
    const root = parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowHashBang: true,
    }) as unknown as AstNode;
    const safeCandidates: GDevelopCodeCandidate[] = [];
    const approvedContextCandidates: GDevelopCodeCandidate[] = [];
    const ambiguousCandidates: GDevelopAmbiguousCandidate[] = [];
    const visit = (node: AstNode, parent: AstNode | null): void => {
        if (node.type === 'Literal' && typeof node.value === 'string') {
            const raw = source.slice(node.start, node.end);
            const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] as '"' | "'" : null;
            const method = parent ? approvedGeneratedSetter(parent, node) : null;
            const reason = ambiguousReason(node.value, method !== null);
            if (method && quote) {
                const candidate: GDevelopCodeCandidate = {
                    file,
                    value: node.value,
                    start: node.start,
                    end: node.end,
                    quote,
                    callee: method,
                    candidateIndex: approvedContextCandidates.length,
                };
                approvedContextCandidates.push(candidate);
                if (reason === 'approved-generated-text') safeCandidates.push(candidate);
                else ambiguousCandidates.push({ file, value: node.value, start: node.start, end: node.end, reason });
            } else {
                ambiguousCandidates.push({ file, value: node.value, start: node.start, end: node.end, reason });
            }
        }
        for (const child of childNodes(node)) visit(child, node);
    };
    visit(root, null);
    return { safeCandidates, approvedContextCandidates, ambiguousCandidates };
}

function findCodeFiles(projectRoot: string): string[] {
    const output: string[] = [];
    const visit = (current: string, relative: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.isSymbolicLink()) {
                throw new OperationError(
                    ErrorCodes.MAPPING_CORRUPT,
                    'GDevelop code 탐색 경로에 심볼릭 링크/정션이 있습니다',
                    { path: path.join(current, entry.name) },
                );
            }
            const child = path.join(current, entry.name);
            const childRelative = relative ? path.join(relative, entry.name) : entry.name;
            if (entry.isDirectory()) {
                if (['_Extract', 'gdjs', 'Extensions', 'node_modules'].includes(entry.name)
                    || (relative === 'libs' && entry.name === 'gdjs')) continue;
                visit(child, childRelative);
            } else if (entry.isFile() && /^code\d*\.js$/i.test(entry.name)) {
                output.push(childRelative.replace(/\\/g, '/'));
            }
        }
    };
    visit(projectRoot, '');
    return output.sort();
}

export function analyzeGDevelopCodeProject(projectRoot: string): GDevelopCodeAnalysis {
    const files = findCodeFiles(projectRoot);
    const safeCandidates: GDevelopCodeCandidate[] = [];
    const approvedContextCandidates: GDevelopCodeCandidate[] = [];
    const ambiguousCandidates: GDevelopAmbiguousCandidate[] = [];
    const parseErrors: Array<{ file: string; message: string }> = [];
    for (const file of files) {
        try {
            const resolution = resolveContainedPathWithoutLinks(projectRoot, file);
            if (resolution.ok === false) {
                throw new OperationError(
                    ErrorCodes.MAPPING_CORRUPT,
                    resolution.reason === 'linked'
                        ? 'GDevelop code 파일 경로에 심볼릭 링크/정션이 있습니다'
                        : 'GDevelop code 파일 경로가 프로젝트 밖을 가리킵니다',
                    { file },
                );
            }
            const analyzed = analyzeGDevelopCodeSource(fs.readFileSync(resolution.path, 'utf8'), file);
            safeCandidates.push(...analyzed.safeCandidates);
            approvedContextCandidates.push(...analyzed.approvedContextCandidates);
            ambiguousCandidates.push(...analyzed.ambiguousCandidates);
        } catch (error) {
            if (error instanceof OperationError) throw error;
            parseErrors.push({ file, message: error instanceof Error ? error.message : String(error) });
        }
    }
    return { files, safeCandidates, approvedContextCandidates, ambiguousCandidates, parseErrors };
}

export function encodeJavaScriptString(value: string, quote: '"' | "'"): string {
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
        .replace(new RegExp(quote, 'g'), '\\' + quote);
    return quote + escaped + quote;
}

export function rewriteGDevelopCodeSource(
    source: string,
    replacements: Array<GDevelopCodeCandidate & { replacement: string; sourceHash: string }>,
): string {
    let output = source;
    let previousStart = source.length + 1;
    for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
        if (replacement.start >= replacement.end || replacement.end > source.length || replacement.end > previousStart) {
            throw new Error('GDevelop code literal 범위가 중복되거나 파일 밖을 가리킵니다');
        }
        if (sha256Text(replacement.value) !== replacement.sourceHash) {
            throw new Error('GDevelop code literal 원문 해시가 일치하지 않습니다');
        }
        output = output.slice(0, replacement.start)
            + encodeJavaScriptString(replacement.replacement, replacement.quote)
            + output.slice(replacement.end);
        previousStart = replacement.start;
    }
    return output;
}
