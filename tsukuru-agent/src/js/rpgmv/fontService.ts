import fs from 'fs';
import path from 'path';
import { atomicWriteFileSync } from '../../core/atomic';
import { findLinkedPathComponent } from '../../core/pathSafety';

const MAX_FONT_BYTES = 128 * 1024 * 1024;
const MAX_WINDOW_SCRIPT_BYTES = 32 * 1024 * 1024;
const FONT_SIGNATURES = new Set([
    '00010000', // TrueType
    '4f54544f', // OpenType/CFF: OTTO
    '74727565', // Apple TrueType: true
    '74797031', // PostScript: typ1
    '74746366', // TrueType collection: ttcf
]);

function assertRegularDirectoryWithoutLinks(directoryPath: string, label: string): string {
    const resolved = path.resolve(directoryPath);
    const linkedPath = findLinkedPathComponent(resolved);
    if (linkedPath) {
        throw new Error(`${label} crosses a symbolic link/junction: ${linkedPath}`);
    }
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(resolved);
    } catch {
        throw new Error(`${label} does not exist: ${resolved}`);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} is not a regular directory: ${resolved}`);
    }
    return fs.realpathSync(resolved);
}

function resolveRpgDataDirectory(dataDirectory: string): { dataDirectory: string; gameRoot: string } {
    if (typeof dataDirectory !== 'string' || !path.isAbsolute(dataDirectory) || dataDirectory.includes('\0')) {
        throw new Error('RPG data directory must be an absolute local path');
    }
    const canonicalData = assertRegularDirectoryWithoutLinks(dataDirectory, 'RPG data directory');
    if (path.basename(canonicalData).toLowerCase() !== 'data') {
        throw new Error('RPG data directory must be named data');
    }
    return { dataDirectory: canonicalData, gameRoot: path.dirname(canonicalData) };
}

function sameFilesystemPath(left: string, right: string): boolean {
    const normalize = (value: string) => process.platform === 'win32'
        ? path.resolve(value).normalize('NFC').toLowerCase()
        : path.resolve(value).normalize('NFC');
    return normalize(left) === normalize(right);
}

function resolveSourceFont(sourceFontPath: string): string {
    if (typeof sourceFontPath !== 'string' || !path.isAbsolute(sourceFontPath) || sourceFontPath.includes('\0')) {
        throw new Error('Font source must be an absolute local path');
    }
    const extension = path.extname(sourceFontPath).toLowerCase();
    if (extension !== '.ttf' && extension !== '.otf') {
        throw new Error('Font source must use the .ttf or .otf extension');
    }
    let canonicalSource: string;
    let stat: fs.Stats;
    try {
        canonicalSource = fs.realpathSync(sourceFontPath);
        stat = fs.lstatSync(canonicalSource);
    } catch {
        throw new Error('Font source does not exist');
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error('Font source must be a regular file');
    }
    if (stat.size < 4 || stat.size > MAX_FONT_BYTES) {
        throw new Error(`Font source size must be between 4 and ${MAX_FONT_BYTES} bytes`);
    }
    return canonicalSource;
}

function assertFontSignature(fontData: Buffer): void {
    if (!FONT_SIGNATURES.has(fontData.subarray(0, 4).toString('hex'))) {
        throw new Error('Font source does not contain a supported TrueType/OpenType signature');
    }
}

function resolveRegularFileWithoutLinks(filePath: string, label: string, maxBytes: number): string {
    const resolved = path.resolve(filePath);
    const linkedPath = findLinkedPathComponent(resolved);
    if (linkedPath) throw new Error(`${label} crosses a symbolic link/junction: ${linkedPath}`);
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(resolved);
    } catch {
        throw new Error(`${label} does not exist: ${resolved}`);
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} is not a regular file: ${resolved}`);
    if (stat.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte safety limit`);
    return resolved;
}

/** Install the selected font into an RPG Maker MV workspace without partially replacing the old font. */
export function installRpgFont(dataDirectory: string, sourceFontPath: string): string {
    const { gameRoot } = resolveRpgDataDirectory(dataDirectory);
    const source = resolveSourceFont(sourceFontPath);
    const fontsDirectory = assertRegularDirectoryWithoutLinks(path.join(gameRoot, 'fonts'), 'RPG fonts directory');
    const target = path.join(fontsDirectory, 'mplus-1m-regular.ttf');
    if (fs.existsSync(target)) {
        const targetStat = fs.lstatSync(target);
        if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
            throw new Error('RPG font target must be a regular file');
        }
        if (sameFilesystemPath(source, fs.realpathSync(target))) {
            throw new Error('The selected font is already installed');
        }
    }
    const fontData = fs.readFileSync(source);
    assertFontSignature(fontData);
    atomicWriteFileSync(target, fontData);
    return target;
}

/** Update RPG Maker MV's standard font-size override with an atomic script replacement. */
export function changeRpgFontSize(dataDirectory: string, fontSize: number): string {
    if (!Number.isInteger(fontSize) || fontSize < 8 || fontSize > 128) {
        throw new Error('RPG font size must be an integer between 8 and 128');
    }
    const { gameRoot } = resolveRpgDataDirectory(dataDirectory);
    const scriptsDirectory = assertRegularDirectoryWithoutLinks(path.join(gameRoot, 'js'), 'RPG scripts directory');
    const windowScript = resolveRegularFileWithoutLinks(
        path.join(scriptsDirectory, 'rpg_windows.js'),
        'RPG window script',
        MAX_WINDOW_SCRIPT_BYTES,
    );
    const source = fs.readFileSync(windowScript, 'utf8');
    const override = `Window_Base.prototype.standardFontSize = function() {return ${fontSize}}`;
    const existingOverride = /Window_Base\.prototype\.standardFontSize\s*=\s*function\s*\(\s*\)\s*\{\s*return\s+[0-9]+\s*;?\s*\}/;
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const updated = existingOverride.test(source)
        ? source.replace(existingOverride, override)
        : `${source}${source.endsWith('\n') || source.length === 0 ? '' : newline}${override}`;
    atomicWriteFileSync(windowScript, updated);
    return windowScript;
}
