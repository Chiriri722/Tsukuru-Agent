import fs from 'fs';
import os from 'os';
import path from 'path';
import { atomicWriteFileSync, makeStagingDir, replaceDirSync } from '../../core/atomic';
import { createManifest, ExtractManifest, MANIFEST_FILE, ManifestEntry, sha256Bytes, sha256Text } from '../../core/manifest';
import { ErrorCodes, OperationError } from '../../core/types';
import { diffFileMaps, snapshotDirectory, StructuralValidationReport } from '../../core/validator';

export interface GDevelopExtractOptions {
    projectRoot: string;
    force?: boolean;
}

export interface GDevelopExtractReport {
    extractDir: string;
    manifestPath: string;
    extractedFiles: number;
    extractedEntries: number;
}

export interface GDevelopApplyOptions {
    projectRoot: string;
    outputRoot: string;
    force?: boolean;
}

export interface GDevelopApplyReport {
    outputRoot: string;
    appliedFiles: number;
    appliedEntries: number;
    validation: StructuralValidationReport;
}

interface ProjectDataScript {
    projectData: unknown;
    prefix: string;
    suffix: string;
}

interface TextCandidate {
    pointer: string;
    text: string;
    objectType: string;
    field: string;
}

const STATIC_TEXT_FIELDS: Record<string, string[]> = {
    'TextObject::Text': ['string'],
    'BBText::BBText': ['text'],
};

function findDataFile(projectRoot: string): string {
    const candidates = [path.join(projectRoot, 'data.js'), path.join(projectRoot, 'www', 'data.js')];
    const found = candidates.find((candidate) => {
        try { return fs.lstatSync(candidate).isFile(); } catch { return false; }
    });
    if (!found) throw new OperationError(ErrorCodes.PATH_NOT_FOUND, 'GDevelop data.js 파일이 없습니다', { projectRoot });
    return found;
}

function findJsonObjectEnd(source: string, start: number): number {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index++) {
        const current = source[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (current === '\\') escaped = true;
            else if (current === '"') inString = false;
            continue;
        }
        if (current === '"') inString = true;
        else if (current === '{') depth++;
        else if (current === '}') {
            depth--;
            if (depth === 0) return index + 1;
            if (depth < 0) break;
        }
    }
    throw new OperationError(ErrorCodes.VERIFY_FAILED, 'GDevelop data.js의 projectData JSON 범위가 닫히지 않았습니다');
}

function parseProjectDataScript(source: string): ProjectDataScript {
    const assignment = /\bgdjs\.projectData\s*=\s*/g.exec(source);
    if (!assignment) throw new OperationError(ErrorCodes.VERIFY_FAILED, 'GDevelop data.js에서 gdjs.projectData 할당을 찾지 못했습니다');
    const start = assignment.index + assignment[0].length;
    if (source[start] !== '{') throw new OperationError(ErrorCodes.VERIFY_FAILED, 'GDevelop gdjs.projectData가 JSON 객체가 아닙니다');
    const end = findJsonObjectEnd(source, start);
    try {
        return {
            projectData: JSON.parse(source.slice(start, end)),
            prefix: source.slice(0, start),
            suffix: source.slice(end),
        };
    } catch (error) {
        throw new OperationError(ErrorCodes.VERIFY_FAILED, 'GDevelop gdjs.projectData JSON 파싱에 실패했습니다', { error: String(error) });
    }
}

function pointerSegment(value: string | number): string {
    return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function collectTextCandidates(value: unknown): TextCandidate[] {
    const output: TextCandidate[] = [];
    const visit = (current: unknown, pathSegments: Array<string | number>): void => {
        if (Array.isArray(current)) {
            current.forEach((item, index) => visit(item, [...pathSegments, index]));
            return;
        }
        if (typeof current !== 'object' || current === null) return;
        const object = current as Record<string, unknown>;
        const objectType = typeof object.type === 'string' ? object.type : '';
        const fields = STATIC_TEXT_FIELDS[objectType] ?? [];
        for (const field of fields) {
            const text = object[field];
            if (typeof text !== 'string' || text.length === 0) continue;
            const pointer = '/' + [...pathSegments, field].map(pointerSegment).join('/');
            output.push({ pointer, text, objectType, field });
        }
        for (const [key, child] of Object.entries(object)) visit(child, [...pathSegments, key]);
    };
    visit(value, []);
    return output;
}

function safeChild(root: string, relativePath: unknown, label: string): string {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `안전하지 않은 GDevelop ${label} 경로입니다`, { relativePath });
    }
    const target = path.resolve(root, relativePath);
    const relative = path.relative(path.resolve(root), target);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `GDevelop ${label} 경로가 작업 루트 밖을 가리킵니다`, { relativePath });
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

