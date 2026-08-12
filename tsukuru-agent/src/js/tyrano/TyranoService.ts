import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import iconv from 'iconv-lite';
import { atomicWriteFileSync, makeStagingDir, replaceDirSync } from '../../core/atomic';
import { createManifest, ExtractManifest, MANIFEST_FILE, ManifestEntry, sha256Text } from '../../core/manifest';
import { ErrorCodes, OperationError } from '../../core/types';
import { inspectTyranoProject, StructuralValidationReport } from '../../core/validator';

export interface TyranoExtractOptions {
    projectRoot: string;
    force?: boolean;
}

export interface TyranoExtractReport {
    extractDir: string;
    manifestPath: string;
    extractedFiles: number;
    extractedEntries: number;
}

export interface TyranoApplyOptions {
    projectRoot: string;
    outputRoot: string;
    force?: boolean;
}

export interface TyranoApplyReport {
    outputRoot: string;
    appliedFiles: number;
    appliedEntries: number;
    validation: StructuralValidationReport;
}

interface TextSegment {
    text: string;
    line: number;
    start: number;
    end: number;
}

function sha256Bytes(bytes: Buffer): string {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function decodeSource(bytes: Buffer, file: string): { text: string; encoding: 'utf8' | 'shift_jis' } {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return { text: bytes.subarray(3).toString('utf8'), encoding: 'utf8' };
    }
    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
    } catch {
        const text = iconv.decode(bytes, 'shift_jis');
        if (iconv.encode(text, 'shift_jis').equals(bytes)) return { text, encoding: 'shift_jis' };
        throw new OperationError(ErrorCodes.VERIFY_FAILED, 'Tyrano KS 인코딩을 안전하게 판별할 수 없습니다', { file });
    }
}

function appendVisibleSegment(line: string, lineIndex: number, start: number, end: number, output: TextSegment[]): void {
    while (start < end && /\s/.test(line[start])) start++;
    while (end > start && /\s/.test(line[end - 1])) end--;
    if (start >= end) return;
    output.push({ text: line.slice(start, end), line: lineIndex, start, end });
}

function extractSegments(text: string): TextSegment[] {
    const output: TextSegment[] = [];
    const lines = text.split(/\r?\n/);
    let inScript = false;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        if (inScript) {
            if (/\[\s*endscript\b[^\]]*\]/i.test(line)) inScript = false;
            continue;
        }
        if (/^\s*(?:;|\*|@)/.test(line) || line.trim() === '') continue;
        if (/^\s*\[\s*iscript\b[^\]]*\]\s*$/i.test(line)) {
            inScript = true;
            continue;
        }
        let visibleStart = 0;
        for (let cursor = 0; cursor < line.length; cursor++) {
            if (line[cursor] !== '[') continue;
            appendVisibleSegment(line, lineIndex, visibleStart, cursor, output);
            let quote: string | null = null;
            let escaped = false;
            for (cursor++; cursor < line.length; cursor++) {
                const current = line[cursor];
                if (escaped) {
                    escaped = false;
                } else if (current === '\\') {
                    escaped = true;
                } else if (quote) {
                    if (current === quote) quote = null;
                } else if (current === '"' || current === "'") {
                    quote = current;
                } else if (current === ']') {
                    break;
                }
            }
            visibleStart = Math.min(cursor + 1, line.length);
        }
        appendVisibleSegment(line, lineIndex, visibleStart, line.length, output);
    }
    return output;
}

function scenarioFiles(scenarioRoot: string): string[] {
    const files: string[] = [];
    const visit = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const child = path.join(current, entry.name);
            if (entry.isSymbolicLink()) throw new OperationError(ErrorCodes.VERIFY_FAILED, 'Tyrano scenario에 심볼릭 링크/정션을 사용할 수 없습니다', { child });
            if (entry.isDirectory()) visit(child);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.ks')) files.push(child);
        }
    };
    visit(scenarioRoot);
    return files.sort();
}

