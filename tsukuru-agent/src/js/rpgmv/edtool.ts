import fs from 'fs';
import path from 'path';
import zlib from 'zlib'
import iconv from 'iconv-lite'
import { ErrorCodes, OperationError } from '../../core/types';

const MAX_COMPRESSED_MAPPING_BYTES = 256 * 1024 * 1024;
const MAX_DECOMPRESSED_MAPPING_BYTES = 512 * 1024 * 1024;
const MAX_WRAPPER_DEPTH = 16;

function corrupt(message: string, details?: unknown): OperationError {
    return new OperationError(ErrorCodes.MAPPING_CORRUPT, message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readFile(filePath: string) {
    let decoded: unknown;
    try {
        const stat = fs.lstatSync(filePath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
            throw corrupt('.extracteddata는 일반 파일이어야 합니다', { filePath });
        }
        if (stat.size > MAX_COMPRESSED_MAPPING_BYTES) {
            throw corrupt('.extracteddata 압축 파일이 허용 크기를 초과했습니다', {
                filePath,
                maximum: MAX_COMPRESSED_MAPPING_BYTES,
                observed: stat.size,
            });
        }
        const inflated = zlib.inflateSync(fs.readFileSync(filePath), {
            maxOutputLength: MAX_DECOMPRESSED_MAPPING_BYTES,
        });
        decoded = JSON.parse(iconv.decode(inflated, 'utf8'));
    } catch (error) {
        if (error instanceof OperationError) throw error;
        throw corrupt('.extracteddata 압축 또는 JSON 파싱에 실패했습니다', {
            filePath,
            cause: error instanceof Error ? error.message : String(error),
        });
    }

    let data = decoded;
    for (let depth = 0; depth <= MAX_WRAPPER_DEPTH; depth++) {
        if (!isRecord(data)) {
            throw corrupt('.extracteddata wrapper 구조가 올바르지 않습니다', { filePath, depth });
        }
        if (Object.prototype.hasOwnProperty.call(data, 'main')) {
            if (!isRecord(data.main)) {
                throw corrupt('.extracteddata main 매핑이 JSON 객체가 아닙니다', { filePath });
            }
            return data as { main: Record<string, unknown> };
        }
        if (depth === MAX_WRAPPER_DEPTH || !Object.prototype.hasOwnProperty.call(data, 'dat')) {
            throw corrupt('.extracteddata wrapper에서 main 매핑을 찾을 수 없습니다', {
                filePath,
                maximumDepth: MAX_WRAPPER_DEPTH,
            });
        }
        data = data.dat;
    }
    throw corrupt('.extracteddata wrapper 구조가 올바르지 않습니다', { filePath });
}

export function read(dir: string){
    return readFile(path.join(dir, '.extracteddata'));
}

export function write(dir: string, ext_data: Object, newVersion:boolean = true){
    fs.writeFileSync(path.join(dir, '.extracteddata'), serialize(ext_data));
}

export function serialize(ext_data: Object): Buffer {
    const encoded = iconv.encode(JSON.stringify({ dat: ext_data }), 'utf8');
    return zlib.deflateSync(encoded);
}

export function exists (dir: string){
    return fs.existsSync(path.join(dir, '.extracteddata'));
}
