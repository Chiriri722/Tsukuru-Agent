import path from 'path'
import fs from 'fs'
import iconv from 'iconv-lite'
import { ctx } from './core/context';
import { ErrorCodes, OperationError } from './core/types';

export function decodeEncoding(buffer:Uint8Array){
    if(ctx().wolf.metadata.ver === 2){
        return iconv.decode(Buffer.from(buffer), "Shift_JIS")
    }
    else{
        return Buffer.from(buffer).toString('utf-8')
    }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function getAllFileInDir(Directory:string, ext:null|string = null) {
    const Files:string[] = [];

    function ThroughDirectory(Directory:string) {
        if (fs.lstatSync(Directory).isSymbolicLink()) {
            throw new OperationError(
                ErrorCodes.MAPPING_CORRUPT,
                '재귀 파일 검색 경로에 심볼릭 링크/정션이 있습니다',
                { path: Directory },
            );
        }
        fs.readdirSync(Directory, { withFileTypes: true }).forEach((entry) => {
            const Absolute = path.join(Directory, entry.name);
            if (entry.isSymbolicLink()) {
                throw new OperationError(
                    ErrorCodes.MAPPING_CORRUPT,
                    '재귀 파일 검색 경로에 심볼릭 링크/정션이 있습니다',
                    { path: Absolute },
                );
            }
            if (entry.isDirectory()){
                ThroughDirectory(Absolute);
                return
            }
            if (entry.isFile()){
                if(ext){
                    if(path.extname(Absolute) === ext){
                        Files.push(Absolute);
                    }
                }
                else{
                    Files.push(Absolute);
                }
                return
            }
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, '재귀 파일 검색 중 일반 파일이 아닌 항목을 발견했습니다', { path: Absolute });
        });
    }

    ThroughDirectory(Directory);
    return Files
}