function safeChild(root: string, relativePath: unknown, label: string): string {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `안전하지 않은 Tyrano ${label} 경로입니다`, { relativePath });
    }
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `Tyrano ${label} 경로가 작업 루트 밖을 가리킵니다`, { relativePath });
    }
    return target;
}

function pathsOverlap(left: string, right: string): boolean {
    const contains = (parent: string, child: string): boolean => {
        const relative = path.relative(path.resolve(parent), path.resolve(child));
        return relative === '' || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    };
    return contains(left, right) || contains(right, left);
}

export class TyranoService {
    extract(options: TyranoExtractOptions): TyranoExtractReport {
        const projectRoot = path.resolve(options.projectRoot);
        const dataRoot = path.join(projectRoot, 'data');
        const scenarioRoot = path.join(dataRoot, 'scenario');
        if (!fs.existsSync(scenarioRoot) || !fs.statSync(scenarioRoot).isDirectory()) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, 'Tyrano data/scenario 폴더가 없습니다', { scenarioRoot });
        }
        const structure = inspectTyranoProject(projectRoot);
        if (!structure.ok) {
            throw new OperationError(ErrorCodes.VERIFY_FAILED, 'Tyrano 원본 구조 검증에 실패했습니다', structure);
        }
        const extractDir = path.join(dataRoot, '_Extract');
        if (fs.existsSync(extractDir)) {
            if (options.force !== true) throw new OperationError(ErrorCodes.EXTRACT_EXISTS, 'Tyrano _Extract 폴더가 이미 존재합니다', { extractDir });
            fs.rmSync(extractDir, { recursive: true, force: true });
        }
        fs.mkdirSync(extractDir, { recursive: true });
        const manifest = createManifest('tyrano');
        manifest.sourceSnapshots = {};
        let extractedFiles = 0;
        for (const sourcePath of scenarioFiles(scenarioRoot)) {
            const sourceRelative = path.relative(projectRoot, sourcePath).replace(/\\/g, '/');
            const bytes = fs.readFileSync(sourcePath);
            const decoded = decodeSource(bytes, sourceRelative);
            manifest.sourceSnapshots[sourceRelative] = { hash: sha256Bytes(bytes), encoding: decoded.encoding };
            const segments = extractSegments(decoded.text);
            if (segments.length === 0) continue;
            const scenarioRelative = path.relative(scenarioRoot, sourcePath).replace(/\\/g, '/');
            const extractFile = `scenario/${scenarioRelative}.txt`;
            const target = path.join(extractDir, ...extractFile.split('/'));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            atomicWriteFileSync(target, segments.map((segment) => segment.text).join('\n'));
            extractedFiles++;
            for (let index = 0; index < segments.length; index++) {
                const segment = segments[index];
                manifest.entries.push({
                    id: `${sourceRelative}#L${segment.line + 1}:C${segment.start + 1}-${segment.end + 1}`,
                    sourceFile: sourceRelative,
                    dataPath: `line:${segment.line}:columns:${segment.start}-${segment.end}`,
                    extractFile,
                    lineStart: index,
                    lineEnd: index + 1,
                    hash: sha256Text(segment.text),
                    encoding: decoded.encoding,
                    nullTerminated: false,
                    tyrano: {
                        line: segment.line,
                        start: segment.start,
                        end: segment.end,
                        sourceHash: sha256Text(segment.text),
                    },
                });
            }
        }
        const manifestPath = path.join(extractDir, MANIFEST_FILE);
        atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        return { extractDir, manifestPath, extractedFiles, extractedEntries: manifest.entries.length };
    }

    applyToCopy(options: TyranoApplyOptions): TyranoApplyReport {
        const projectRoot = path.resolve(options.projectRoot);
        const outputRoot = path.resolve(options.outputRoot);
        if (pathsOverlap(projectRoot, outputRoot)) {
            throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, 'Tyrano 출력은 원본 프로젝트 밖이어야 합니다', { outputRoot });
        }
        if (fs.existsSync(outputRoot) && options.force !== true) {
            throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, 'Tyrano 출력 경로가 이미 존재합니다', { outputRoot });
        }
        const extractDir = path.join(projectRoot, 'data', '_Extract');
        const manifestPath = path.join(extractDir, MANIFEST_FILE);
        if (!fs.existsSync(manifestPath)) {
            throw new OperationError(ErrorCodes.MANIFEST_MISSING, 'Tyrano manifest.json이 없습니다. 먼저 extract를 실행하세요', { manifestPath });
        }
        let manifest: ExtractManifest;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (error) {
            throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, 'Tyrano manifest.json 파싱에 실패했습니다', { error: String(error) });
        }
        if (manifest.format !== 'tyrano' || !Array.isArray(manifest.entries) || !manifest.sourceSnapshots) {
            throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, 'Tyrano manifest 구조가 올바르지 않습니다');
        }
        const snapshotEntries = Object.entries(manifest.sourceSnapshots);
        const assertSourcesUnchanged = (): void => {
            for (const [relative, snapshot] of snapshotEntries) {
                const sourcePath = safeChild(projectRoot, relative, '원본');
                if (!fs.existsSync(sourcePath) || sha256Bytes(fs.readFileSync(sourcePath)) !== snapshot.hash) {
                    throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'Tyrano 원본 시나리오가 extract 이후 변경되었습니다', { sourceFile: relative });
                }
            }
        };
        assertSourcesUnchanged();

        const extractedLines = new Map<string, string[]>();
        const replacementsBySource = new Map<string, Array<{ entry: ManifestEntry; replacement: string }>>();
        const ids = new Set<string>();
        for (const entry of manifest.entries) {
            if (ids.has(entry.id)) throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, `Tyrano manifest에 중복 id가 있습니다: ${entry.id}`);
            ids.add(entry.id);
            if (!entry.tyrano) throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, `Tyrano 위치 metadata가 없습니다: ${entry.id}`);
            const normalizedSource = entry.sourceFile.replace(/\\/g, '/');
            if (!/^data\/scenario\/.+\.ks$/i.test(normalizedSource)) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `Tyrano manifest sourceFile은 data/scenario 아래 KS만 허용합니다: ${entry.sourceFile}`);
            }
            const extractPath = safeChild(extractDir, entry.extractFile, '추출 파일');
            if (!fs.existsSync(extractPath)) throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `Tyrano 추출 텍스트 파일이 없습니다: ${entry.extractFile}`);
            if (!extractedLines.has(extractPath)) extractedLines.set(extractPath, fs.readFileSync(extractPath, 'utf8').split('\n'));
            const lines = extractedLines.get(extractPath)!;
            if (!Number.isInteger(entry.lineStart) || !Number.isInteger(entry.lineEnd)
                || entry.lineStart < 0 || entry.lineStart >= entry.lineEnd || entry.lineEnd > lines.length) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `Tyrano 추출 줄 매핑이 손상되었습니다: ${entry.id}`);
            }
            const replacement = lines.slice(entry.lineStart, entry.lineEnd).join('\n');
            if (sha256Text(replacement) !== entry.hash) {
                throw new OperationError(ErrorCodes.PATCH_HASH_MISMATCH, `Tyrano 추출 텍스트 해시가 manifest와 다릅니다: ${entry.id}`);
            }
            const sourceEntries = replacementsBySource.get(entry.sourceFile) ?? [];
            sourceEntries.push({ entry, replacement });
            replacementsBySource.set(entry.sourceFile, sourceEntries);
        }

        const changedFiles = new Map<string, Buffer>();
        for (const [sourceRelative, replacements] of replacementsBySource) {
            const sourcePath = safeChild(projectRoot, sourceRelative, '원본');
            const snapshot = manifest.sourceSnapshots[sourceRelative];
            if (!snapshot) throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, `Tyrano source snapshot이 없습니다: ${sourceRelative}`);
            const decoded = decodeSource(fs.readFileSync(sourcePath), sourceRelative);
            if (decoded.encoding !== snapshot.encoding) throw new OperationError(ErrorCodes.SOURCE_CHANGED, `Tyrano 원본 인코딩이 변경되었습니다: ${sourceRelative}`);
            const eol = decoded.text.includes('\r\n') ? '\r\n' : '\n';
            const lines = decoded.text.split(/\r?\n/);
            const lineOffsets: number[] = [];
            let offset = 0;
            for (let index = 0; index < lines.length; index++) {
                lineOffsets.push(offset);
                offset += lines[index].length + (index < lines.length - 1 ? eol.length : 0);
            }
            const spans = replacements.map(({ entry, replacement }) => {
                const meta = entry.tyrano!;
                const line = lines[meta.line];
                if (line === undefined || !Number.isInteger(meta.start) || !Number.isInteger(meta.end)
                    || meta.start < 0 || meta.start >= meta.end || meta.end > line.length) {
                    throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `Tyrano 원본 column 매핑이 손상되었습니다: ${entry.id}`);
                }
                const sourceText = line.slice(meta.start, meta.end);
                if (sha256Text(sourceText) !== meta.sourceHash) {
                    throw new OperationError(ErrorCodes.SOURCE_CHANGED, `Tyrano 원본 대사 위치가 extract 이후 변경되었습니다: ${entry.id}`);
                }
                return {
                    id: entry.id,
                    start: lineOffsets[meta.line] + meta.start,
                    end: lineOffsets[meta.line] + meta.end,
                    replacement: replacement.replace(/\r?\n/g, eol),
                };
            }).sort((left, right) => left.start - right.start);
            for (let index = 1; index < spans.length; index++) {
                if (spans[index].start < spans[index - 1].end) {
                    throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `Tyrano 원본 대사 범위가 겹칩니다: ${spans[index].id}`);
                }
            }
            let output = decoded.text;
            for (const span of spans.slice().sort((left, right) => right.start - left.start)) {
                output = output.slice(0, span.start) + span.replacement + output.slice(span.end);
            }
            if (snapshot.encoding === 'shift_jis') {
                const encoded = iconv.encode(output, 'shift_jis');
                if (iconv.decode(encoded, 'shift_jis') !== output) {
                    throw new OperationError(ErrorCodes.ENCODING_UNREPRESENTABLE, `번역문을 Shift_JIS로 손실 없이 표현할 수 없습니다: ${sourceRelative}`);
                }
                changedFiles.set(sourceRelative, encoded);
            } else {
                changedFiles.set(sourceRelative, Buffer.from(output, 'utf8'));
            }
        }

        const staging = makeStagingDir(path.dirname(outputRoot), `.${path.basename(outputRoot)}-tyrano-staging`);
        let completed = false;
        try {
            // fs.cpSync는 이미 존재하는 destination에는 source basename을 한 단계 더 만들 수 있으므로
            // staging 예약 경로만 확보한 뒤 실제 copy destination은 존재하지 않는 상태로 둔다.
            fs.rmSync(staging, { recursive: true, force: true });
            fs.cpSync(projectRoot, staging, {
                recursive: true,
                filter: (source) => {
                    const relative = path.relative(extractDir, path.resolve(source));
                    return relative !== '' && (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
                },
            });
            for (const [relative, bytes] of changedFiles) {
                atomicWriteFileSync(safeChild(staging, relative, '출력'), bytes);
            }
            const validation = inspectTyranoProject(staging);
            if (!validation.ok) {
                throw new OperationError(ErrorCodes.VERIFY_FAILED, 'Tyrano 적용본 구조 검증에 실패했습니다', validation);
            }
            validation.entriesChecked = manifest.entries.length;
            validation.validEntries = manifest.entries.length;
            validation.invalidEntries = 0;
            assertSourcesUnchanged();
            replaceDirSync(staging, outputRoot);
            completed = true;
            return {
                outputRoot,
                appliedFiles: changedFiles.size,
                appliedEntries: manifest.entries.length,
                validation,
            };
        } finally {
            if (!completed && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
        }
    }

    verifyWorkspace(projectRoot: string): StructuralValidationReport {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-tyrano-verify-'));
        try {
            return this.applyToCopy({ projectRoot, outputRoot: path.join(tempRoot, 'output') }).validation;
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    }
}
