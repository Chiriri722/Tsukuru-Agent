import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { matchesProtectedPath } from './protectedPaths';
import { FileDiff, FileMapEntry } from './types';

export function diffFileMaps(
    before: FileMapEntry[],
    after: FileMapEntry[],
    approvedProtectedPaths: ReadonlySet<string> = new Set(),
): FileDiff {
    const oldByPath = new Map(before.map((entry) => [entry.path, entry]));
    const newByPath = new Map(after.map((entry) => [entry.path, entry]));
    const paths = new Set([...oldByPath.keys(), ...newByPath.keys()]);
    let filesChanged = 0;
    let bytesChanged = 0;
    let protectedFilesChanged = 0;
    let protectedBytesChanged = 0;
    let addedFiles = 0;
    let removedFiles = 0;
    let textBytesChanged = 0;

    for (const filePath of paths) {
        const oldEntry = oldByPath.get(filePath);
        const newEntry = newByPath.get(filePath);
        if (!oldEntry) addedFiles++;
        if (!newEntry) removedFiles++;
        if (oldEntry && newEntry && oldEntry.hash === newEntry.hash && oldEntry.size === newEntry.size) continue;

        filesChanged++;
        bytesChanged += Math.abs((newEntry?.size ?? 0) - (oldEntry?.size ?? 0));
        const approvedProtectedChange = approvedProtectedPaths.has(filePath.replace(/\\/g, '/'));
        if ((oldEntry?.protected || newEntry?.protected) && !approvedProtectedChange) {
            protectedFilesChanged++;
            protectedBytesChanged += Math.max(oldEntry?.size ?? 0, newEntry?.size ?? 0);
        }
        const textPath = /\.(json|txt|ks|tjs|yaml|yml|csv|js|html|css)$/i.test(filePath);
        if (textPath && (!(oldEntry?.protected || newEntry?.protected) || approvedProtectedChange)) {
            textBytesChanged += Math.abs((newEntry?.size ?? 0) - (oldEntry?.size ?? 0));
        }
    }

    return {
        filesChanged,
        bytesChanged,
        protectedFilesChanged,
        protectedBytesChanged,
        addedFiles,
        removedFiles,
        protectedScriptDamage: protectedFilesChanged > 0 ? 100 : 0,
        textBytesChanged,
    };
}

export function snapshotDirectory(rootPath: string, maxFiles = 20000): FileMapEntry[] {
    const root = path.resolve(rootPath);
    const output: FileMapEntry[] = [];
    const visit = (current: string, relative: string): void => {
        if (output.length > maxFiles) throw new Error('스냅샷 파일 수 제한 초과: ' + maxFiles);
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) throw new Error('심볼릭 링크/정션은 검증할 수 없습니다: ' + path.join(current, entry.name));
            if (['Extract', '_Extract', 'Backup', 'Completed', '.extracteddata', '.git'].includes(entry.name)) continue;
            const child = path.join(current, entry.name);
            const childRelative = relative ? path.join(relative, entry.name) : entry.name;
            if (entry.isDirectory()) {
                visit(child, childRelative);
            } else if (entry.isFile()) {
                if (output.length >= maxFiles) throw new Error('스냅샷 파일 수 제한 초과: ' + maxFiles);
                const bytes = fs.readFileSync(child);
                const normalized = childRelative.replace(/\\/g, '/');
                output.push({
                    path: normalized,
                    size: bytes.length,
                    hash: crypto.createHash('sha256').update(bytes).digest('hex'),
                    protected: matchesProtectedPath(normalized),
                });
            }
        }
    };
    visit(root, '');
    return output;
}