function decodePointerSegment(value: string): string {
    if (/~(?:[^01]|$)/.test(value)) throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'GDevelop JSON Pointer escape가 올바르지 않습니다', { value });
    return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerTarget(root: unknown, pointer: unknown): { parent: Record<string, unknown> | unknown[]; key: string; value: unknown } {
    if (typeof pointer !== 'string' || !pointer.startsWith('/') || pointer === '/') {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'GDevelop JSON Pointer가 올바르지 않습니다', { pointer });
    }
    const segments = pointer.slice(1).split('/').map(decodePointerSegment);
    if (segments.some((segment) => ['__proto__', 'prototype', 'constructor'].includes(segment))) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'GDevelop JSON Pointer에 금지된 속성이 있습니다', { pointer });
    }
    let current: unknown = root;
    for (const segment of segments.slice(0, -1)) {
        if (Array.isArray(current)) {
            if (!/^\d+$/.test(segment) || Number(segment) >= current.length) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'GDevelop JSON Pointer 배열 인덱스가 올바르지 않습니다', { pointer });
            }
            current = current[Number(segment)];
        } else if (typeof current === 'object' && current !== null && Object.prototype.hasOwnProperty.call(current, segment)) {
            current = (current as Record<string, unknown>)[segment];
        } else {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'GDevelop JSON Pointer 대상을 찾지 못했습니다', { pointer });
        }
    }
    if ((typeof current !== 'object' && !Array.isArray(current)) || current === null) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'GDevelop JSON Pointer 부모가 객체가 아닙니다', { pointer });
    }
    const key = segments[segments.length - 1];
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'GDevelop JSON Pointer 필드를 찾지 못했습니다', { pointer });
    }
    return { parent: current as Record<string, unknown> | unknown[], key, value: (current as Record<string, unknown>)[key] };
}

export class GDevelopService {
    extract(options: GDevelopExtractOptions): GDevelopExtractReport {
        const projectRoot = path.resolve(options.projectRoot);
        const dataFile = findDataFile(projectRoot);
        const sourceRelative = path.relative(projectRoot, dataFile).replace(/\\/g, '/');
        const sourceBytes = fs.readFileSync(dataFile);
        let source: string;
        try {
            source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
        } catch {
            throw new OperationError(ErrorCodes.VERIFY_FAILED, 'GDevelop data.js는 UTF-8이어야 합니다', { sourceFile: sourceRelative });
        }
        const parsed = parseProjectDataScript(source);
        const candidates = collectTextCandidates(parsed.projectData);
        const extractDir = path.join(projectRoot, '_Extract');
        if (fs.existsSync(extractDir)) {
            if (options.force !== true) throw new OperationError(ErrorCodes.EXTRACT_EXISTS, 'GDevelop _Extract 폴더가 이미 존재합니다', { extractDir });
            fs.rmSync(extractDir, { recursive: true, force: true });
        }
        fs.mkdirSync(extractDir, { recursive: true });
        const extractFile = 'gdevelop-text.txt';
        const outputLines: string[] = [];
        const manifest = createManifest('gdevelop');
        manifest.sourceSnapshots = {
            [sourceRelative]: { hash: sha256Bytes(sourceBytes), encoding: 'utf8' },
        };
        for (const candidate of candidates) {
            const lines = candidate.text.split('\n');
            const lineStart = outputLines.length;
            outputLines.push(...lines);
            manifest.entries.push({
                id: `${sourceRelative}#${candidate.pointer}`,
                sourceFile: sourceRelative,
                dataPath: candidate.pointer,
                extractFile,
                lineStart,
                lineEnd: outputLines.length,
                hash: sha256Text(candidate.text),
                encoding: 'utf8',
                nullTerminated: false,
                gdevelop: {
                    jsonPointer: candidate.pointer,
                    objectType: candidate.objectType,
                    field: candidate.field,
                    sourceHash: sha256Text(candidate.text),
                },
            });
        }
        atomicWriteFileSync(path.join(extractDir, extractFile), outputLines.join('\n'));
        const manifestPath = path.join(extractDir, MANIFEST_FILE);
        atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        return {
            extractDir,
            manifestPath,
            extractedFiles: candidates.length > 0 ? 1 : 0,
            extractedEntries: candidates.length,
        };
    }

