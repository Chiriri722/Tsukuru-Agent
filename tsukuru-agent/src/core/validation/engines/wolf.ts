import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import iconv from 'iconv-lite';
import { finalizeValidationReport } from '../reportPolicy';
import { StructuralIssue, StructuralValidationReport } from '../types';
import { resolveContainedPathWithoutLinks } from '../../pathSafety';

export function inspectWolfBinaryMappings(dataRoot: string, manifest: unknown): StructuralValidationReport {
    const entries = manifest && typeof manifest === 'object' && Array.isArray((manifest as { entries?: unknown }).entries)
        ? (manifest as { entries: unknown[] }).entries
        : [];
    const root = path.resolve(dataRoot);
    const issues: StructuralIssue[] = [];
    const files = new Set<string>();
    const encodingCounts = { utf8: 0, shiftJis: 0, unknown: 0 };
    let validEntries = 0;
    for (const rawEntry of entries) {
        const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry as Record<string, unknown> : {};
        const entryId = typeof entry.id === 'string' ? entry.id : '(unknown)';
        const sourceFile = typeof entry.sourceFile === 'string' ? entry.sourceFile : '';
        const wolf = entry.wolf && typeof entry.wolf === 'object' ? entry.wolf as Record<string, unknown> : {};
        const pos1 = wolf.pos1;
        const pos2 = wolf.pos2;
        const pos3 = wolf.pos3;
        const len = wolf.len;
        if (entry.encoding === 'utf8') encodingCounts.utf8++;
        else if (entry.encoding === 'shift_jis') encodingCounts.shiftJis++;
        else encodingCounts.unknown++;
        const resolution = resolveContainedPathWithoutLinks(root, sourceFile);
        const target = resolution.ok ? resolution.path : path.resolve(root, sourceFile);
        let valid = true;
        if (!resolution.ok || !fs.existsSync(target)) {
            issues.push({ code: 'WOLF_SOURCE_MISSING', severity: 'critical', file: sourceFile || null, entryId, message: 'Wolf 원본 파일이 없거나 데이터 루트 밖을 가리킵니다' });
            valid = false;
        } else {
            files.add(sourceFile);
        }
        if (valid && (!Number.isInteger(pos1)
            || !Number.isInteger(pos2)
            || !Number.isInteger(pos3)
            || !Number.isInteger(len)
            || Number(pos1) < 0
            || Number(pos2) !== Number(pos1) + 4
            || Number(pos3) < Number(pos2)
            || Number(pos3) > fs.statSync(target).size
            || Number(pos3) - Number(pos2) !== Number(len))) {
            issues.push({ code: 'WOLF_OFFSET_INVALID', severity: 'critical', file: sourceFile, entryId, message: 'Wolf 길이 prefix offset이 파일 범위를 벗어났습니다' });
            valid = false;
        } else if (valid) {
            const bytes = fs.readFileSync(target);
            const actualLength = bytes.readUInt32LE(Number(pos1));
            if (actualLength !== Number(len)) {
                issues.push({
                    code: 'WOLF_LENGTH_PREFIX_MISMATCH',
                    severity: 'critical',
                    file: sourceFile,
                    entryId,
                    message: `Wolf 길이 prefix가 manifest와 다릅니다: ${actualLength} != ${String(len)}`,
                });
                valid = false;
            }
            const original = bytes.subarray(Number(pos2), Number(pos3));
            if (entry.nullTerminated === true && (original.length === 0 || original[original.length - 1] !== 0)) {
                issues.push({
                    code: 'WOLF_NULL_TERMINATOR_MISSING',
                    severity: 'critical',
                    file: sourceFile,
                    entryId,
                    message: 'Wolf 문자열의 필수 널 종료 바이트가 없습니다',
                });
                valid = false;
            }
            const payload = entry.nullTerminated === true && original[original.length - 1] === 0
                ? original.subarray(0, original.length - 1)
                : original;
            const decoded = (entry.encoding === 'shift_jis'
                ? iconv.decode(Buffer.from(payload), 'shift_jis')
                : Buffer.from(payload).toString('utf8')).replaceAll('\\', '\\\\');
            const actualHash = crypto.createHash('sha256').update(decoded, 'utf8').digest('hex');
            if (typeof entry.hash !== 'string' || entry.hash.toLowerCase() !== actualHash) {
                issues.push({
                    code: 'WOLF_SOURCE_HASH_MISMATCH',
                    severity: 'critical',
                    file: sourceFile,
                    entryId,
                    message: 'Wolf 원문 바이트를 디코딩한 해시가 manifest와 다릅니다',
                });
                valid = false;
            }
        }
        if (valid) validEntries++;
    }
    const invalidEntries = entries.length - validEntries;
    return finalizeValidationReport({
        profile: 'wolf',
        ok: invalidEntries === 0,
        filesChecked: files.size,
        entriesChecked: entries.length,
        validEntries,
        invalidEntries,
        encodingCounts,
        encodingWarnings: 0,
        tokenErrors: 0,
        issues,
    });
}
