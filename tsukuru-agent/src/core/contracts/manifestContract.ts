import fs from 'fs';
import { ExtractManifest } from '../manifest';
import { ErrorCodes, OperationError } from '../types';
import { validateContract } from './schemaRegistry';

export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = [1, 2] as const;

function corrupt(message: string, details?: unknown): OperationError {
    return new OperationError(ErrorCodes.MANIFEST_CORRUPT, message, details);
}

/** 이미 파싱된 manifest를 canonical v1/v2 schema로 검증한다. */
export function parseExtractManifest(raw: unknown): ExtractManifest {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw corrupt('manifest는 JSON 객체여야 합니다');
    }
    const schemaVersion = (raw as Record<string, unknown>).schemaVersion;
    if (schemaVersion !== 1 && schemaVersion !== 2) {
        throw corrupt('지원하지 않는 manifest schemaVersion입니다', {
            schemaVersion,
            expected: SUPPORTED_MANIFEST_SCHEMA_VERSIONS,
        });
    }
    const validation = validateContract('manifest', schemaVersion, raw);
    if (!validation.ok) {
        throw corrupt('manifest 스키마 검증에 실패했습니다', { violations: validation.errors });
    }
    return raw as ExtractManifest;
}

/** 파일 파싱 오류와 schema 오류를 같은 manifest 오류 계약으로 정규화한다. */
export function readExtractManifest(manifestPath: string): ExtractManifest {
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
        throw corrupt('manifest.json 파싱에 실패했습니다', {
            manifestPath,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    return parseExtractManifest(raw);
}
