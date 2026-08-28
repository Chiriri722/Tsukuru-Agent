import path from 'path';
import fs from 'fs';
import PU from 'tcp-port-used';
import { spawnTracked } from '../../core/processRegistry';
import { publicErrorMessage } from '../../core/publicError';
import dataBaseO from './datas.js';
import { checkIsMapFile, sleep } from './globalutils.js';
import { requestData } from '../../core/httpClient';
import { translateable, note2able, translateableOne, hanguls } from './datas.js';
import * as edTool from './edtool';
import zlib from 'zlib'
import { translate as gTranslate } from '@vitalets/google-translate-api';
import { kakaoTrans } from '../libs/kakaotrans.js';
import { postProcessTranslate, preProcessTranslate } from '../libs/preprocess.js';
import { app, shell } from 'electron';
import { validateExternalUrl } from '../../electron/ipcPolicy';
import { resolveVerifiedBundledBinary } from '../../core/externalBinaryPolicy';

let junChori = false

function oPath(){
    return globalThis.oPath
}

function applyUserDict(input:string){
    const Udict = globalThis.settings.userdict
  
    for(let i=0;i<Object.keys(Udict).length;i++){
      const akey = Object.keys(Udict)[i]
      input = input.replaceAll(akey,Udict[akey])
    }
    return input
}

function encodeURIp(p:string) {
    p = p.replaceAll('■', '@user0')
    p = p.replaceAll('%', '@user1')
    p = p.replaceAll('％', '@user2')
    p = p.replaceAll('|', '@user3')
    return p
}

function decodeURIp(p:string, encodeSp=false) {
    p = p.replaceAll('@user0', '■')
    p = p.replaceAll('@user1', '%')
    p = p.replaceAll('@user2', '％')
    p = p.replaceAll('@user3', '|')
    if(encodeSp){
        p = p.replaceAll(' ', ' ')
    }
    return p
}

function encodeSp(p:string, change=false){
    if(change){
        p = p.replaceAll(' ', ' ')
    }
    return p
}

