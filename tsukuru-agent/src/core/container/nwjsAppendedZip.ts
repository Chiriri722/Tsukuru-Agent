import crypto from 'crypto';
import fs from 'fs';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 22 + 0xffff;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;

export type AppendedZipSignatureState = 'absent' | 'present' | 'invalid';

export interface NwAppendedZipInspection {
    prefixBytes: number;
    prefixSha256: string;
    zipOffsetDelta: number;
    centralDirectoryOffset: number;
    centralDirectoryBytes: number;
    eocdOffset: number;
    entryCount: number;
    peFormat: 'pe32' | 'pe32+';
    signature: AppendedZipSignatureState;
    safeToRepack: boolean;
    reason: string | null;
}

function readExact(fd: number, length: number, position: number): Buffer {
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
        const read = fs.readSync(fd, buffer, offset, length - offset, position + offset);
        if (read === 0) throw new Error('파일을 읽는 중 예기치 않은 EOF가 발생했습니다');
        offset += read;
    }
    return buffer;
}

function sha256Prefix(fd: number, length: number): string {
    const digest = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, length)));
    let position = 0;
    while (position < length) {
        const requested = Math.min(buffer.length, length - position);
        const read = fs.readSync(fd, buffer, 0, requested, position);
        if (read === 0) throw new Error('실행 파일 prefix 해시 중 예기치 않은 EOF가 발생했습니다');
        digest.update(buffer.subarray(0, read));
        position += read;
    }
    return digest.digest('hex');
}

function findEocd(tail: Buffer, tailStart: number): number | null {
    for (let offset = tail.length - 22; offset >= 0; offset--) {
        if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
        const commentBytes = tail.readUInt16LE(offset + 20);
        if (offset + 22 + commentBytes === tail.length) return tailStart + offset;
    }
    return null;
}

function inspectPeHeader(fd: number, prefixBytes: number): {
    format: 'pe32' | 'pe32+';
    signature: AppendedZipSignatureState;
    reason: string | null;
} | null {
    if (prefixBytes < 64) return null;
    const dos = readExact(fd, 64, 0);
    if (dos.toString('ascii', 0, 2) !== 'MZ') return null;
    const peOffset = dos.readUInt32LE(0x3c);
    if (peOffset + 24 > prefixBytes) return null;
    const peAndCoff = readExact(fd, 24, peOffset);
    if (peAndCoff.readUInt32LE(0) !== 0x00004550) return null;
    const optionalBytes = peAndCoff.readUInt16LE(20);
    const optionalOffset = peOffset + 24;
    if (optionalBytes < 2 || optionalOffset + optionalBytes > prefixBytes) return null;
    const optional = readExact(fd, optionalBytes, optionalOffset);
    const magic = optional.readUInt16LE(0);
    const format = magic === 0x10b ? 'pe32' : (magic === 0x20b ? 'pe32+' : null);
    if (!format) return null;
    const countOffset = format === 'pe32' ? 92 : 108;
    const directoriesOffset = format === 'pe32' ? 96 : 112;
    if (optional.length < countOffset + 4) {
        return { format, signature: 'invalid', reason: 'PE optional header에 data directory 개수가 없습니다' };
    }
    const directoryCount = optional.readUInt32LE(countOffset);
    if (directoryCount <= 4) return { format, signature: 'absent', reason: null };
    const certificateOffset = directoriesOffset + (4 * 8);
    if (optional.length < certificateOffset + 8) {
        return { format, signature: 'invalid', reason: 'PE certificate directory가 optional header 범위를 벗어납니다' };
    }
    const certificateFileOffset = optional.readUInt32LE(certificateOffset);
    const certificateBytes = optional.readUInt32LE(certificateOffset + 4);
    if (certificateFileOffset === 0 && certificateBytes === 0) {
        return { format, signature: 'absent', reason: null };
    }
    const certificateEnd = certificateFileOffset + certificateBytes;
    if (certificateFileOffset === 0 || certificateBytes === 0 || certificateEnd > prefixBytes) {
        return { format, signature: 'invalid', reason: 'PE certificate table 범위가 appended ZIP prefix와 일치하지 않습니다' };
    }
    return { format, signature: 'present', reason: 'Authenticode certificate table이 있어 재패키징하지 않습니다' };
}

export function inspectNwAppendedZip(filePath: string): NwAppendedZipInspection | null {
    const size = fs.statSync(filePath).size;
    if (size < 22) return null;
    const fd = fs.openSync(filePath, 'r');
    try {
        const tailBytes = Math.min(size, MAX_EOCD_SEARCH);
        const tailStart = size - tailBytes;
        const tail = readExact(fd, tailBytes, tailStart);
        const eocdOffset = findEocd(tail, tailStart);
        if (eocdOffset === null) return null;
        const eocd = readExact(fd, 22, eocdOffset);
        const disk = eocd.readUInt16LE(4);
        const centralDisk = eocd.readUInt16LE(6);
        const diskEntries = eocd.readUInt16LE(8);
        const entryCount = eocd.readUInt16LE(10);
        const centralBytes = eocd.readUInt32LE(12);
        const storedCentralOffset = eocd.readUInt32LE(16);
        if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) return null;
        if (entryCount === 0xffff || centralBytes === 0xffffffff || storedCentralOffset === 0xffffffff) return null;
        if (centralBytes > MAX_CENTRAL_DIRECTORY_BYTES || centralBytes > eocdOffset) return null;
        const physicalCentralOffset = eocdOffset - centralBytes;
        const zipOffsetDelta = physicalCentralOffset - storedCentralOffset;
        if (zipOffsetDelta < 0) return null;
        const central = readExact(fd, centralBytes, physicalCentralOffset);
        let cursor = 0;
        let minimumLocalOffset = Number.MAX_SAFE_INTEGER;
        for (let index = 0; index < entryCount; index++) {
            if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) return null;
            const nameBytes = central.readUInt16LE(cursor + 28);
            const extraBytes = central.readUInt16LE(cursor + 30);
            const commentBytes = central.readUInt16LE(cursor + 32);
            const storedLocalOffset = central.readUInt32LE(cursor + 42);
            if (storedLocalOffset === 0xffffffff) return null;
            const physicalLocalOffset = storedLocalOffset + zipOffsetDelta;
            if (physicalLocalOffset < 0 || physicalLocalOffset + 4 > physicalCentralOffset) return null;
            if (readExact(fd, 4, physicalLocalOffset).readUInt32LE(0) !== LOCAL_SIGNATURE) return null;
            minimumLocalOffset = Math.min(minimumLocalOffset, physicalLocalOffset);
            cursor += 46 + nameBytes + extraBytes + commentBytes;
        }
        if (cursor !== central.length || minimumLocalOffset === Number.MAX_SAFE_INTEGER || minimumLocalOffset === 0) return null;
        const pe = inspectPeHeader(fd, minimumLocalOffset);
        if (!pe) return null;
        return {
            prefixBytes: minimumLocalOffset,
            prefixSha256: sha256Prefix(fd, minimumLocalOffset),
            zipOffsetDelta,
            centralDirectoryOffset: physicalCentralOffset,
            centralDirectoryBytes: centralBytes,
            eocdOffset,
            entryCount,
            peFormat: pe.format,
            signature: pe.signature,
            safeToRepack: pe.signature === 'absent',
            reason: pe.reason,
        };
    } finally {
        fs.closeSync(fd);
    }
}
