/**
 * RpgMakerService: RPG MV/MZ 추출·적용 로직의 UI 비의존 서비스 (계획서 §구현 방향).
 * 기존 main.ts의 extractor()와 apply.ts의 apply()를 이식했다.
 * - 경로는 평문 문자열(기존 base64 인코딩은 GUI adapter에서 디코딩)
 * - 사용자 확인·오류 알림은 OperationError로 대체(GUI adapter가 code를 보고 기존 IPC 흐름 재현)
 * - 진행률·로그는 OperationContext의 ProgressSink/Logger 사용
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import * as ExtTool from './extract.js';
import * as edTool from './edtool.js';
import * as dataBaseO from './datas.js';
import { checkIsMapFile, sleep } from './globalutils.js';
import { OperationContext, ctx, setActiveContext } from '../../core/context';
import { OperationError, ErrorCodes } from '../../core/types';
import { buildRpgManifest } from '../../core/manifestBuild';
import { MANIFEST_FILE } from '../../core/manifest';
import { atomicWriteFileSync, makeStagingDir, replaceDirSync } from '../../core/atomic';

export interface RpgExtractOptions {
    /** data 폼더의 평문 경로. */
    dir: string;
    /** true면 기존 Extract/Backup 삭제 및 data 폼더명 검사 우회. */
    force?: boolean;
    /** GUI 완료 알림 억제 플래그(어댑터 전용, 서비스는 사용하지 않음). */
    silent?: boolean;
    ext_plugin?: boolean;
    ext_src?: boolean;
    ext_javascript?: boolean;
    ext_note?: boolean;
    exJson?: boolean;
    autoline?: boolean;
    decryptImg?: boolean;
    decryptAudio?: boolean;
}

export interface RpgApplyOptions {
    dir: string;
    /** true면 원본 위치에 직접 적용(legacy 전용, CLI v1에서는 미제공). */
    instantapply?: boolean;
    autoline?: boolean;
    isComment?: boolean;
    useYaml?: boolean;
}

export interface RpgOperationReport {
    dir: string;
    extractedFiles: string[];
    appliedFiles: string[];
    textBytes: number;
    elapsedMs: number;
    manifestPath?: string;
    manifestEntries?: number;
}

function getBinarySize(str: string): number {
    return Buffer.byteLength(str, 'utf8');
}

export class RpgMakerService {
    constructor(private readonly context: OperationContext) {}

