import fs from 'fs'
import path from 'path'
import { sleep } from '../../rpgmv/globalutils'
import WolfExtDataParser from '../extract/wolfExtData'
import { ctx } from '../../../core/context';
import { atomicWriteFileSync } from '../../../core/atomic';

export interface WolfApplyResult {
    applied: number;
    /** Entries skipped on length/byte verification failure (never write to mismatched binaries). */
    skipped: { sourceFile: string; reason: string }[];
}

function setProgressBar(now:number, max:number, multipl=100){
    ctx().progress.set((now/max) * multipl);
}
export async function wolfAppyier(reroot?: { from: string; to: string }): Promise<WolfApplyResult> {
    let totalOffset:{[key:string]:number} = {}
    let sourceDic:{[key:string]:Buffer} = {}
    let extractedTextDic:{[key:string]:string[]} = {}
    const skipped: { sourceFile: string; reason: string }[] = []
    let applied = 0
    const extTextDir = path.join(ctx().wolf.sourceDir, '_Extract')
    WolfExtDataParser.read(path.join(extTextDir, '.extracteddata'))
    if(reroot){
        // CLI 전용: 쓰기 대상 경로를 게임 복사본으로 재루팅한다(텍스트·캐시는 원본 기준으로 읽음).
        const from = path.resolve(reroot.from)
        const to = path.resolve(reroot.to)
        const rerootPath = (p:string) => {
            const rp = path.resolve(p)
            return rp.startsWith(from) ? path.join(to, path.relative(from, rp)) : p
        }
        const newCache:{[key:string]:Buffer} = {}
        for(const k of Object.keys(ctx().wolf.cache)){
            newCache[rerootPath(k)] = ctx().wolf.cache[k]
        }
        ctx().wolf.cache = newCache
        for(const e of ctx().wolf.extData){
            e.sourceFile = rerootPath(e.sourceFile)
        }
    }
    for(let i=0;i<ctx().wolf.extData.length;i++){
        setProgressBar(i, ctx().wolf.extData.length)
        const dat = (ctx().wolf.extData[i])
        if(!Object.keys(extractedTextDic).includes(dat.extractFile)){
            extractedTextDic[dat.extractFile] = fs.readFileSync(path.join(extTextDir, 'Texts',`${dat.extractFile}.txt`),'utf-8').split('\n')
        }
        let extractedText = extractedTextDic[dat.extractFile]
        if(!Object.keys(sourceDic).includes(dat.sourceFile)){
            sourceDic[dat.sourceFile] = Buffer.from(ctx().wolf.cache[dat.sourceFile])
            totalOffset[dat.sourceFile] = 0
        }
        let source = sourceDic[dat.sourceFile]
        const currentOffset =  totalOffset[dat.sourceFile]
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
        totalOffset[dat.sourceFile] += (strBuffer.length - strLen)
        source.writeInt32LE(strBuffer.length, pos1)
        source = Buffer.concat([source.subarray(0, pos2), strBuffer , source.subarray(pos3)])
        sourceDic[dat.sourceFile] = source
        applied += 1
        await sleep(1)
    }
    for(const key in sourceDic){
        atomicWriteFileSync(key, sourceDic[key])
    }
    console.log('apply end')
    setProgressBar(0,1)
    return { applied, skipped }
}
