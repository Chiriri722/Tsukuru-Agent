import fs from 'fs'
import path from 'path'
import { sleep } from '../../rpgmv/globalutils'
import WolfExtDataParser from '../extract/wolfExtData'
import { ctx, WolfExtDataEntry } from '../../../core/context';
import { atomicWriteFilesSync } from '../../../core/atomic';
import { resolveContainedPathWithoutLinks } from '../../../core/pathSafety';
import { ErrorCodes, OperationError } from '../../../core/types';

export interface WolfApplyResult {
    applied: number;
    /** Entries skipped on length/byte verification failure (never write to mismatched binaries). */
    skipped: { sourceFile: string; reason: string }[];
}

function setProgressBar(now:number, max:number, multipl=100){
    ctx().progress.set((now/max) * multipl);
}

function resolveWolfArtifact(root: string, relativePath: unknown, label: string): string {
    const resolution = resolveContainedPathWithoutLinks(root, relativePath);
    if (resolution.ok === false && resolution.reason === 'linked') {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            `Wolf ${label} 경로에 심볼릭 링크/정션이 있습니다`,
            { relativePath },
        );
    }
    if (resolution.ok === false && resolution.reason === 'outside') {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `Wolf ${label} 경로가 작업 루트 밖을 가리킵니다`, { relativePath });
    }
    if (resolution.ok === false) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `안전하지 않은 Wolf ${label} 경로입니다`, { relativePath });
    }
    return resolution.path;
}

function resolveWolfSource(root: string, sourceFile: unknown): { path: string; relative: string } {
    if (typeof sourceFile !== 'string' || sourceFile.trim() === '') {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'Wolf sourceFile 경로가 올바르지 않습니다', { sourceFile });
    }
    const rootPath = path.resolve(root);
    const target = path.isAbsolute(sourceFile) ? path.resolve(sourceFile) : path.resolve(rootPath, sourceFile);
    const relative = path.relative(rootPath, target);
    return { path: resolveWolfArtifact(rootPath, relative, '원본'), relative };
}

function isValidWolfMappingEntry(dat: unknown): dat is WolfExtDataEntry {
    if (!dat || typeof dat !== 'object') return false
    const entry = dat as Partial<WolfExtDataEntry>
    const str = entry.str as Partial<WolfExtDataEntry['str']> | null | undefined
    return typeof entry.sourceFile === 'string'
        && typeof entry.extractFile === 'string' && entry.extractFile.trim() !== ''
        && str !== undefined && str !== null && typeof str === 'object'
        && Number.isInteger(str.pos1) && Number.isInteger(str.pos2)
        && Number.isInteger(str.pos3) && Number.isInteger(str.len)
        && (str.pos1 as number) >= 0 && str.pos2 === (str.pos1 as number) + 4
        && str.pos3 === (str.pos2 as number) + (str.len as number) && (str.len as number) >= 0
        && str.str instanceof Uint8Array && str.str.byteLength === str.len
        && Array.isArray(entry.textLineNumber)
        && !entry.textLineNumber.some((line: unknown) => !Number.isInteger(line) || (line as number) < 0)
}

