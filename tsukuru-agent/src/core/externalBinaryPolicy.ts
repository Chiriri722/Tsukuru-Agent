import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ErrorCodes, OperationError } from './types';

interface ExternalBinaryEntry {
    id: string;
    distribution: 'gui-bundled' | 'on-demand-pinned';
    relativePath: string;
    size: number;
    sha256: string;
}

interface ExternalBinaryInventory {
    schemaVersion: 1;
    entries: ExternalBinaryEntry[];
}

const inventory = require('./supplyChain/external-binaries.json') as ExternalBinaryInventory;

export type ExternalBinaryId = 'eztrans-server' | 'eztrans-server2' | 'translate-engine' | 'wolfdec-v0.3';

export function externalBinaryEntry(id: ExternalBinaryId): Readonly<ExternalBinaryEntry> {
    const entry = inventory.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new OperationError(ErrorCodes.EXTERNAL_BINARY_INTEGRITY, `Unknown external binary: ${id}`);
    return Object.freeze({ ...entry });
}

export function verifyExternalBinary(id: ExternalBinaryId, target: string): string {
    const entry = externalBinaryEntry(id);
    const resolved = path.resolve(target);
    let data: Buffer;
    try {
        const stat = fs.statSync(resolved);
        if (!stat.isFile() || stat.size !== entry.size) throw new Error(`size=${stat.size}`);
        data = fs.readFileSync(resolved);
    } catch (error) {
        throw new OperationError(
            ErrorCodes.EXTERNAL_BINARY_INTEGRITY,
            `External binary is missing or has the wrong size: ${id}`,
            { id, cause: String(error) },
        );
    }
    const digest = crypto.createHash('sha256').update(data).digest('hex');
    if (digest !== entry.sha256) {
        throw new OperationError(
            ErrorCodes.EXTERNAL_BINARY_INTEGRITY,
            `External binary SHA-256 mismatch: ${id}`,
            { id, expectedSha256: entry.sha256, actualSha256: digest },
        );
    }
    return resolved;
}

export function resolveVerifiedBundledBinary(appRoot: string, id: Exclude<ExternalBinaryId, 'wolfdec-v0.3'>): string {
    const entry = externalBinaryEntry(id);
    if (entry.distribution !== 'gui-bundled') {
        throw new OperationError(ErrorCodes.EXTERNAL_BINARY_INTEGRITY, `External binary is not bundled: ${id}`);
    }
    return verifyExternalBinary(id, path.join(path.resolve(appRoot), ...entry.relativePath.split('/')));
}
