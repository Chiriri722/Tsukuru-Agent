import fs from 'fs';
import path from 'path';
import { atomicWriteFileSync } from './atomic';
import { ContainerInfo } from './container';
import { ErrorCodes, OperationError } from './types';

export const CONTAINER_PROVENANCE_FILE = '.tsukuru-container.json';
const PROVENANCE_SCHEMA_VERSION = 1;
const MAX_ARCHIVE_FILES = 20000;

export interface ContainerProvenance {
    schemaVersion: 1;
    containerType: 'electron-asar' | 'nwjs-package';
    archiveRelativePath: string;
    archiveSha256: string;
    engine: {
        type: 'rpgmv' | 'rpgmz' | 'gdevelop';
        root: string;
    };
    archiveFiles: string[];
    unpackedFiles: string[];
    requiredEntries: string[];
    invalidEntryCount: number;
}

function invalid(message: string, details?: unknown): OperationError {
    return new OperationError(ErrorCodes.CONTAINER_PROVENANCE_INVALID, message, details);
}

function normalizeRelative(value: string, allowEmpty = false): string {
    const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normalized && allowEmpty) return '';
    const segments = normalized.split('/');
    if ((!normalized && !allowEmpty)
        || path.posix.isAbsolute(normalized)
        || /^[a-z]:/i.test(normalized)
        || normalized.includes('\0')
        || segments.some((segment) => segment === '.' || segment === '..' || segment === '')) {
        throw invalid('provenance에 안전하지 않은 상대 경로가 있습니다', { value });
    }
    return normalized;
}

function regularFiles(root: string): string[] {
    const files: string[] = [];
    const visit = (current: string, relative: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) {
                throw invalid('컨테이너 작업본에 심볼릭 링크/정션을 사용할 수 없습니다', { path: path.join(current, entry.name) });
            }
            const childRelative = relative ? path.join(relative, entry.name) : entry.name;
            const child = path.join(current, entry.name);
            if (entry.isDirectory()) {
                visit(child, childRelative);
            } else if (entry.isFile()) {
                if (files.length >= MAX_ARCHIVE_FILES) {
                    throw invalid('컨테이너 파일 수 제한을 초과했습니다', { maxFiles: MAX_ARCHIVE_FILES });
                }
                files.push(normalizeRelative(childRelative));
            }
        }
    };
    visit(path.resolve(root), '');
    return files.sort();
}

function chooseRequiredEntries(files: string[], engineRoot: string): string[] {
    const prefix = engineRoot ? `${engineRoot}/` : '';
    const candidates = [
        'package.json',
        `${prefix}package.json`,
        `${prefix}js/rmmz_core.js`,
        `${prefix}index.html`,
        `${prefix}data.js`,
        files.find((entry) => entry.startsWith(`${prefix}gdjs/`) && entry.endsWith('.js')),
        files.find((entry) => entry.startsWith(`${prefix}data/`) && entry.endsWith('.json')),
    ];
    return [...new Set(candidates.filter((entry): entry is string => typeof entry === 'string' && files.includes(entry)))];
}

export function createContainerProvenance(info: ContainerInfo, extractedRoot: string): ContainerProvenance {
    if ((info.type !== 'electron-asar' && info.type !== 'nwjs-package') || !info.archive || !info.archivePath) {
        throw invalid('지원하는 archive 정보가 없어 provenance를 만들 수 없습니다');
    }
    if (info.engine.type !== 'rpgmv' && info.engine.type !== 'rpgmz' && info.engine.type !== 'gdevelop') {
        throw invalid('지원하지 않는 provenance 엔진입니다', { engine: info.engine.type });
    }
    const extractedFiles = new Set(regularFiles(extractedRoot));
    const archiveFiles = [...info.archive.fileEntries].sort();
    const missingFiles = archiveFiles.filter((entry) => !extractedFiles.has(entry));
    if (missingFiles.length > 0) {
        throw invalid('추출된 컨테이너 작업본에 원본 파일이 누락되었습니다', { missingFiles: missingFiles.slice(0, 20) });
    }
    const engineRoot = normalizeRelative(info.engine.root, true);
    const archiveRelativePath = normalizeRelative(path.relative(info.rootPath, info.archivePath));
    return {
        schemaVersion: PROVENANCE_SCHEMA_VERSION,
        containerType: info.type,
        archiveRelativePath,
        archiveSha256: info.archive.sha256,
        engine: { type: info.engine.type, root: engineRoot },
        archiveFiles,
        unpackedFiles: info.archive.unpackedEntries.filter((entry) => archiveFiles.includes(entry)),
        requiredEntries: chooseRequiredEntries(archiveFiles, engineRoot),
        invalidEntryCount: info.archive.invalidEntryCount,
    };
}