function isUnsafe(str:string){
    return (str.includes('<') || str.includes('>') || str.includes('\\'))
}
const safeTransRegex = /(\%[0-9]+)|((\\[A-Za-z]+)((\[[A-Za-z0-9]+\])|(\<[A-Za-z0-9]+\>)))|(\\lsoff)|(<br>)|(\\(ii|[VvNnPpGgCcIi{}$.|!><^])(\[[0-9]+\])?)|(#)|(%)|(■[0-9]+)/g

const fndi = /\\ *V *\[/g
function makeid() {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for ( let i = 0; i < 6; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return `${result}`;
}

class Translator{
    type: string;
    type2 :string
    ls:any
    transMemory:{[key:string]:string}
    langu:string
    constructor(type:string, type2='', langu='jp'){
        this.type = type
        this.type2 = type2
        this.ls = null
        this.transMemory = {}
        this.langu = langu
    }
    setLs(ls:any){
        this.ls = ls
    }
    KillLs(){
        try {
            this.ls.kill()
        } catch (error) {}
    }
    async translate(text:string){
        let isEndPadding = 0
        while(text.at(text.length - 1) === '\n'){
            text = text.substring(0, text.length - 1)
            isEndPadding += 1
        }
        text = await this.translate2(text)
        while(isEndPadding > 0){
            text += '\n'
            isEndPadding -= 1
        }
        return text
    }
    async translate2(text:string):Promise<string>{
        if(globalThis.settings.DoNotTransHangul){
            if(hanguls.test(text)){
                return text
            }
        }
        text = applyUserDict(text)
        if(this.type === 'eztrans'){
            let t:string
            // console.log(text)
            try {
                const response = await requestData('http://127.0.0.1:8000/', {
                    allowHttpLoopback: true,
                    timeoutMs: 10_000,
                    maxBytes: 4 * 1024 * 1024,
                    query: { text },
                });
                t = response.data as string
            } catch (error) {
                try {
                    try {
                        this.KillLs()
                    } catch (error) {}
                    this.ls = spawnTracked(resolveVerifiedBundledBinary(oPath(), 'eztrans-server2'), [], { timeoutMs: 60 * 60 * 1000 });
                    console.log('spawned')
                    await sleep(2000)
                    await PU.waitUntilUsed(8000, 250, 10_000)
                } catch (error) {
                    console.log('spawn failed')
                }
            }
            if(typeof(t) !== 'string' && typeof(t) !== 'number'){
                return `ERROR: RETURNED ${JSON.stringify(t)}`
            }
            return (t)
        }
        else if(this.type === 'transEngine'){
            function encodeSafe(text:string, sup=false){
                if(sup){
                    console.log('encodeSafe')
                    text.replaceAll('◆','◇').replaceAll('\n','◆')
                }
                return text
            }
            function decodeSafe(text:string, sup=false){
                if(sup){
                    console.log('decodeSafe')
                    text.replaceAll('◆','\n')
                }
                text.replaceAll(fndi,'\\V[')
                return text
            }
            let t:string
            // console.log(text)
            try {
                if(text.length < 1){
                    console.log("zero len")
                    t = text
                }
                else if(Object.keys(this.transMemory).includes(text)){
                    console.log('from memory')
                    t = this.transMemory[text]
                }
                else{
                    const tempTxt = encodeSafe(text, this.type2 === 'papago')
                    console.log('requesting')
                    if(this.type2 === 'google'){
                        const a = await gTranslate(tempTxt, {from: (this.langu), to: 'ko'})
                        await sleep(3000)
                        return (a.text)
                    }
                    else if(this.type2 === 'googleh' || this.type2 === 'kakao'){
                        await sleep(5000)
                        let posqi = 0
                        let ids:string[] = []
                        function makeSureIsSafe(str:string){
                            while(true){
                                const matches = safeTransRegex.exec(str)
                                if(matches === null){
                                    return str.replaceAll('㈜','@')
                                }
                                const m = matches[0]
                                const id = `@${ids.length}`
                                const vid = `㈜${ids.length}`
                                ids.push(m)
                                str = str.replaceAll(m, vid)
                            }
                        }
                        let sliced = decodeURIp(tempTxt).split('\n')
                        let mog:[string,number][] = []
                        for(let i=0;i<sliced.length;i++){
                            const origin = sliced[i]
                            sliced[i] = makeSureIsSafe(sliced[i])
                            if(isUnsafe(sliced[i])){
                                console.log(origin)
                                mog.push([origin, i])
                                sliced[i] = 'a'
                            }
                        }
                        const temp2 = sliced.join('\n')
                        if(mog.length === sliced.length){
                            return encodeURIp(tempTxt)
                        }
                        const a:string = this.type2 === 'kakao' ? (await kakaoTrans(temp2,this.langu)) : (await gTranslate(temp2, {from: (this.langu), to: 'ko'})).text
                        let finalStr = a
                        for(let i=(ids.length - 1);i>=0;i--){
                            const str = ids[i]
                            const findRegex = new RegExp(`@ *${i}`, 'g')
                            finalStr = finalStr.replace(findRegex, str)
                        }
                        let aSplit = finalStr.split('\n')
                        for(const m of mog){
                            aSplit[m[1]] = m[0]
                        }
                        return encodeURIp(aSplit.join('\n'))
                    }
                    else{
                        const response = await requestData('http://127.0.0.1:8000/', {
                            allowHttpLoopback: true,
                            timeoutMs: 10_000,
                            maxBytes: 4 * 1024 * 1024,
                            query: {
                                text: tempTxt,
                                platform: this.type2,
                                source: this.langu,
                                target: 'ko',
                            },
                        });
                        try {
                            t = (response.data as { data?: { translatedContent?: string } }).data?.translatedContent as string
                            t = decodeSafe(t, this.type2 === 'papago')
                            this.transMemory[text] = t
                        } catch (error) {
                            console.log('err: notranslatedContent')
                            t = text
                        }
                    }
                }
            } catch (error) {
                if(this.type2 === 'googleh' || this.type2 === 'kakao'){
                    console.log(error)
                }
                else{
                    try {
                        try {
                            this.KillLs()
                        } catch (error) {}
                        this.ls = spawnTracked(resolveVerifiedBundledBinary(oPath(), 'translate-engine'), [], { timeoutMs: 60 * 60 * 1000 });
                        console.log('spawned')
                        await sleep(2000)
                        await PU.waitUntilUsed(8000, 250, 10_000)
                    } catch (error) {
                        console.log('spawn failed')
                    }
                }
            }
            if(typeof(t) !== 'string' && typeof(t) !== 'number'){
                return `ERROR: RETURNED ${JSON.stringify(t)}`
            }
            return `${t}`
        }
    }
    getType(){
        return this.type
    }
    async isCrash(){
        if(this.type === 'eztrans'){
            if (!(await PU.check(8000))) {
                console.log('err')
                globalThis.mwindow.webContents.send('alert', {
                    icon: 'error',
                    message: 'Eztrans 서버와 연결할 수 없습니다.'
                });
                globalThis.mwindow.webContents.send('worked', 0);
                return true
            }
        }
        return false
    }
}

function setProgressBar(now:number, max:number, multipl=70){
    console.log(`${now} / ${max}`)
    globalThis.mwindow.webContents.send('loading', (now/max) * multipl);
}

const asciiRegex = /^[\x00-\x7F]*$/
function isASCII(str:string) {
    return asciiRegex.test(str);
}

type TranslationFileType = '' | 'src' | 'note' | 'note2';

interface TranslationLineState {
    transIt: boolean;
    folkt: boolean;
    typeofit: number;
}

interface TranslationStep {
    output: string;
    aborted: boolean;
}

interface TranslationFileContext {
    arg: any;
    compatibilityMode: boolean;
    edDat: any;
    note2Codes: Record<string, number>;
}

function configureTranslationMode(arg: any): {
    compatibilityMode: boolean;
    type2: string;
    langu: string;
    usePreProcess: boolean;
} {
    let compatibilityMode = false
    let type2 = ''
    let usePreProcess = arg.usePreProcess ?? false
    globalThis.settings.safeTrans = true
    globalThis.settings.smartTrans = true
    globalThis.settings.fastEztrans = true
    if (arg.type == 'eztransh') {
        globalThis.settings.smartTrans = false
        compatibilityMode = true
        arg.type = 'eztrans'
    }
    if (arg.type == 'papago') {
        globalThis.settings.smartTrans = false
        arg.type = 'transEngine'
        type2 = 'papago'
    }
    if (arg.type == 'google') {
        globalThis.settings.smartTrans = false
        arg.type = 'transEngine'
        type2 = 'google'
    }
    if (arg.type == 'googleh') {
        junChori = true
        globalThis.settings.smartTrans = false
        arg.type = 'transEngine'
        type2 = 'googleh'
    }
    if (arg.type == 'kakao') {
        junChori = true
        globalThis.settings.smartTrans = false
        arg.type = 'transEngine'
        type2 = 'kakao'
        if (arg.langu === 'en') usePreProcess = true
    }
    if (arg.type == 'kakaosafe') {
        junChori = true
        globalThis.settings.smartTrans = false
        arg.type = 'transEngine'
        type2 = 'kakao'
    }
    return { compatibilityMode, type2, langu: arg.langu, usePreProcess }
}

function translationAlert(message: string): void {
    globalThis.mwindow.webContents.send('alert', { icon: 'error', message })
}

async function startTranslationBackend(translator: Translator, type2: string): Promise<boolean> {
    if (translator.getType() === 'transEngine' && type2 === 'papago') {
        console.log('transEngine')
        if (await PU.check(8000)) {
            translationAlert('포트 8000이 사용중입니다.')
            globalThis.mwindow.webContents.send('worked', 0)
            return false
        }
        const process = spawnTracked(resolveVerifiedBundledBinary(oPath(), 'translate-engine'), [], { timeoutMs: 60 * 60 * 1000 })
        translator.setLs(process)
        await sleep(1000)
        try {
            await PU.waitUntilUsed(8000, 250, 10_000)
        } catch {
            translationAlert('구동 도중 오류가 발생하였습니다')
            translator.KillLs()
            globalThis.mwindow.webContents.send('worked', 0)
            return false
        }
        await sleep(1000)
    }
    if (translator.getType() === 'eztrans') {
        console.log('eztrans')
        if (await PU.check(8000)) {
            translationAlert('포트 8000이 사용중입니다.')
            globalThis.mwindow.webContents.send('worked', 0)
            return false
        }
        const process = spawnTracked(resolveVerifiedBundledBinary(oPath(), 'eztrans-server'), [], { timeoutMs: 60 * 60 * 1000 })
        translator.setLs(process)
        process.stderr.on('data', function (data) {
            console.log('eztrans - Error')
            console.log('test: ' + data)
        })
        process.on('close', function () {
            console.log('eztrans')
            console.log('close')
        })
        await sleep(3000)
        try {
            await PU.waitUntilUsed(8000, 250, 10_000)
        } catch {
            globalThis.mwindow.webContents.send('eztransError')
            setTimeout(() => {
                void shell.openExternal(validateExternalUrl('https://dotnet.microsoft.com/en-us/download/dotnet/thank-you/runtime-desktop-6.0.1-windows-x86-installer'))
            }, 2000)
            translator.KillLs()
            globalThis.mwindow.webContents.send('worked', 0)
            return false
        }
        await sleep(1000)
    }
    return true
}

function classifyTranslationFile(name: string, context: TranslationFileContext): TranslationFileType | null {
    if (context.arg.game === 'wolf') {
        return name.includes('map.txt') || name.includes('commonEvent.txt') ? '' : null
    }
    if (!globalThis.settings.safeTrans && !globalThis.settings.smartTrans) return null
    console.log(name)
    if (context.compatibilityMode && name === 'System.txt') {
        console.log('skipping by compatibilityMode')
        return null
    }
    if (name.includes('ext_scripts.txt')) {
        console.log('src')
        return globalThis.settings.smartTrans && !context.compatibilityMode ? 'src' : null
    }
    if (name.includes('ext_note.txt')) {
        if (!globalThis.settings.smartTrans || context.compatibilityMode) console.log('skiping note')
        return globalThis.settings.smartTrans && !context.compatibilityMode ? 'note' : null
    }
    if (name.includes('ext_note2.txt')) {
        if (!globalThis.settings.smartTrans || context.compatibilityMode) {
            console.log('skiping note2')
            return null
        }
        const metadata = context.edDat.main['ext_note2.json'].data
        for (const key in metadata) context.note2Codes[key] = metadata[key].conf.code
        return 'note2'
    }
    if (!dataBaseO.includes(name) && !checkIsMapFile(name)) {
        console.log('skiping')
        return null
    }
    if (name === 'ext_plugins.txt' && (globalThis.settings.safeTrans || context.compatibilityMode)) {
        console.log('skiping ' + name)
        return null
    }
    return ''
}

async function translateSourceLine(readLine: string, translator: Translator): Promise<string> {
    if (!readLine.startsWith('D_TEXT ')) return `${readLine}\n`
    const parts = readLine.split(' ')
    while (parts.length > 3) {
        parts[1] = `${parts[1]} ${parts[2]}`
        parts.splice(2)
    }
    if (parts.length === 3 && isNaN(parseInt(parts[2]))) {
        console.log(parts.join(' '))
        parts[1] = `${parts[1]} ${parts[2]}`
        parts.splice(2)
    }
    parts[1] = encodeSp(await translator.translate(parts[1]), true)
    return `${parts.join(' ')}\n`
}

async function translateNoteLine(
    readLine: string,
    state: TranslationLineState,
    translator: Translator,
): Promise<TranslationStep> {
    let marker = ''
    let line = readLine
    if (!state.transIt) {
        const matched = translateable.find((candidate) => readLine.replaceAll(' ', '').startsWith(candidate))
        if (!matched) return { output: `${line}\n`, aborted: false }
        marker = matched
        state.folkt = translateableOne.includes(marker)
        console.log(`${marker} | ${state.folkt}`)
        state.transIt = true
        line = line.substring(marker.length, line.length)
    }
    if (line.includes('>') || (state.folkt && line.includes(' '))) {
        state.transIt = false
        const boundary = state.folkt && line.includes(' ') ? ' ' : '>'
        const suffix = `${line.substring(line.indexOf(boundary))}\n`
        line = line.substring(0, line.indexOf(boundary))
        const translated = await translator.translate(line)
        try {
            return { output: marker + encodeSp(translated, true) + suffix, aborted: false }
        } catch {
            return { output: marker + line + suffix, aborted: await translator.isCrash() }
        }
    }
    const translated = await translator.translate(line)
    try {
        return { output: `${marker}${encodeSp(translated, true)}\n`, aborted: false }
    } catch {
        return { output: `${marker}${line}\n`, aborted: await translator.isCrash() }
    }
}

async function translateNote2Line(
    readLine: string,
    lineIndex: number,
    state: TranslationLineState,
    translator: Translator,
    note2Codes: Record<string, number>,
): Promise<TranslationStep> {
    if (state.transIt) {
        if (note2Codes[lineIndex] == 408) {
            let run = true
            if (readLine.startsWith('\\>')) state.typeofit = 1
            else if (state.typeofit == 1) {
                run = false
                state.transIt = false
            }
            if (run) {
                const translated = await translator.translate(readLine)
                try {
                    return { output: `${encodeSp(translated, true)}\n`, aborted: false }
                } catch {
                    return { output: `${readLine}\n`, aborted: await translator.isCrash() }
                }
            }
        } else {
            state.transIt = false
        }
    }
    if (!state.transIt && note2able.includes(readLine) && note2Codes[lineIndex] == 108) {
        state.transIt = true
        state.typeofit = 0
    }
    return { output: `${readLine}\n`, aborted: false }
}

async function translateStructuredLines(
    fileRead: string,
    fileType: TranslationFileType,
    translator: Translator,
    note2Codes: Record<string, number>,
    workedFileLength: number,
    fullFileLength: number,
): Promise<TranslationStep> {
    const lines = fileRead.split('\n')
    const state: TranslationLineState = { transIt: false, folkt: false, typeofit: 0 }
    let output = ''
    for (let index = 0; index < lines.length; index++) {
        const readLine = lines[index]
        try {
            setProgressBar(workedFileLength + output.length, fullFileLength)
            let step: TranslationStep
            if (fileType === 'src') {
                step = { output: await translateSourceLine(readLine, translator), aborted: false }
            } else if (fileType === 'note') {
                step = await translateNoteLine(readLine, state, translator)
            } else if (fileType === 'note2') {
                step = await translateNote2Line(readLine, index, state, translator, note2Codes)
            } else {
                step = { output: `${encodeSp(await translator.translate(readLine))}\n`, aborted: false }
            }
            output += step.output
            if (step.aborted) return { output, aborted: true }
        } catch {
            console.log(readLine)
            console.log('err')
            if (await translator.isCrash()) return { output, aborted: true }
            output += `${readLine}\n`
        }
    }
    return { output, aborted: false }
}

async function translateLegacyFastFile(
    fileRead: string,
    translator: Translator,
    readLen: number,
    workedFileLength: number,
    fullFileLength: number,
): Promise<TranslationStep> {
    const remaining = fileRead.split('\n')
    const chunks: string[] = []
    let chunk = ''
    let length = 0
    while (remaining.length > 0) {
        const line = remaining[0]
        if (length + line.length > readLen) {
            length = 0
            chunks.push(encodeURIp(chunk))
            chunk = ''
        }
        length += line.length
        chunk += `${line}\n`
        remaining.shift()
    }
    chunks.push(encodeURIp(chunk))
    let output = ''
    for (const encodedChunk of chunks) {
        let translated = ''
        try {
            translated = await translator.translate(encodedChunk)
        } catch {
            console.log('err-crash')
            if (await translator.isCrash()) return { output, aborted: true }
            translated = encodedChunk
        }
        const sourceLines = encodedChunk.split('\n')
        const translatedLines = translated.split('\n')
        const lineMismatch = sourceLines.length !== translatedLines.length
        const unchanged = translated === encodedChunk
            && (!globalThis.settings.DoNotTransHangul || !hanguls.test(translated))
        if (unchanged || lineMismatch) {
            console.log(`err-line ${sourceLines.length} | ${translatedLines.length}`)
            const fallback: string[] = []
            for (const sourceLine of sourceLines) {
                try {
                    fallback.push(await translator.translate(sourceLine))
                } catch {
                    if (await translator.isCrash()) return { output, aborted: true }
                    fallback.push(sourceLine)
                }
            }
            translated = fallback.join('\n')
        }
        output += encodeSp(decodeURIp(translated))
        setProgressBar(workedFileLength + output.length, fullFileLength)
    }
    return { output, aborted: false }
}

async function translateFiles(
    fileList: string[],
    edir: string,
    translator: Translator,
    classifier: TranslationFileContext,
    useOldWay: boolean,
    readLen: number,
    translateMemorys: Record<string, string>,
    fullFileLength: number,
): Promise<boolean> {
    let workedFileLength = 0
    for (const fileName of fileList) {
        const fileType = classifyTranslationFile(fileName, classifier)
        if (fileType === null) continue
        const filePath = path.join(edir, fileName)
        const fileRead = fs.readFileSync(filePath, 'utf8')
        let step: TranslationStep
        if (fileType === '' && globalThis.settings.fastEztrans && !useOldWay) {
            const translated = fileRead.split('\n').map((line) => translateMemorys[line])
            const output = encodeSp(decodeURIp(translated.join('\n')))
            console.log('applied new')
            setProgressBar(workedFileLength + output.length, fullFileLength)
            step = { output, aborted: false }
        } else if (fileType === '' && globalThis.settings.fastEztrans) {
            step = await translateLegacyFastFile(fileRead, translator, readLen, workedFileLength, fullFileLength)
        } else {
            step = await translateStructuredLines(
                fileRead,
                fileType,
                translator,
                classifier.note2Codes,
                workedFileLength,
                fullFileLength,
            )
        }
        if (step.aborted) return true
        workedFileLength += step.output.length
        fs.writeFileSync(filePath, step.output, 'utf8')
        await sleep(0)
    }
    return false
}

export const translatorTestHooks = {
    configureTranslationMode,
    classifyTranslationFile,
    translateSourceLine,
    translateFiles,
}

export const trans = async (ev, arg) => {
    let translateMemorys:{[key:string]:string} = {}
    const { compatibilityMode, type2, langu, usePreProcess } = configureTranslationMode(arg)
    const translator = new Translator(arg.type, type2, langu)


    try {
        const dir = Buffer.from(arg.dir, "base64").toString('utf8');
        const edir = arg.game === 'wolf' ? path.join(dir, '_Extract', 'Texts') : path.join(dir, 'Extract')
        if (!fs.existsSync(edir)) {
            globalThis.mwindow.webContents.send('alert', {
                icon: 'error',
                message: 'Extract 폴더가 존재하지 않습니다'
            });
            globalThis.mwindow.webContents.send('worked', 0);
            return
        }
        const fileList = fs.readdirSync(edir)
        let fullFileLength = 0
        if(usePreProcess){
            await preProcessTranslate(edir)
        }
        console.log(translator.getType())
        for(const fileName of fileList){
            fullFileLength += fs.readFileSync(path.join(edir, fileName), 'utf-8').length
        }
        console.log(fullFileLength)
        if (!await startTranslationBackend(translator, type2)) return
        const edDat:any = arg.game === 'wolf' ? null : edTool.read(dir)
        const classifier: TranslationFileContext = {
            arg,
            compatibilityMode,
            edDat,
            note2Codes: {},
        }


        const useOldWay = (translator.getType() === 'eztrans')
        const readLen = (translator.getType() === 'eztrans') ? 1000
            : (translator.type2 === 'google') ? 1000
            : (translator.type2 === 'googleh') ? 4500
            : (translator.type2 === 'kakao') ? 4500
            : 220

        if(!useOldWay){
            let readed:string[] = []
            let transTargetLen = 0



            for(const i in fileList){
                if(classifyTranslationFile(fileList[i], classifier) === null){
                    continue
                }
                const iPath = path.join(edir, fileList[i])
                const read = fs.readFileSync(iPath, 'utf-8')
                transTargetLen += read.length
                readed = readed.concat(read.split('\n'))
            }
            let memoryAdd:{[key:string]:string} = {}
            let mem:string[] = []
            let ind = 0
            for(const s of readed){
                ind += 1
                if(!mem.includes(s)){
                    mem.push(s)
                    memoryAdd[s] = s
                }
                if(ind % 1000 === 0){
                    console.log(`parsing: ${ind} / ${readed.length}`)
                    await sleep(1)
                }
            }
            let chunks:string[] = []
            let chunkKeys:string[] = []
            let cLen = 0
            let translatedLen = 0
            async function doTrans(){
                let translated = ''
                console.log('translating new')
                const chunkJoin = chunks.join('\n')
                try {
                    translated = await translator.translate(encodeURIp(chunkJoin))
                } catch (error) {
                    translated = chunkJoin
                }
                let translatedSplit = translated.split('\n')

                const isLine = (translatedSplit.length !== chunks.length)
                const hangule = (translated === chunkJoin) && ((!globalThis.settings.DoNotTransHangul) || (!hanguls.test(translated)))
                if(hangule || isLine){
                    async function reTrans(offset:number, size:number){
                        try {
                            const sliced = chunks.slice(offset,offset+size)
                            const slicejoin = sliced.join('\n')
                            console.log(`retranslating: ${offset} / ${slicejoin.length}`)
                            const retrans = (await translator.translate(encodeURIp(slicejoin))).split('\n')
                            if(retrans.length !== sliced.length){
                                console.log(`err-line ${retrans.length} | ${sliced.length}`)
                                throw 'err'
                            }
                            for(let i2=0;i2<sliced.length;i2++){
                                if(chunks[offset + i2] === sliced[i2]){
                                    chunks[offset + i2] = retrans[i2]
                                }
                                else{
                                    console.log('verify Error')
                                    console.log(chunks[offset + i2])
                                    console.log(sliced[i2])
                                    console.log(retrans[i2])
                                }
                            }
                            translatedLen += slicejoin.length
                            setProgressBar(translatedLen, transTargetLen, 100)
                        } catch (error) {
                            
                            console.log(`error on ${offset}, rere-translating`)
                            const sliced = chunks.slice(offset,offset+size)
                            if(sliced.length <= 5){
                                for(let i2=0;i2<sliced.length;i2++){
                                    const org = chunks[offset + i2]
                                    const r = (await translator.translate(encodeURIp(org)))
                                    console.log(`rere: ${i2} / ${sliced.length}`)
                                    if(!r.includes('\n')){
                                        chunks[offset + i2] = r
                                    }
                                    else{
                                        console.log(`ERROR: ${org}`)
                                    }
                                    translatedLen += org.length
                                    setProgressBar(translatedLen, transTargetLen, 100)
                                }
                            }
                            else{
                                await reTrans(offset, Math.floor(size/2))
                                await reTrans(offset + Math.floor(size/2), Math.ceil(size / 2))
                            }
                        }
                    }
                    console.log(`err-line ${chunks.length} | ${translatedSplit.length}`)
                    const retransSize = Math.floor(chunks.length / 5)
                    for(let i=0;i<chunks.length;i+=retransSize){
                        await reTrans(i, retransSize)
                    }
                }
                else{
                    for(let i=0;i<chunks.length;i++){
                        translatedLen += chunks[i].length
                        chunks[i] = translatedSplit[i]
                    }
                    setProgressBar(translatedLen, transTargetLen, 100)
                }
                for(let i=0;i<chunks.length;i++){
                    translateMemorys[chunkKeys[i]] = chunks[i].replaceAll('\n','')
                }
                chunks = []
                chunkKeys = []
                cLen = 0
            }
            const cacheFilePath = path.join(app.getPath('userData'), 'cache.bin')
            if(fs.existsSync(cacheFilePath)){
                const cache = JSON.parse(zlib.inflateSync(fs.readFileSync(cacheFilePath)).toString('utf-8'))
                if(cache[arg.type]){
                    translateMemorys = cache[arg.type]
                }
            }
            for(const key in memoryAdd){
                const toTrans = memoryAdd[key]
                const len = (toTrans.length + 1)
                if((toTrans.length <= 1) || toTrans.startsWith('@@Excludes') || toTrans.startsWith('---') || toTrans.startsWith('//')){
                    translatedLen += toTrans.length
                    translateMemorys[key] = toTrans
                    setProgressBar(translatedLen, transTargetLen, 100)
                }
                else if(Object.keys(translateMemorys).includes(key)){
                    translatedLen += translateMemorys[key].length
                    setProgressBar(translatedLen, transTargetLen, 100)
                }
                else if(cLen + len > readLen){
                    await doTrans()
                }
                else{
                    cLen += len
                    chunks.push(toTrans)
                    chunkKeys.push(key)
                }
            }
            await doTrans()

            let cdat:{[key:string]:{[key:string]:string}} = {}
            if(fs.existsSync(cacheFilePath)){
                cdat = JSON.parse(zlib.inflateSync(fs.readFileSync(cacheFilePath)).toString('utf-8'))
            }
            cdat[arg.type] = translateMemorys
            fs.writeFileSync(cacheFilePath, zlib.deflateSync(Buffer.from(JSON.stringify(cdat), 'utf-8')))
            
        }


        const aborted = await translateFiles(
            fileList,
            edir,
            translator,
            classifier,
            useOldWay,
            readLen,
            translateMemorys,
            fullFileLength,
        )
        if (aborted) return
        if(usePreProcess){
            await postProcessTranslate(edir)
        }
        translator.KillLs()
        globalThis.mwindow.webContents.send('alert', '완료되었습니다');
        globalThis.mwindow.webContents.send('loading', 0);
    } catch (err) {
        translator.KillLs()
        globalThis.mwindow.webContents.send('alert', {
            icon: 'error',
            message: publicErrorMessage(err)
        });
    }
    globalThis.mwindow.webContents.send('worked', 0);
}
