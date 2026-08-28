import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { normalizeArchiveEntry } from './archivePolicy';
import { findLinkedPathComponent } from '../pathSafety';

export function isDirectory(value: string): boolean {
    try {
        return fs.lstatSync(value).isDirectory();
    } catch {
        return false;
    }
}

export function isFile(value: string): boolean {
    try {
        return fs.lstatSync(value).isFile();
    } catch {
        return false;
    }
}

export function sha256File(filePath: string): string {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const handle = fs.openSync(filePath, 'r');
    try {
        let bytesRead = 0;
        do {
            bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
            if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
        return hash.digest('hex');
    } finally {
        fs.closeSync(handle);
    }
}

/**
 * Directory containers reject links/junctions, preserve original case, and use
 * the common archive normalizer for portable relative names. Archive byte and
 * segment limits are enforced when an actual archive is inspected or packed.
 */
export function walkContainerFiles(root: string, relative = '', limit = 20000, output: string[] = []): string[] {
    const current = relative ? path.join(root, relative) : root;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) {
            throw new Error('심볼릭 링크/정션은 지원하지 않습니다: ' + path.join(current, entry.name));
        }
        const child = relative ? path.join(relative, entry.name) : entry.name;
        if (entry.isDirectory()) {
            walkContainerFiles(root, child, limit, output);
        } else if (entry.isFile()) {
            if (output.length >= limit) throw new Error('파일 수 제한 초과: ' + limit);
            output.push(normalizeArchiveEntry(child));
        }
    }
    return output;
}

export function prepareEmptyDirectory(target: string): void {
    if (fs.existsSync(target)) {
        if (!isDirectory(target) || fs.readdirSync(target).length > 0) {
            throw new Error('staging/output 경로가 비어 있지 않습니다: ' + target);
        }
    } else {
        fs.mkdirSync(target, { recursive: true });
    }
}

export function assertNoSymbolicLinks(sourcePath: string): void {
    const root = path.resolve(sourcePath);
    const linkedPath = findLinkedPathComponent(root);
    if (linkedPath) throw new Error('외부 리소스 심볼릭 링크/정션은 지원하지 않습니다: ' + linkedPath);
    const visit = (candidate: string): void => {
        const stat = fs.lstatSync(candidate);
        if (stat.isSymbolicLink()) throw new Error('외부 리소스 심볼릭 링크/정션은 지원하지 않습니다: ' + candidate);
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(candidate)) visit(path.join(candidate, entry));
        } else if (!stat.isFile()) {
            throw new Error('외부 리소스의 일반 파일이 아닌 항목은 지원하지 않습니다: ' + candidate);
        }
    };
    visit(root);
}

export interface CopyTreeWithoutLinksOptions {
    preserveTimestamps?: boolean;
    errorOnExist?: boolean;
    force?: boolean;
    filter?: (source: string, destination: string) => boolean;
}

export function copyTreeWithoutLinks(
    sourcePath: string,
    targetPath: string,
    options: CopyTreeWithoutLinksOptions = {},
): void {
    assertNoSymbolicLinks(sourcePath);
    const { filter, ...copyOptions } = options;
    fs.cpSync(sourcePath, targetPath, {
        ...copyOptions,
        recursive: true,
        filter: (source, destination) => {
            const stat = fs.lstatSync(source);
            if (stat.isSymbolicLink()) {
                throw new Error('복사 원본의 심볼릭 링크/정션은 지원하지 않습니다: ' + source);
            }
            if (!stat.isDirectory() && !stat.isFile()) {
                throw new Error('복사 원본의 일반 파일이 아닌 항목은 지원하지 않습니다: ' + source);
            }
            return filter ? filter(source, destination) : true;
        },
    });
}
