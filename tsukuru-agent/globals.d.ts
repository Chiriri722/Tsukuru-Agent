import { BrowserWindow } from "electron"
import type { TsukuruBridge } from './src/electron/ipcTypes'

export declare global {
    interface Window {
        tsukuru: TsukuruBridge
        Swal: any
    }
    var mwindow:BrowserWindow
    var settings:{[key:string]: any}
    var keyvalue:CryptoKey|undefined
    var oPath:string
    var sourceDir:string
    var iconPath:string
    var WolfExtData: extData[]
    var WolfEncoding:'utf8'|'shift-jis'
    var WolfCache: {[key:string]:Buffer}
    var WolfMetadata: wolfMetadata
}

interface wolfMetadata{
    ver:2|3|-1
}

interface extData{
    str:lenStr
    sourceFile:string
    extractFile:string
    endsWithNull:boolean
    textLineNumber:number[]
    codeStr:string


}

export interface lenStr{
    pos1:number
    pos2:number
    pos3:number
    str:Uint8Array
    len:number
}
