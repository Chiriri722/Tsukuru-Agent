import fs from './physicalFs';
import path from 'path';
import crypto from 'crypto';
import * as asar from '@electron/asar';
import { ContainerInfo, getContainerAdapter } from './container';
import { isUnsafeArchiveEntry } from './container/archivePolicy';
import { sha256File } from './container/fileSystemPolicy';
import { enumerateRegularFilesWithoutLinks, resolveContainedPathWithoutLinks } from './pathSafety';
import { validateContract } from './contracts/schemaRegistry';
import { ErrorCodes, OperationError } from './types';

export const RPG_PACK_FILE = '.tsukuru-rpg-pack.json';
export const RPG_PACK_ARTIFACTS = ['Backup', 'Extract', '.extracteddata'] as const;
export const RPG_PACK_FLAGS = ['ext_plugin', 'ext_src', 'ext_javascript', 'ext_note', 'exJson', 'autoline'] as const;
export type RpgPackFlags = Partial<Record<typeof RPG_PACK_FLAGS[number], boolean>>;
export interface RpgPackFile { path: string; sha256: string }
export interface RpgTranslationPack {
    schemaVersion: 1;
    kind: 'rpg-translation-pack';
    engine: 'rpgmv' | 'rpgmz';
    extraction: RpgPackFlags;
    source: {
        type: 'directory' | 'electron-asar';
        engineRoot: string;
        archivePath?: string;
        archiveSha256?: string;
        inputs: RpgPackFile[];
    };
    immutable: RpgPackFile[];
}

function invalid(message: string): OperationError {
    return new OperationError(ErrorCodes.MAPPING_CORRUPT, message);
}

export function rpgPackPath(root: string, relative: string): string {
    if (isUnsafeArchiveEntry(relative) || relative.includes('\\')) throw invalid('작업팩 상대 경로가 안전하지 않습니다');
    const resolved = resolveContainedPathWithoutLinks(root, relative);
    if (!resolved.ok) throw invalid('작업팩 경로에 링크 또는 외부 경로가 있습니다');
    return resolved.path;
}

export function rpgPackFileHash(root: string, relative: string): RpgPackFile {
    const file = rpgPackPath(root, relative);
    if (!fs.lstatSync(file).isFile()) throw invalid('작업팩 입력은 일반 파일이어야 합니다');
    return { path: relative, sha256: sha256File(file) };
}

export function rpgPackImmutableFiles(root: string): RpgPackFile[] {
    return ['.extracteddata', ...enumerateRegularFilesWithoutLinks(rpgPackPath(root, 'Backup'))
        .map(file => path.relative(root, file).split(path.sep).join('/'))]
        .sort().map(relative => rpgPackFileHash(root, relative));
}

export function readRpgTranslationPack(root: string): RpgTranslationPack | undefined {
    const target = path.join(root, RPG_PACK_FILE);
    if (!fs.existsSync(target)) return undefined;
    const file = rpgPackPath(root, RPG_PACK_FILE);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw invalid('작업팩 metadata 크기/형식이 올바르지 않습니다');
    let pack: RpgTranslationPack;
    try { pack = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw invalid('작업팩 metadata JSON을 읽을 수 없습니다'); }
    if (!validateContract('rpg-translation-pack', 1, pack).ok) throw invalid('작업팩 metadata 계약이 올바르지 않습니다');
    for (const relative of [pack.source.engineRoot, pack.source.archivePath].filter(Boolean)) {
        rpgPackPath(root, relative!);
    }
    for (const list of [pack.source.inputs, pack.immutable]) {
        const aliases = new Set<string>();
        for (const item of list) {
            rpgPackPath(root, item.path);
            const key = item.path.normalize('NFC').toLowerCase();
            if (aliases.has(key)) throw invalid('작업팩 metadata에 중복 경로가 있습니다');
            aliases.add(key);
        }
    }
    if (JSON.stringify(rpgPackImmutableFiles(root)) !== JSON.stringify(pack.immutable)) {
        throw new OperationError(ErrorCodes.SOURCE_CHANGED, '작업팩 원문 또는 매핑이 변경되었습니다. 원본에서 다시 추출하세요');
    }
    return pack;
}