export function writeContainerProvenance(root: string, provenance: ContainerProvenance): string {
    const target = path.join(path.resolve(root), CONTAINER_PROVENANCE_FILE);
    atomicWriteFileSync(target, JSON.stringify(provenance, null, 2));
    return target;
}

export function readContainerProvenance(root: string): ContainerProvenance | null {
    const target = path.join(path.resolve(root), CONTAINER_PROVENANCE_FILE);
    if (!fs.existsSync(target)) return null;
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch (err) {
        throw invalid('컨테이너 provenance JSON을 읽을 수 없습니다', { path: target, cause: String(err) });
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid('컨테이너 provenance는 객체여야 합니다');
    const value = raw as { [key: string]: unknown };
    if (value.schemaVersion !== PROVENANCE_SCHEMA_VERSION
        || (value.containerType !== 'electron-asar' && value.containerType !== 'nwjs-package')) {
        throw invalid('지원하지 않는 컨테이너 provenance입니다', { schemaVersion: value.schemaVersion, containerType: value.containerType });
    }
    if (typeof value.archiveRelativePath !== 'string' || typeof value.archiveSha256 !== 'string'
        || !/^[0-9a-f]{64}$/i.test(value.archiveSha256)) {
        throw invalid('provenance의 archive 식별자가 잘못되었습니다');
    }
    if (typeof value.engine !== 'object' || value.engine === null || Array.isArray(value.engine)) {
        throw invalid('provenance의 engine 정보가 잘못되었습니다');
    }
    const engine = value.engine as { [key: string]: unknown };
    if ((engine.type !== 'rpgmv' && engine.type !== 'rpgmz' && engine.type !== 'gdevelop') || typeof engine.root !== 'string') {
        throw invalid('provenance의 engine 프로파일이 잘못되었습니다', { engine });
    }
    if (!Array.isArray(value.archiveFiles) || value.archiveFiles.length === 0 || value.archiveFiles.length > MAX_ARCHIVE_FILES
        || !Array.isArray(value.unpackedFiles) || !Array.isArray(value.requiredEntries)) {
        throw invalid('provenance의 archive 파일 목록이 잘못되었습니다');
    }
    const archiveFiles = value.archiveFiles.map((entry) => {
        if (typeof entry !== 'string') throw invalid('provenance archiveFiles에는 문자열만 허용됩니다');
        return normalizeRelative(entry);
    });
    if (new Set(archiveFiles).size !== archiveFiles.length) throw invalid('provenance archiveFiles에 중복 경로가 있습니다');
    const unpackedFiles = value.unpackedFiles.map((entry) => {
        if (typeof entry !== 'string') throw invalid('provenance unpackedFiles에는 문자열만 허용됩니다');
        return normalizeRelative(entry);
    });
    if (unpackedFiles.some((entry) => !archiveFiles.includes(entry))) {
        throw invalid('provenance unpacked 항목이 archive 파일 목록에 없습니다');
    }
    const requiredEntries = value.requiredEntries.map((entry) => {
        if (typeof entry !== 'string') throw invalid('provenance requiredEntries에는 문자열만 허용됩니다');
        return normalizeRelative(entry);
    });
    if (requiredEntries.some((entry) => !archiveFiles.includes(entry))) {
        throw invalid('provenance 필수 항목이 archive 파일 목록에 없습니다');
    }
    const invalidEntryCount = value.invalidEntryCount;
    if (!Number.isSafeInteger(invalidEntryCount) || (invalidEntryCount as number) < 0) {
        throw invalid('provenance invalidEntryCount가 잘못되었습니다');
    }
    return {
        schemaVersion: 1,
        containerType: value.containerType,
        archiveRelativePath: normalizeRelative(value.archiveRelativePath),
        archiveSha256: value.archiveSha256.toLowerCase(),
        engine: { type: engine.type, root: normalizeRelative(engine.root, true) },
        archiveFiles,
        unpackedFiles,
        requiredEntries,
        invalidEntryCount: invalidEntryCount as number,
    };
}
