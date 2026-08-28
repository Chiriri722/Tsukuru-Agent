import crypto from 'crypto';
import { app } from "electron";
import { existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { sleep } from "../rpgmv/globalutils";
import { onValidated } from "../../electron/ipcRegistration";
import { atomicWriteFileSync } from '../../core/atomic';
import { requestBuffer } from '../../core/httpClient';

export const WOLFDEC_RELEASE_URL = 'https://github.com/Sinflower/WolfDec/releases/download/v0.3/WolfDec.exe';
export const WOLFDEC_SHA256 = '847e1812c1150a0cd168400ea3625487707aceb6e625a7324e4dc1a80da0619c';
export const WOLFDEC_SIZE = 256000;

function sha256(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function validWolfDec(target: string): boolean {
    if (!existsSync(target)) return false;
    const data = readFileSync(target);
    return data.length === WOLFDEC_SIZE && sha256(data) === WOLFDEC_SHA256;
}

async function downloadWolfDec(target: string): Promise<void> {
    const response = await requestBuffer(WOLFDEC_RELEASE_URL, {
        timeoutMs: 30_000,
        maxBytes: 1024 * 1024,
        maxRedirects: 3,
        allowedRedirectHosts: ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
    });
    if (response.status !== 200 || response.data.length !== WOLFDEC_SIZE || sha256(response.data) !== WOLFDEC_SHA256) {
        throw new Error('WolfDec v0.3 download failed its pinned size/SHA-256 policy');
    }
    atomicWriteFileSync(target, response.data);
}

let gExt = false
let acceptedExt = false
export const ExtentionPath = path.join(app.getPath('userData'), 'Ext')
export function initExtentions(){
    if(!existsSync(app.getPath('userData'))){
        mkdirSync(app.getPath('userData'))
    }
    if(!existsSync(ExtentionPath)){
        mkdirSync(ExtentionPath)
    }
    onValidated('getextention', async (ev, arg) => {
        acceptedExt = false
        try {
            switch(arg){
                case 'wolfdec':{
                    await downloadWolfDec(path.join(ExtentionPath, 'wolfdec.exe'));
                    acceptedExt = true;
                    break
                }
                case 'none':{
                    acceptedExt = false
                }
            }
        } finally {
            gExt = true
        }
    })
}

export async function checkExtention(param:'wolfdec') {
    const isInstalled = param === 'wolfdec' ? validWolfDec(path.join(ExtentionPath, 'wolfdec.exe')) : false
    const parKo = {
        'wolfdec': '복호화'
    }
    const parEn = {
        'wolfdec': 'Decryption'
    }

    if(!isInstalled){
        if(globalThis.settings.language === 'ko'){
            mwindow.webContents.send('alertExten', [`${parKo[param]}에는 확장 설치가 필요합니다. 설치하시겠습니까?`,param])
        }
        else{
            mwindow.webContents.send('alertExten', [`${parEn[param]} requires an extension installation. Do you want to install it?`,param])
        }
        gExt = false
        while(!gExt){
            await sleep(10)
        }
        return acceptedExt
    }
    else{
        return true
    }
}