/** Select only inputs consumed by RpgMakerService, never recursively select data-like model assets. */
export function rpgPackInputPaths(info: ContainerInfo, flags: RpgPackFlags): string[] {
    if ((info.type !== 'directory' && info.type !== 'electron-asar')
        || (info.engine.type !== 'rpgmv' && info.engine.type !== 'rpgmz')) {
        throw new OperationError(ErrorCodes.NOT_IMPLEMENTED, '번역 작업팩은 RPG MV/MZ 게임 폴더와 Electron ASAR에서 지원합니다');
    }
    const prefix = info.engine.root ? info.engine.root + '/' : '';
    const data = prefix + 'data/';
    const entries = info.archive?.fileEntries ?? info.entries;
    const selected = entries.filter(entry => {
        if (!entry.startsWith(data)) return false;
        const name = entry.slice(data.length);
        return !name.includes('/') && !name.startsWith('._')
            && (name.endsWith('.json') || name.endsWith('.json.yaml') || (flags.exJson && name === 'ExternMessage.csv'));
    });
    if (flags.ext_plugin) selected.push(prefix + 'js/plugins.js');
    if (!selected.some(name => name.endsWith('.json') || name.endsWith('.json.yaml'))) {
        throw new OperationError(ErrorCodes.FORMAT_UNKNOWN, '추출할 RPG data 입력이 없습니다');
    }
    return selected.sort();
}

function readInput(info: ContainerInfo, relative: string): Buffer {
    if (info.type === 'electron-asar') {
        if (!info.archive?.fileEntries.includes(relative)) throw invalid('ASAR에서 추출 입력을 찾지 못했습니다');
        return asar.extractFile(info.archivePath!, path.normalize(relative), false);
    }
    const file = rpgPackPath(info.rootPath, relative);
    if (!fs.lstatSync(file).isFile()) throw invalid('RPG 추출 입력은 일반 파일이어야 합니다');
    return fs.readFileSync(file);
}

export function rpgPackEstimatedTempBytes(info: ContainerInfo, flags: RpgPackFlags): number {
    const bytes = rpgPackInputPaths(info, flags).reduce((total, relative) => total + (
        info.archivePath ? Number((asar.statFile(info.archivePath, path.normalize(relative)) as { size: number }).size)
            : fs.statSync(rpgPackPath(info.rootPath, relative)).size
    ), 0);
    // ponytail: 32x estimates text/manifest expansion; it is not a hard disk quota.
    return Math.min(Number.MAX_SAFE_INTEGER, bytes * 32);
}

export function stageRpgPackInputs(info: ContainerInfo, flags: RpgPackFlags, engineStage: string): RpgTranslationPack['source'] {
    const selected = rpgPackInputPaths(info, flags);
    getContainerAdapter(info.type).assertExtractable(info);
    const prefix = info.engine.root ? info.engine.root + '/' : '';
    const inputs = selected.map(relative => {
        const bytes = readInput(info, relative);
        const target = rpgPackPath(engineStage, relative.slice(prefix.length));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
        return { path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    });
    return {
        type: info.type as RpgTranslationPack['source']['type'],
        engineRoot: info.engine.root,
        ...(info.archive ? {
            archivePath: path.relative(info.rootPath, info.archivePath!).split(path.sep).join('/'),
            archiveSha256: info.archive.sha256,
        } : {}),
        inputs,
    };
}

export function assertRpgPackSourceUnchanged(info: ContainerInfo, source: RpgTranslationPack['source']): void {
    if (info.archivePath && sha256File(info.archivePath) !== source.archiveSha256) {
        throw new OperationError(ErrorCodes.SOURCE_CHANGED, '추출 중 원본 ASAR가 변경되었습니다');
    }
    for (const input of source.inputs) {
        if (crypto.createHash('sha256').update(readInput(info, input.path)).digest('hex') !== input.sha256) {
            throw new OperationError(ErrorCodes.SOURCE_CHANGED, '작업 중 원본 RPG 입력이 변경되었습니다');
        }
    }
}
