import path from 'path';

export const MAX_ARCHIVE_ENTRY_PATH_BYTES = 4096;
export const MAX_ARCHIVE_ENTRY_SEGMENT_BYTES = 255;

export function normalizeArchiveEntry(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Windows extraction aliases까지 포함한 archive entry 충돌 키. */
export function archiveEntryCollisionKey(value: string): string {
    return normalizeArchiveEntry(value)
        .normalize('NFC')
        .split('/')
        .map((part) => part.replace(/[ .]+$/g, '').toLocaleLowerCase('en-US'))
        .join('/');
}

/** traversal, NUL, drive path, alias segment, 과도한 경로를 쓰기 전에 거부한다. */
export function isUnsafeArchiveEntry(value: string): boolean {
    const normalized = value.replace(/\\/g, '/');
    if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
        return true;
    }
    const withoutTrailingSlash = normalized.replace(/\/+$/, '');
    if (!withoutTrailingSlash || Buffer.byteLength(withoutTrailingSlash, 'utf8') > MAX_ARCHIVE_ENTRY_PATH_BYTES) {
        return true;
    }
    return withoutTrailingSlash.split('/').some((part) => (
        part === ''
        || part === '.'
        || part === '..'
        || /[ .]$/.test(part)
        || Buffer.byteLength(part, 'utf8') > MAX_ARCHIVE_ENTRY_SEGMENT_BYTES
    ));
}

export function assertSafeArchiveEntries(entries: readonly string[]): void {
    const seen = new Set<string>();
    for (const entry of entries) {
        const collisionKey = archiveEntryCollisionKey(entry);
        if (isUnsafeArchiveEntry(entry) || seen.has(collisionKey)) {
            throw new Error('안전하지 않은 archive 경로가 발견되었습니다: ' + entry);
        }
        seen.add(collisionKey);
    }
}

export function isWithinPath(parent: string, child: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

export function assertOutsidePath(parent: string, child: string, label: string): void {
    if (isWithinPath(parent, child)) throw new Error(`${label}은 원본/staging 경로 내부일 수 없습니다: ${child}`);
}
