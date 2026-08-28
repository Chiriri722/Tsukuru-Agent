import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Operation } from './schema';
import { ErrorCodes, OperationError } from './types';

export interface ResourceLimits {
    maxFiles?: number;
    maxInputBytes?: number;
    maxFileBytes?: number;
    maxTempBytes?: number;
    minFreeTempBytes?: number;
}

export interface ResourcePreflightReport {
    files: number;
    inputBytes: number;
    estimatedTempBytes: number;
    freeTempBytes: number | null;
    freeSpaceChecked: boolean;
}

export interface ResourcePreflightOptions {
    tempRoot?: string;
    signal?: AbortSignal;
    freeSpaceBytes?: (tempRoot: string) => number | null;
}

function abortIfNeeded(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new OperationError(ErrorCodes.OPERATION_CANCELLED, '자원 사전 점검이 취소되었습니다', {
            stage: 'preflight',
        });
    }
}

function limitExceeded(limit: string, maximum: number, observed: number): never {
    throw new OperationError(ErrorCodes.RESOURCE_LIMIT_EXCEEDED, '요청한 자원 제한을 초과했습니다', {
        limit,
        maximum,
        observed,
    });
}

function defaultFreeSpaceBytes(tempRoot: string): number | null {
    const statfsSync = (fs as typeof fs & {
        statfsSync?: (target: string) => { bavail: number | bigint; bsize: number | bigint };
    }).statfsSync;
    if (!statfsSync) return null;
    try {
        const stats = statfsSync(tempRoot);
        const bytes = Number(stats.bavail) * Number(stats.bsize);
        return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
    } catch {
        return null;
    }
}

function tempMultiplier(operation: Operation): number {
    if (operation === 'extract') return 2;
    if (operation === 'apply') return 3;
    if (operation === 'patch' || operation === 'recover') return 1;
    return 0;
}

export function inspectResourcePreflight(
    inputPath: string,
    operation: Operation,
    limits: ResourceLimits = {},
    options: ResourcePreflightOptions = {},
): ResourcePreflightReport {
    const pending = [path.resolve(inputPath)];
    let files = 0;
    let inputBytes = 0;
    while (pending.length > 0) {
        abortIfNeeded(options.signal);
        const current = pending.pop()!;
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
            continue;
        }
        if (!stat.isFile()) continue;
        files++;
        inputBytes += stat.size;
        if (limits.maxFiles !== undefined && files > limits.maxFiles) {
            limitExceeded('maxFiles', limits.maxFiles, files);
        }
        if (limits.maxFileBytes !== undefined && stat.size > limits.maxFileBytes) {
            limitExceeded('maxFileBytes', limits.maxFileBytes, stat.size);
        }
        if (limits.maxInputBytes !== undefined && inputBytes > limits.maxInputBytes) {
            limitExceeded('maxInputBytes', limits.maxInputBytes, inputBytes);
        }
    }
    const estimatedTempBytes = Math.min(Number.MAX_SAFE_INTEGER, inputBytes * tempMultiplier(operation));
    if (limits.maxTempBytes !== undefined && estimatedTempBytes > limits.maxTempBytes) {
        limitExceeded('maxTempBytes', limits.maxTempBytes, estimatedTempBytes);
    }
    const tempRoot = path.resolve(options.tempRoot ?? os.tmpdir());
    const freeTempBytes = (options.freeSpaceBytes ?? defaultFreeSpaceBytes)(tempRoot);
    if (limits.minFreeTempBytes !== undefined) {
        if (freeTempBytes === null) {
            throw new OperationError(
                ErrorCodes.RESOURCE_PREFLIGHT_UNAVAILABLE,
                '이 런타임에서는 임시 디스크 여유 공간을 확인할 수 없습니다',
                { requestedReserveBytes: limits.minFreeTempBytes },
            );
        }
        const required = Math.min(Number.MAX_SAFE_INTEGER, estimatedTempBytes + limits.minFreeTempBytes);
        if (freeTempBytes < required) {
            throw new OperationError(ErrorCodes.TEMP_SPACE_INSUFFICIENT, '임시 디스크 여유 공간이 부족합니다', {
                requiredBytes: required,
                freeBytes: freeTempBytes,
            });
        }
    }
    return {
        files,
        inputBytes,
        estimatedTempBytes,
        freeTempBytes,
        freeSpaceChecked: freeTempBytes !== null,
    };
}
