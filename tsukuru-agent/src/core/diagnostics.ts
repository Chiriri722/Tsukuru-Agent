import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { removePathBestEffortSync } from './atomic';
import { ErrorCodes, OperationError } from './types';

export interface ProtectedPath {
    path: string;
    label: string;
}

export interface DiagnosticReportOptions {
    protectedRoots?: ProtectedPath[];
    forbiddenRoot?: string;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathVariants(value: string): string[] {
    const canonicalRoots = [path.resolve(value)];
    if (path.win32.isAbsolute(value)) canonicalRoots.push(path.win32.normalize(value));
    if (path.posix.isAbsolute(value)) canonicalRoots.push(path.posix.normalize(value));
    const variants = canonicalRoots.flatMap((root) => [
        root,
        root.replace(/\\/g, '/'),
        root.replace(/\//g, '\\'),
    ]);
    return [...new Set(variants)].sort((left, right) => right.length - left.length);
}

export function redactSensitivePaths(message: string, protectedRoots: ProtectedPath[] = []): string {
    let redacted = message;
    const roots = [...protectedRoots].sort((left, right) => right.path.length - left.path.length);
    for (const root of roots) {
        for (const candidate of pathVariants(root.path)) {
            redacted = redacted.replace(new RegExp(escapeRegExp(candidate), 'gi'), `<${root.label}>`);
        }
    }
    return redacted;
}

function redactValue(value: unknown, roots: ProtectedPath[], seen: WeakSet<object>): unknown {
    if (typeof value === 'string') return redactSensitivePaths(value, roots);
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '<circular>';
    seen.add(value);
    if (Array.isArray(value)) return value.map((entry) => redactValue(entry, roots, seen));
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
        redactSensitivePaths(key, roots),
        redactValue(entry, roots, seen),
    ]));
}

export function redactSensitiveValue(value: unknown, protectedRoots: ProtectedPath[] = []): unknown {
    return redactValue(value, protectedRoots, new WeakSet<object>());
}

function isWithin(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function assertDiagnosticReportTarget(reportPath: string, forbiddenRoot?: string): string {
    const target = path.resolve(reportPath);
    if (forbiddenRoot && isWithin(forbiddenRoot, target)) {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, '진단 보고서는 원본 프로젝트 밖에 저장해야 합니다');
    }
    if (fs.existsSync(target)) {
        throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '진단 보고서 경로가 이미 존재합니다', {
            reportPath: target,
        });
    }
    return target;
}

export function writeDiagnosticReport(
    reportPath: string,
    report: unknown,
    options: DiagnosticReportOptions = {},
): string {
    const target = assertDiagnosticReportTarget(reportPath, options.forbiddenRoot);
    const parent = path.dirname(target);
    fs.mkdirSync(parent, { recursive: true });
    const temporary = path.join(parent, `.${path.basename(target)}.tmp-${crypto.randomUUID()}`);
    const redacted = redactSensitiveValue(report, options.protectedRoots ?? []);
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(redacted, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        try {
            fs.linkSync(temporary, target);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                throw new OperationError(ErrorCodes.OUTPUT_CONFLICT, '진단 보고서 경로가 이미 존재합니다', {
                    reportPath: target,
                });
            }
            throw error;
        }
        return target;
    } finally {
        removePathBestEffortSync(temporary, { force: true });
    }
}