    /** 기존 main.ts의 extractor() 이식. Extract/Backup/.extracteddata를 생성한다. */
    async extract(arg: RpgExtractOptions): Promise<RpgOperationReport> {
        setActiveContext(this.context);
        const report: RpgOperationReport = { dir: arg.dir, extractedFiles: [], appliedFiles: [], textBytes: 0, elapsedMs: 0 };
        const performT = performance.now();
        ctx().rpg.gb = {};
        let file;
        const extended = true;
        const dir = arg.dir;
        if (!fs.existsSync(dir)) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, '지정된 디렉토리가 없습니다', { dir });
        }
        if (path.parse(dir).name !== 'data' && (!arg.force)) {
            throw new OperationError(ErrorCodes.FORMAT_MISMATCH, 'data 폼더가 아닙니다', { dir });
        }
        if (fs.existsSync(dir + '/Extract')) {
            if (!arg.force) {
                // GUI adapter는 이 코드를 받으면 기존 check_force 확인 흐름을 재현한다.
                throw new OperationError(ErrorCodes.EXTRACT_EXISTS, 'Extract 폼더가 이미 존재합니다', { dir });
            }
            fs.rmSync(dir + '/Extract', { recursive: true });
            if (fs.existsSync(dir + '/Backup')) {
                fs.rmSync(dir + '/Backup', { recursive: true });
            }
        }
        if (arg.ext_plugin) {
            let jsdir = ((dir.substring(0, dir.length - 5) + '/js').replaceAll('//', '/'));
            if (!fs.existsSync(jsdir + '/plugins.js')) {
                jsdir = path.join(path.dirname(path.dirname(path.dirname(jsdir))), 'js');
                if (!fs.existsSync(jsdir + '/plugins.js')) {
                    throw new OperationError(ErrorCodes.PATH_NOT_FOUND, 'plugin.js가 존재하지 않습니다', { jsdir });
                }
            }
            let hail2 = fs.readFileSync(jsdir + '/plugins.js', 'utf-8');
            const hail = hail2.split('$plugins =');
            hail2 = hail[hail.length - 1] + '  ';
            hail2 = hail2.substring(hail2.indexOf('['), hail2.lastIndexOf(']') + 1);
            fs.writeFileSync(dir + '/ext_plugins.json', JSON.stringify(JSON.parse(hail2)), 'utf-8');
        }
        ctx().rpg.externMsg = {};
        ctx().rpg.useExternMsg = false;
        if (fs.existsSync(dir + '/ExternMessage.csv') && arg.exJson && ctx().rpg.settings.ExternMsgJson) {
            const Emsg = await ExtTool.parse_externMsg(dir + '/ExternMessage.csv', !ctx().rpg.settings.ExternMsgJson) as { [key: string]: string };
            ctx().rpg.externMsg = Emsg;
            if (ctx().rpg.settings.ExternMsgJson) {
                fs.writeFileSync(dir + '/ExternMsgcsv.json', JSON.stringify(Emsg, null, 4), 'utf-8');
            }
            else {
                ctx().rpg.useExternMsg = true;
                ctx().rpg.externMsgKeys = Object.keys(Emsg);
            }
        }
        const tempjsons: string[] = [];
        const fileList2 = fs.readdirSync(dir);
        for (const i in fileList2) {
            const f = path.join(dir, fileList2[i]);
            const pf = path.parse(f);
            if (f.endsWith('.json.yaml')) {
                const fname = path.join(pf.dir, pf.name);
                const fd = JSON.stringify(yaml.load(fs.readFileSync(f, 'utf-8') as string));
                fs.writeFileSync(fname, fd, 'utf-8');
                tempjsons.push(fname);
            }
        }

        const fileList = fs.readdirSync(dir);

        if (!fs.existsSync(dir + '/Extract')) {
            fs.mkdirSync(dir + '/Extract');
        }
        if (!fs.existsSync(dir + '/Backup')) {
            fs.mkdirSync(dir + '/Backup');
        }
        const onebyone = dataBaseO.onebyone;

        const max_files = fileList.length;
        let worked_files = 0;
        let jT = 0;
        ExtTool.init_extract(arg);
        for (const i in fileList) {
            worked_files += 1;
            const fileName = fileList[i];
            if (path.parse(fileName).ext != '.json') {
                continue;
            }
            const conf = {
                extended: extended,
                fileName: fileName,
                dir: dir,
                srce: arg.ext_src,
                autoline: arg.autoline,
                note: arg.ext_note,
                arg: arg,
            };
            const runBackup = async () => {
                try {
                    fs.copyFileSync(dir + '/' + fileName, dir + '/Backup/' + fileName);
                } catch (error) { }
            };
            runBackup();
            if (checkIsMapFile(fileName)) {
                file = fs.readFileSync(dir + '/' + fileName, 'utf8');
                jT += file.length;
                await ExtTool.format_extracted(await ExtTool.extract(file, conf, 'map'));
            }
            else if (Object.keys(onebyone).includes(fileName)) {
                file = fs.readFileSync(dir + '/' + fileName, 'utf8');
                jT += file.length;
                await ExtTool.format_extracted(await ExtTool.extract(file, conf, onebyone[fileName]));
            }
            else if (arg.exJson) {
                if (!dataBaseO.ignores.includes(fileName)) {
                    file = fs.readFileSync(dir + '/' + fileName, 'utf8');
                    jT += file.length;
                    await ExtTool.format_extracted(await ExtTool.extract(file, conf, 'ex'));
                }
            }
            ctx().progress.set(worked_files / max_files * 100);
            await sleep(0);
        }
        report.textBytes = jT;
        const gbKeys = { ...Object.keys(ctx().rpg.gb) };
        for (const i in gbKeys) {
            const fileName = gbKeys[i];
            if (ctx().rpg.gb[fileName].outputText === '') {
                delete ctx().rpg.gb[fileName];
            }
            else if (fileName === 'ext_javascript.json') {
                fs.writeFileSync(dir + `/Extract/${path.parse(fileName).name}.js`, ctx().rpg.gb[fileName].outputText, 'utf-8');
                report.extractedFiles.push(`Extract/${path.parse(fileName).name}.js`);
                delete ctx().rpg.gb[fileName].outputText;
            }
            else {
                fs.writeFileSync(dir + `/Extract/${path.parse(fileName).name}.txt`, ctx().rpg.gb[fileName].outputText, 'utf-8');
                report.extractedFiles.push(`Extract/${path.parse(fileName).name}.txt`);
                delete ctx().rpg.gb[fileName].outputText;
            }
        }
        const ext_data = {
            main: ctx().rpg.gb,
        };
        edTool.write(dir, ext_data);
        // Extract/manifest.json 생성(계획서 §Manifest와 안전성)
        const manifest = buildRpgManifest(ctx().rpg.gb);
        atomicWriteFileSync(path.join(dir, 'Extract', MANIFEST_FILE), JSON.stringify(manifest, null, 2));
        report.manifestPath = path.join(dir, 'Extract', MANIFEST_FILE);
        report.manifestEntries = manifest.entries.length;
        if (fs.existsSync(dir + '/ext_plugins.json')) {
            fs.rmSync(dir + '/ext_plugins.json');
        }
        if (fs.existsSync(dir + '/ExternMsgcsv.json')) {
            fs.rmSync(dir + '/ExternMsgcsv.json');
        }
        for (const i in tempjsons) {
            fs.rmSync(tempjsons[i]);
        }
        ['img', 'audio'].forEach((type) => {
            const ExtractImgDir = path.join(dir, `Extract_${type}`);
            if (fs.existsSync(ExtractImgDir)) {
                fs.rmSync(ExtractImgDir, { recursive: true, force: true });
            }
        });
        if (arg.decryptImg) {
            await ExtTool.DecryptDir(dir, 'img');
        }
        if (arg.decryptAudio) {
            await ExtTool.DecryptDir(dir, 'audio');
        }
        report.elapsedMs = performance.now() - performT;
        return report;
    }

    /** 기존 apply.ts의 apply() 이식. .extracteddata + Extract 텍스트를 원본 구조에 적용한다. */
    async apply(arg: RpgApplyOptions): Promise<RpgOperationReport> {
        setActiveContext(this.context);
        const report: RpgOperationReport = { dir: arg.dir, extractedFiles: [], appliedFiles: [], textBytes: 0, elapsedMs: 0 };
        const performT = performance.now();
        const dir = arg.dir;
        if (!fs.existsSync(dir + '/Extract')) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, 'Extract 폼더가 존재하지 않습니다', { dir });
        }
        if (!edTool.exists(dir)) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, '.extracteddata 파일이 존재하지 않습니다', { dir });
        }
        // 기존 코드의 '.Completed' 오타 로직 정정(notes.md 참조) + 임시 스테이징 후 교체(계획서 §Manifest와 안전성).
        // instantapply(legacy)는 기존처럼 원본 위치에 직접 쓴다.
        const completedFinal = path.join(dir, 'Completed');
        const completedRoot = arg.instantapply ? completedFinal : makeStagingDir(dir, '.completed-staging');
        if (!arg.instantapply) {
            try { fs.mkdirSync(path.join(completedRoot, 'data')); } catch (error) { }
            try { fs.mkdirSync(path.join(completedRoot, 'js')); } catch (error) { }
        }
        const jsdir = ((dir.substring(0, dir.length - 5) + '/js').replaceAll('//', '/'));
        const ext_data = edTool.read(dir);
        const ext_dat = ext_data.main;
        const max_files = Object.keys(ext_dat).length;
        let worked_files = 0;
        const OutputData = {};
        for (const i of Object.keys(ext_dat)) {
            if (fs.existsSync(dir + '/Backup/' + i)) {
                let filedata = fs.readFileSync(dir + '/Backup/' + i, 'utf8');
                if (filedata.charCodeAt(0) === 0xFEFF) {
                    filedata = filedata.substring(1);
                }
                try {
                    OutputData[i] = JSON.parse(filedata);
                } catch (error) { }
            }
        }
        for (const i of Object.keys(ext_dat)) {
            worked_files += 1;
            if (i.includes('.json')) {
                const fname = (i === 'ext_javascript.json') ? dir + '/Extract/ext_javascript.js' : dir + '/Extract/' + path.parse(i).name + '.txt';
                const Edata = fs.readFileSync(fname, 'utf8').split('\n');
                for (const q of Object.keys(ext_dat[i].data)) {
                    let output = '';
                    let autoline = false;
                    let autolineSize = 0;
                    const originFile = ext_dat[i].data[q].origin ?? i;
                    if (ext_dat[i].data[q].conf !== undefined) {
                        const econf = ext_dat[i].data[q].conf;
                        if (arg.autoline && econf.type == 'event' && econf.code == 401) {
                            autoline = true;
                            autolineSize = econf.face ? 80 : 60;
                        }
                        if (arg.isComment) {
                            continue;
                        }
                    }
                    for (let x = parseInt(q); x < ext_dat[i].data[q].m; x++) {
                        let forUse = Edata[x];
                        if (autoline && (getBinarySize(forUse) > autolineSize)) {
                            const v = forUse.split(' ');
                            if (v.length > 0) {
                                v[(Math.floor(v.length / 2)) - 1] = '\n' + v[(Math.floor(v.length / 2)) - 1];
                            }
                            forUse = v.join(' ');
                        }
                        output += forUse;
                        if (x !== (ext_dat[i].data[q].m - 1)) {
                            output += '\n';
                        }
                    }
                    try {
                        if (!Object.keys(OutputData).includes(originFile)) {
                            const fidir = path.join(dir, 'Backup', originFile);
                            if (fs.existsSync(fidir)) {
                                let filedata = fs.readFileSync(fidir, 'utf8');
                                if (filedata.charCodeAt(0) === 0xFEFF) {
                                    filedata = filedata.substring(1);
                                }
                                try {
                                    OutputData[originFile] = JSON.parse(filedata);
                                } catch (error) { }
                            }
                        }
                        OutputData[originFile] = ExtTool.setObj(ext_dat[i].data[q].val, output, OutputData[originFile]);
                    } catch (error) {
                        ctx().logger.warn(`apply setObj 실패: ${ext_dat[i].data[q].val}`);
                    }
                }
            }
            ctx().progress.set(worked_files / max_files * 100);
            await sleep(0);
        }
        for (const i of Object.keys(OutputData)) {
            const data = OutputData[i];
            if (i == 'ext_plugins.json') {
                const vaq = `var $plugins = ${JSON.stringify(data)};`;
                if (arg.instantapply) {
                    fs.writeFileSync(jsdir + '/plugins.js', vaq, 'utf8');
                    report.appliedFiles.push(jsdir + '/plugins.js');
                }
                else {
                    const pluginsOut = path.join(completedRoot, 'js', 'plugins.js');
                    fs.writeFileSync(pluginsOut, vaq, 'utf8');
                    report.appliedFiles.push(pluginsOut);
                }
            }
            else if (i == 'ExternMsgcsv.json') {
                if (arg.instantapply) {
                    await ExtTool.pack_externMsg(dir + '/ExternMessage.csv', data);
                    report.appliedFiles.push(dir + '/ExternMessage.csv');
                }
                else {
                    const csvOut = path.join(completedRoot, 'data', 'ExternMessage.csv');
                    await ExtTool.pack_externMsg(csvOut, data);
                    report.appliedFiles.push(csvOut);
                }
            }
            else {
                const fdir = arg.instantapply ? path.join(dir, i) : path.join(completedRoot, 'data', i);
                const fdir2 = arg.instantapply ? path.join(dir, `${i}.yaml`) : path.join(completedRoot, 'data', `${i}.yaml`);
                const fd = arg.useYaml ? fdir2 : fdir;
                const dataJson = arg.useYaml ? yaml.dump(data) : JSON.stringify(data, null, 4 * (ctx().rpg.settings.JsonChangeLine ? 1 : 0));
                fs.writeFileSync(fd, dataJson, 'utf8');
                report.appliedFiles.push(fd);
                if (arg.useYaml && fs.existsSync(fdir)) {
                    fs.rmSync(fdir);
                }
                else if ((!arg.useYaml) && fs.existsSync(fdir2)) {
                    fs.rmSync(fdir2);
                }
            }
        }

        if (!arg.instantapply) {
            // 스테이징 완료 후 Completed로 교체(실패 시 기존 Completed 롤백)
            replaceDirSync(completedRoot, completedFinal);
        }
        await ExtTool.EncryptDir(dir, 'img', arg.instantapply ?? false);
        await ExtTool.EncryptDir(dir, 'audio', arg.instantapply ?? false);
        report.elapsedMs = performance.now() - performT;
        return report;
    }
}
