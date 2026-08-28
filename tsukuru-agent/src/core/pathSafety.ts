import fs from 'fs';
import path from 'path';

export type ContainedPathFailure = 'invalid' | 'outside' | 'linked';

export type ContainedPathResolution =
    | { ok: true; path: string }
    | { ok: false; reason: ContainedPathFailure };

function lstatIfPresent(target: string): fs.Stats | null {
    try {
        return fs.lstatSync(target);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

/** Return the first existing symlink/junction component on an absolute path, including the target. */
export function findLinkedPathComponent(targetPath: string): string | undefined {
    const target = path.resolve(targetPath);
    const parsed = path.parse(target);
    let current = parsed.root;
    if (lstatIfPresent(current)?.isSymbolicLink()) return current;
    const relative = path.relative(parsed.root, target);
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        const stat = lstatIfPresent(current);
        if (stat?.isSymbolicLink()) return current;
        if (stat === null) break;
    }
    return undefined;
}

/** Recursively list only regular files, rejecting links/junctions and special entries. */
export function enumerateRegularFilesWithoutLinks(rootPath: string): string[] {
    const root = path.resolve(rootPath);
    const linkedRoot = findLinkedPathComponent(root);
    if (linkedRoot) {
        throw new Error(`file enumeration crosses a symbolic link/junction: ${linkedRoot}`);
    }
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory()) {
        throw new Error(`file enumeration root is not a regular directory: ${root}`);
    }

    const files: string[] = [];
    const visit = (directory: string): void => {
        const entries = fs.readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
        for (const entry of entries) {
            const candidate = path.join(directory, entry.name);
            const stat = fs.lstatSync(candidate);
            if (stat.isSymbolicLink()) {
                throw new Error(`file enumeration found a symbolic link/junction: ${candidate}`);
            }
            if (stat.isDirectory()) {
                visit(candidate);
            } else if (stat.isFile()) {
                files.push(candidate);
            } else {
                throw new Error(`file enumeration found a non-regular entry: ${candidate}`);
            }
        }
    };
    visit(root);
    return files;
}

/** Resolve one non-empty relative path without crossing a link or junction. */
export function resolveContainedPathWithoutLinks(rootPath: string, relativePath: unknown): ContainedPathResolution {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) {
        return { ok: false, reason: 'invalid' };
    }
    const root = path.resolve(rootPath);
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        return { ok: false, reason: 'outside' };
    }

    let current = root;
    for (const segment of ['', ...relative.split(path.sep).filter(Boolean)]) {
        if (segment) current = path.join(current, segment);
        if (lstatIfPresent(current)?.isSymbolicLink()) return { ok: false, reason: 'linked' };
    }
    return { ok: true, path: target };
}
