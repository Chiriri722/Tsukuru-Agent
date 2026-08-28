import type { BrowserWindow } from "electron"
import { sleep } from "../rpgmv/globalutils"
import { createSecureWindow } from "../../electron/windowFactory"

let papagoWindow:Electron.BrowserWindow = null
let loadFinish = false

async function loadUrlAndWait(url:string) {
    loadFinish = false
    papagoWindow.loadURL(url)
    while(!loadFinish){
        await sleep(10)
    }
}


export async function papagoTrans(text:string, queryLanguage:string) {
    if(!papagoWindow){
        console.log('init papago')
        papagoWindow = createSecureWindow({
            width: 800,
            height: 800,
            resizable: false,
            autoHideMenuBar: true,
            frame: false,
            bridge: false,
            allowedNavigationHosts: ['papago.naver.com'],
            show: false
        })
        papagoWindow.webContents.on('did-finish-load', function () {
            console.log('inited papago')
            loadFinish = true
        })
    }
    const encoded = encodeURIComponent(text)
    await loadUrlAndWait(`https://papago.naver.com/?sk=${queryLanguage}&tk=ko&hn=1&st=${encoded}`)
    let txt = null
    while(!txt){
        txt = await papagoWindow.webContents.executeJavaScript("document.querySelector('#txtTarget span')?.innerText")
    }
    return txt
}

export function uninitPapago() {
    if(papagoWindow){
        papagoWindow.close()
        papagoWindow = null
    }
}