export async function wolfAppyier(reroot?: { from: string; to: string }): Promise<WolfApplyResult> {
    const totalOffset = new Map<string, number>()
    const sourceDic = new Map<string, Buffer>()
    const extractedTextDic = new Map<string, string[]>()
    const skipped: { sourceFile: string; reason: string }[] = []
    let applied = 0
    const sourceRoot = path.resolve(reroot?.from ?? ctx().wolf.sourceDir)
    const outputRoot = path.resolve(reroot?.to ?? sourceRoot)
    const extTextDir = resolveWolfArtifact(sourceRoot, '_Extract', '추출 작업공간')
    const extractedDataPath = resolveWolfArtifact(extTextDir, '.extracteddata', '추출 metadata')
    WolfExtDataParser.read(extractedDataPath)
    if (!Array.isArray(ctx().wolf.extData)
        || typeof ctx().wolf.cache !== 'object' || ctx().wolf.cache === null || Array.isArray(ctx().wolf.cache)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'Wolf .extracteddata 구조가 올바르지 않습니다')
    }

    const outputBySource = new Map<string, string>()
    const cacheBySource = new Map<string, Buffer>()
    const collisionKeys = new Map<string, string>()
    for (const dat of ctx().wolf.extData) {
        if (!isValidWolfMappingEntry(dat)) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'Wolf .extracteddata 항목 구조가 올바르지 않습니다')
        }
        if (!Object.prototype.hasOwnProperty.call(ctx().wolf.cache, dat.sourceFile)) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'Wolf .extracteddata 원본 cache가 없습니다', { sourceFile: dat.sourceFile })
        }
        if (!cacheBySource.has(dat.sourceFile)) {
            const source = resolveWolfSource(sourceRoot, dat.sourceFile)
            const rawCache = ctx().wolf.cache[dat.sourceFile] as unknown
            if (!(rawCache instanceof Uint8Array)) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'Wolf .extracteddata 원본 cache가 바이트 배열이 아닙니다', { sourceFile: dat.sourceFile })
            }
            const cache = Buffer.from(rawCache)
            let sourceBytes: Buffer
            try {
                if (!fs.lstatSync(source.path).isFile()) throw new Error('not a file')
                sourceBytes = fs.readFileSync(source.path)
            } catch {
                throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'Wolf 원본 바이너리가 없거나 일반 파일이 아닙니다', { sourceFile: dat.sourceFile })
            }
            if (!sourceBytes.equals(cache)) {
                throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'Wolf 원본 바이너리가 extract 이후 변경되었습니다', { sourceFile: dat.sourceFile })
            }
            const outputPath = reroot
                ? resolveWolfArtifact(outputRoot, source.relative, '출력')
                : source.path
            let outputBytes: Buffer
            try {
                if (!fs.lstatSync(outputPath).isFile()) throw new Error('not a file')
                outputBytes = fs.readFileSync(outputPath)
            } catch {
                throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'Wolf 적용 대상 바이너리가 없거나 일반 파일이 아닙니다', { sourceFile: dat.sourceFile })
            }
            if (!outputBytes.equals(cache)) {
                throw new OperationError(ErrorCodes.SOURCE_CHANGED, 'Wolf 적용 대상 바이너리가 원본 snapshot과 다릅니다', { sourceFile: dat.sourceFile })
            }
            const collisionKey = process.platform === 'win32' ? outputPath.toLowerCase() : outputPath
            const previous = collisionKeys.get(collisionKey)
            if (previous && previous !== dat.sourceFile) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, '여러 Wolf 원본 경로가 같은 출력 파일을 가리킵니다', {
                    sourceFile: dat.sourceFile,
                    previous,
                })
            }
            collisionKeys.set(collisionKey, dat.sourceFile)
            outputBySource.set(dat.sourceFile, outputPath)
            cacheBySource.set(dat.sourceFile, cache)
        }
        if (!extractedTextDic.has(dat.extractFile)) {
            const textRelative = path.join('Texts', `${dat.extractFile}.txt`)
            const textPath = resolveWolfArtifact(extTextDir, textRelative, '추출 텍스트')
            let lines: string[]
            try {
                if (!fs.lstatSync(textPath).isFile()) throw new Error('not a file')
                lines = fs.readFileSync(textPath, 'utf-8').split('\n')
            } catch {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'Wolf 추출 텍스트 파일이 없거나 일반 파일이 아닙니다', { extractFile: dat.extractFile })
            }
            extractedTextDic.set(dat.extractFile, lines)
        }
        const extractedText = extractedTextDic.get(dat.extractFile)!
        if (dat.textLineNumber.some((line) => line >= extractedText.length)) {
            throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'Wolf 추출 텍스트 줄 매핑이 범위를 벗어납니다', { extractFile: dat.extractFile })
        }
    }

    for(let i=0;i<ctx().wolf.extData.length;i++){
        setProgressBar(i, ctx().wolf.extData.length)
        const dat = (ctx().wolf.extData[i])
        const outputPath = outputBySource.get(dat.sourceFile)!
        const extractedText = extractedTextDic.get(dat.extractFile)!
        if(!sourceDic.has(outputPath)){
            sourceDic.set(outputPath, Buffer.from(cacheBySource.get(dat.sourceFile)!))
            totalOffset.set(outputPath, 0)
        }
        let source = sourceDic.get(outputPath)!
        const currentOffset = totalOffset.get(outputPath)!
        const pos1 = dat.str.pos1 + currentOffset
        const pos2 = dat.str.pos2 + currentOffset
        const pos3 = dat.str.pos3 + currentOffset
        const strLen = source.subarray(pos1, pos2).readUInt32LE()
        if(strLen !== dat.str.len){
            skipped.push({ sourceFile: dat.sourceFile, reason: `length mismatch ${strLen} != ${dat.str.len}` })
            continue
        }
        const oneT = source.subarray(pos2, pos3)
        if(!Buffer.from(oneT).equals(dat.str.str)) {
            skipped.push({ sourceFile: dat.sourceFile, reason: 'original bytes mismatch' })
            continue
        }
        let strArr:string[] = []
        for(const s of dat.textLineNumber){
            strArr.push(extractedText[s])
        }
        let str = strArr.join('\n')
        if(dat.endsWithNull){
            str += '\0'
        }
        const strBuffer = (Buffer.from(str.replaceAll('\\\\','\\'), 'utf-8'))
        totalOffset.set(outputPath, currentOffset + (strBuffer.length - strLen))
        source.writeInt32LE(strBuffer.length, pos1)
        source = Buffer.concat([source.subarray(0, pos2), strBuffer , source.subarray(pos3)])
        sourceDic.set(outputPath, source)
        applied += 1
        await sleep(1)
    }
    atomicWriteFilesSync(Array.from(sourceDic, ([file, data]) => ({ file, data })))
    setProgressBar(0,1)
    return { applied, skipped }
}