    applyToCopy(options: GDevelopApplyOptions): GDevelopApplyReport {
        const projectRoot = path.resolve(options.projectRoot);
        const outputRoot = path.resolve(options.outputRoot);
        if (pathsOverlap(projectRoot, outputRoot)) {
            throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, 'GDevelop 출력은 원본 프로젝트 밖이어야 합니다', { outputRoot });
        }
        if (fs.existsSync(outputRoot) && options.force !== true) {
            throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, 'GDevelop 출력 경로가 이미 존재합니다', { outputRoot });
        }
        const dataFile = findDataFile(projectRoot);
        const sourceRelative = path.relative(projectRoot, dataFile).replace(/\\/g, '/');
        const extractDir = path.join(projectRoot, '_Extract');
        const manifestPath = path.join(extractDir, MANIFEST_FILE);
        if (!fs.existsSync(manifestPath)) {
            throw new OperationError(ErrorCodes.MANIFEST_MISSING, 'GDevelop manifest.json이 없습니다. 먼저 extract를 실행하세요', { manifestPath });
        }
        let manifest: ExtractManifest;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (error) {
            throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, 'GDevelop manifest.json 파싱에 실패했습니다', { error: String(error) });
        }
        if (manifest.format !== 'gdevelop' || !Array.isArray(manifest.entries) || !manifest.sourceSnapshots) {
            throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, 'GDevelop manifest 구조가 올바르지 않습니다');
        }
        const sourceSnapshot = manifest.sourceSnapshots[sourceRelative];
        const sourceBytes = fs.readFileSync(dataFile);
        if (!sourceSnapshot || sourceSnapshot.encoding !== 'utf8' || sha256Bytes(sourceBytes) !== sourceSnapshot.hash) {
            throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'GDevelop data.js가 extract 이후 변경되었습니다', { sourceFile: sourceRelative });
        }
        let source: string;
        try { source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes); }
        catch { throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'GDevelop data.js 인코딩이 변경되었습니다', { sourceFile: sourceRelative }); }
        const parsed = parseProjectDataScript(source);
        const extractedLines = new Map<string, string[]>();
        const ids = new Set<string>();
        for (const entry of manifest.entries) {
            this.applyEntry(projectRoot, extractDir, sourceRelative, parsed.projectData, entry, extractedLines, ids);
        }
        const changedSource = parsed.prefix + JSON.stringify(parsed.projectData) + parsed.suffix;
        const before = snapshotDirectory(projectRoot);
        const staging = makeStagingDir(path.dirname(outputRoot), `.${path.basename(outputRoot)}-gdevelop-staging`);
        let completed = false;
        try {
            fs.rmSync(staging, { recursive: true, force: true });
            fs.cpSync(projectRoot, staging, {
                recursive: true,
                filter: (candidate) => {
                    const relative = path.relative(extractDir, path.resolve(candidate));
                    return relative !== '' && (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
                },
            });
            atomicWriteFileSync(safeChild(staging, sourceRelative, '출력'), changedSource);
            const verifiedSource = fs.readFileSync(safeChild(staging, sourceRelative, '출력'), 'utf8');
            const verified = parseProjectDataScript(verifiedSource);
            let validEntries = 0;
            for (const entry of manifest.entries) {
                const target = pointerTarget(verified.projectData, entry.gdevelop?.jsonPointer);
                if (typeof target.value === 'string' && sha256Text(target.value) === entry.hash) validEntries++;
            }
            const change = diffFileMaps(before, snapshotDirectory(staging));
            if (change.protectedScriptDamage > 0) {
                throw new OperationError(ErrorCodes.VERIFY_FAILED, 'GDevelop 적용 과정에서 보호 런타임 스크립트가 변경되었습니다', { change });
            }
            const invalidEntries = manifest.entries.length - validEntries;
            const validation: StructuralValidationReport = {
                profile: 'gdevelop',
                ok: invalidEntries === 0,
                filesChecked: 1,
                entriesChecked: manifest.entries.length,
                validEntries,
                invalidEntries,
                encodingCounts: { utf8: 1, shiftJis: 0, unknown: 0 },
                encodingWarnings: 0,
                tokenErrors: invalidEntries,
                issues: invalidEntries === 0 ? [] : [{
                    code: 'GDEVELOP_REINSERTION_MISMATCH', severity: 'critical', file: sourceRelative,
                    message: 'GDevelop 재삽입 문자열 검증에 실패했습니다',
                }],
            };
            if (!validation.ok) throw new OperationError(ErrorCodes.VERIFY_FAILED, 'GDevelop 적용본 검증에 실패했습니다', validation);
            if (sha256Bytes(fs.readFileSync(dataFile)) !== sourceSnapshot.hash) {
                throw new OperationError(ErrorCodes.SOURCE_CHANGED, '작업 도중 GDevelop 원본 data.js가 변경되었습니다', { sourceFile: sourceRelative });
            }
            replaceDirSync(staging, outputRoot);
            completed = true;
            return {
                outputRoot,
                appliedFiles: manifest.entries.length > 0 ? 1 : 0,
                appliedEntries: manifest.entries.length,
                validation,
            };
        } finally {
            if (!completed && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
        }
    }

    private applyEntry(
        projectRoot: string,
        extractDir: string,
        sourceRelative: string,
        projectData: unknown,
        entry: ManifestEntry,
        extractedLines: Map<string, string[]>,
        ids: Set<string>,
    ): void {
        if (ids.has(entry.id)) throw new OperationError(ErrorCodes.MANIFEST_CORRUPT, `GDevelop manifest에 중복 id가 있습니다: ${entry.id}`);
        ids.add(entry.id);
        const meta = entry.gdevelop;
        if (!meta || entry.sourceFile.replace(/\\/g, '/') !== sourceRelative || meta.jsonPointer !== entry.dataPath) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `GDevelop source/JSON Pointer 매핑이 올바르지 않습니다: ${entry.id}`);
        }
        safeChild(projectRoot, entry.sourceFile, '원본');
        if (!STATIC_TEXT_FIELDS[meta.objectType]?.includes(meta.field)) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `허용되지 않은 GDevelop 텍스트 객체 필드입니다: ${entry.id}`);
        }
        const extractPath = safeChild(extractDir, entry.extractFile, '추출 파일');
        if (!fs.existsSync(extractPath)) throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `GDevelop 추출 텍스트 파일이 없습니다: ${entry.extractFile}`);
        if (!extractedLines.has(extractPath)) extractedLines.set(extractPath, fs.readFileSync(extractPath, 'utf8').split('\n'));
        const lines = extractedLines.get(extractPath)!;
        if (!Number.isInteger(entry.lineStart) || !Number.isInteger(entry.lineEnd)
            || entry.lineStart < 0 || entry.lineStart >= entry.lineEnd || entry.lineEnd > lines.length) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `GDevelop 추출 줄 매핑이 손상되었습니다: ${entry.id}`);
        }
        const replacement = lines.slice(entry.lineStart, entry.lineEnd).join('\n');
        if (sha256Text(replacement) !== entry.hash) {
            throw new OperationError(ErrorCodes.PATCH_HASH_MISMATCH, `GDevelop 추출 텍스트 해시가 manifest와 다릅니다: ${entry.id}`);
        }
        const target = pointerTarget(projectData, meta.jsonPointer);
        const parent = target.parent as Record<string, unknown>;
        if (target.key !== meta.field || parent.type !== meta.objectType || typeof target.value !== 'string'
            || sha256Text(target.value) !== meta.sourceHash) {
            throw new OperationError(ErrorCodes.SOURCE_CHANGED, `GDevelop 원본 텍스트 객체가 extract 이후 변경되었습니다: ${entry.id}`);
        }
        parent[target.key] = replacement;
    }

    verifyWorkspace(projectRoot: string): StructuralValidationReport {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsukuru-gdevelop-verify-'));
        try {
            return this.applyToCopy({ projectRoot, outputRoot: path.join(tempRoot, 'output') }).validation;
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    }
}
