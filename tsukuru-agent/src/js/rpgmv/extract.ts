import path from 'path';
import { ctx } from '../../core/context';
import { parseFile, writeToPath } from 'fast-csv';
import encoding from 'encoding-japanese';
import { DecryptDir as DecryptDirs, EncryptDir as EncryptDirs } from './fileCrypto';
import { beautifyCodes, beautifyCodes2 } from "./datas";
import { ErrorCodes, OperationError } from '../../core/types';
let eventID = 0

let hadComment = false
let hadMemoComment = false

function addtodic(pa, obj, usePath='', conf = undefined, spliter=false){
    const Path = pa
    if(pa === '%comment%'){
        const id = `comment_${(Object.keys(obj.main)).length}`
        obj.main[id] = {var: conf.comment, conf: {isComment:true}, qpath:usePath}
        return obj
    }
    let val = returnVal(Path, obj.edited)
    if(!strNullSafe(usePath)){
        usePath = ''
    }
    if(usePath == ''){
        if(conf !== undefined && conf.type == 'event'){
            if([356,357].includes(conf.code)){
                usePath = 'script'
            }
            if([355,655].includes(conf.code)){
                usePath = 'javascript'
            }
            if([108,408].includes(conf.code)){
                usePath = 'note2'
            }
        }
    }
    if(val !== undefined && val !== null && typeof(val) === 'string' && (val.length > 0 || ctx().rpg.settings.ExtractAddLine)){
        const id = Path
        if(usePath === 'note' || spliter){
            obj = addtodic('%comment%', obj, usePath, {comment:'-----'}) 
        }
        obj.main[id] = {var: val, conf: conf, qpath:usePath}
        hadComment = false
    }
    return obj
}

function addtodicSpliter(pa, obj, usePath='', conf = undefined){
    return addtodic(pa, obj, usePath, conf, true)
}

function addComment(obj, comment:string, usePath='', force:'force'|'nonforce'= 'nonforce'){
    if(force === 'force'){
        hadComment = false
    }
    if(!hadComment){
        hadComment = true
        return addtodic('%comment%', obj, usePath, {comment:comment}) 
    }
    return obj
}

const addto = (key, val,temppp) => { 
    let Keys = key.split('.');
    const fkey = Keys[0]
    if(temppp === undefined){
        temppp = {}
    }
    if(Keys.length==1){
        temppp[fkey] = val;
    }
    else{
        Keys.shift()
        if(temppp[fkey] === undefined){
            temppp[fkey] = {}
        }
        temppp[fkey] = addto(Keys.join('.'), val, temppp[fkey])
    }
    return temppp
}

const returnVal = (key, temppp) => { 
    let Keys = key.split('.');
    const fkey = Keys[0]
    if(temppp === undefined){
        return ''
    }
    if(Keys.length==1){
        return temppp[fkey];
    }
    else{
        Keys.shift()
        if(temppp[fkey] === undefined){
            temppp[fkey] = {}
        }
        return returnVal(Keys.join('.'), temppp[fkey])
    }
}

export const setObj = addto

function obNullSafe(c){
    return (typeof c === 'object' && c !== undefined && c !== null)
}

function strNullSafe(d){
    return (typeof d === 'string' && d !== undefined && d !== null)
}

export const init_extract = (arg) => {
    hadComment = false
    function c(fileName){
        ctx().rpg.gb[fileName] = {data: {}}
        ctx().rpg.gb[fileName].outputText = ''
        ctx().rpg.gb[fileName].isbom = false 
    }
    if(ctx().rpg.settings.onefile_src && arg.ext_src){
        c('ext_scripts.json')
    }
    if(ctx().rpg.settings.onefile_src && arg.ext_javascript){
        c('ext_javascript.json')
    }
    if(ctx().rpg.settings.onefile_note && arg.ext_note){
        c('ext_note.json')
        c('ext_note2.json')
    }
    if(ctx().rpg.settings.oneMapFile){
        c('Maps.json')
    }
}

function Extreturnit(dat_obj, Path='', nas=null){
    if(typeof(nas) === 'object' && nas !== null){
        const keys = Object.keys(nas)
        for(let i=0;i<keys.length;i++){
            if(Path === ''){
                dat_obj = Extreturnit(dat_obj, keys[i], nas[keys[i]])
            }
            else{
                dat_obj = Extreturnit(dat_obj, Path + '.' + keys[i], nas[keys[i]])
            }
        }
        return dat_obj
    }
    else{
        return addtodic(Path, dat_obj, 'ext')
    }
}


export const parse_externMsg = (dir, useI) => {
    return new Promise((resolve, reject) => {
        const a = Object.create(null)
        parseFile(dir, {encoding: "binary"})
        .on('data', (row) => {
            function Convert(txt){
                if(txt === undefined || txt === null){
                    return ''
                }
                const bf = Buffer.from(txt, "binary")
                const Utf8Array = new Uint8Array(encoding.convert(bf, 'UTF8', 'AUTO'));
                return new TextDecoder().decode(Utf8Array)
            }
            if(useI){
                a[`\\M[${Convert(row[0])}]`] = Convert(row[1])
            }
            else{
                a[Convert(row[0])] = Convert(row[1])
            }
        })
        .on('end', () => {
            resolve(a)
        })
        .on('error', reject)
    })
}

export const pack_externMsg = (dir:string, data) => {
    return new Promise<void>((resolve, reject) => {
        let rows = []
        for(const i in data){
            rows.push([i, data[i]])
        }
        writeToPath(dir, rows)
        .on('error', reject)
        .on('finish', () => resolve());
    })
}

type ExtractionObject = { main: Record<string, unknown>; edited: any };

function addConfiguredNote(datObj: ExtractionObject, dataPath: string, note: unknown, conf: any): ExtractionObject {
    if (!conf.note) return datObj
    if (ctx().rpg.settings.extractSomeScript && !isIncludeAble(note)) return datObj
    return addtodic(dataPath, datObj, 'note')
}

function extractMapData(datObj: ExtractionObject, data: any, conf: any): ExtractionObject {
    if (ctx().rpg.settings.oneMapFile) datObj = addComment(datObj, '------- MAP -------')
    if (strNullSafe(data.displayName)) datObj = addtodic('displayName', datObj)
    datObj = addConfiguredNote(datObj, 'note', data.note, conf)
    if (!obNullSafe(data.events)) return datObj

    for (let eventIndex = 0; eventIndex < data.events.length; eventIndex++) {
        const event = data.events[eventIndex]
        if (!obNullSafe(event) || !obNullSafe(event.pages)) continue
        datObj = addConfiguredNote(datObj, `events.${eventIndex}.note`, event.note, conf)
        for (let pageIndex = 0; pageIndex < event.pages.length; pageIndex++) {
            const page = event.pages[pageIndex]
            if (obNullSafe(page) && obNullSafe(page.list)) {
                datObj = forEvent(page, datObj, conf, `events.${eventIndex}.pages.${pageIndex}`)
            }
        }
    }
    return datObj
}

function addIndexedSystemValues(datObj: ExtractionObject, data: any, key: string): ExtractionObject {
    if (!obNullSafe(data[key])) return datObj
    for (let index = 0; index < data[key].length; index++) {
        datObj = addtodicSpliter(`${key}.${index}`, datObj)
    }
    return datObj
}

function extractSystemData(datObj: ExtractionObject, data: any): ExtractionObject {
    datObj = addIndexedSystemValues(datObj, data, 'armorTypes')
    datObj = addtodic('currencyUnit', datObj)
    datObj = addIndexedSystemValues(datObj, data, 'elements')
    datObj = addIndexedSystemValues(datObj, data, 'equipTypes')
    datObj = addtodic('gameTitle', datObj)
    datObj = addIndexedSystemValues(datObj, data, 'skillTypes')
    if (obNullSafe(data.terms)) {
        for (const key of ['basic', 'commands', 'params']) {
            if (!obNullSafe(data.terms[key])) continue
            for (let index = 0; index < data.terms[key].length; index++) {
                datObj = addtodicSpliter(`terms.${key}.${index}`, datObj)
            }
        }
        if (obNullSafe(data.terms.messages)) {
            for (const key of Object.keys(data.terms.messages)) {
                datObj = addtodicSpliter(`terms.messages.${key}`, datObj)
            }
        }
    }
    return addIndexedSystemValues(datObj, data, 'weaponTypes')
}

function extractTroopEvents(datObj: ExtractionObject, data: any[], conf: any): ExtractionObject {
    for (let troopIndex = 0; troopIndex < data.length; troopIndex++) {
        const troop = data[troopIndex]
        if (!obNullSafe(troop) || !obNullSafe(troop.pages)) continue
        for (let pageIndex = 0; pageIndex < troop.pages.length; pageIndex++) {
            const page = troop.pages[pageIndex]
            if (!obNullSafe(page) || !obNullSafe(page.list)) continue
            datObj = forEvent(page, datObj, conf, `${troopIndex}.pages.${pageIndex}`)
        }
    }
    return datObj
}

function extractPluginParameters(datObj: ExtractionObject, plugin: any, itemPath: string): ExtractionObject {
    const parameterNames = Object.keys(plugin.parameters)
    const ignoredValues = ['false', 'true', 'on', 'off', 'auto']
    let shownName = false
    for (const parameterName of parameterNames) {
        const value = plugin.parameters[parameterName]
        if (!isNaN(value) || ignoredValues.includes(value)) continue
        if (!shownName) {
            datObj = addComment(datObj, `//== ${plugin.name} ==//`, '', 'force')
            shownName = true
        }
        datObj = addComment(datObj, `--- ${parameterName}`, '', 'force')
        datObj = addtodic(`${itemPath}.parameters.${parameterName}`, datObj, plugin.name)
        datObj = addComment(datObj, '')
    }
    return datObj
}

const DATABASE_FIELDS: Record<string, string[]> = {
    actor: ['name', 'nickname', 'profile'],
    class: ['name', 'learnings.name'],
    skill: ['description', 'message1', 'message2', 'name'],
    state: ['description', 'message1', 'message2', 'message3', 'message4', 'name'],
    ene: ['name'],
    item: ['name', 'description'],
}

function extractDatabaseData(datObj: ExtractionObject, data: any[], conf: any, ftype: string): ExtractionObject {
    for (let index = 0; index < data.length; index++) {
        const entry = data[index]
        const itemPath = `${index}`
        if (ftype === 'events') {
            datObj = forEvent(entry, datObj, conf, itemPath)
            continue
        }
        if (!obNullSafe(entry)) continue
        for (const field of DATABASE_FIELDS[ftype] ?? []) {
            datObj = addtodicSpliter(`${itemPath}.${field}`, datObj)
        }
        if (ftype === 'plugin') datObj = extractPluginParameters(datObj, entry, itemPath)
        else datObj = addConfiguredNote(datObj, `${itemPath}.note`, entry.note, conf)
    }
    return datObj
}

export const extract = async (filedata, conf, ftype) => {
    const fileName = conf.fileName
    ctx().rpg.gb[fileName] = {data: {}}
    if (filedata.charCodeAt(0) === 0xFEFF) {
        filedata = filedata.substr(1);
        ctx().rpg.gb[fileName].isbom = true
    }
    else{
        ctx().rpg.gb[fileName].isbom = false 
    }
    let data
    try{
        data = JSON.parse(filedata)
    }
    catch(error){
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `RPG JSON 파싱에 실패했습니다: ${fileName}`, {
            fileName,
            cause: error instanceof Error ? error.message : String(error),
        })
    }
    let dat_obj = {
        main: {},
        edited: data
    }
    if (ftype === 'map') dat_obj = extractMapData(dat_obj, data, conf)
    else if (ftype === 'sys') dat_obj = extractSystemData(dat_obj, data)
    else if (ftype === 'ex') dat_obj = Extreturnit(dat_obj, '', dat_obj.edited)
    else if (ftype === 'ene2') dat_obj = extractTroopEvents(dat_obj, data, conf)
    else dat_obj = extractDatabaseData(dat_obj, data, conf, ftype)
    return {
        datobj: dat_obj.main,
        edited: dat_obj.edited,
        conf: conf
    }
}

function isIncludeAble(sc){
    const ess = ctx().rpg.settings.extractSomeScript2
    let able = false
    if(sc === null || sc === undefined){
        return false
    }
    for(let i=0;i<ess.length;i++){
        if(ess[i] === ''){
            continue
        }
        else if(sc.includes(ess[i])){
            able = true
            break
        }
    }
    return able
}

function forEvent(d, dat_obj, conf, Path){
    const extended = conf.extended
    const fileName = conf.fileName
    const dir = conf.dir
    if(obNullSafe(d)){
        if(conf.note){
            if(ctx().rpg.settings.extractSomeScript){
                if(isIncludeAble(d.note)){
                    dat_obj = addtodic(Path + '.note', dat_obj, 'note')
                }
            }
            else{
                dat_obj = addtodic(Path + '.note', dat_obj, 'note')
            }
        }
        if(typeof d.list === 'object' && d.list !== undefined && d.list !== null){
            let messageHasFace = false
            for(let i=0;i<d.list.length;i++){
                let acceptable = [401, 102, 405, 101, 105]
                let ischeckable = false
                let reportDebug = false
                if(conf.srce){
                    acceptable = acceptable.concat([356,357])
                }
                if(conf.arg.ext_javascript){
                    acceptable = acceptable.concat([355,655])
                }
                if(conf.note){
                    acceptable = acceptable.concat([408, 108])
                }
                if([356,355,108,408,357].includes(d.list[i].code) && ctx().rpg.settings.extractSomeScript){
                    ischeckable = true
                }
                acceptable.concat(ctx().rpg.settings.extractPlus)
                eventID += 1
                function checker(dat_obj, da, ca){
                    if(typeof da === 'object'){
                        for(let i3 in da){
                            dat_obj = checker(dat_obj, da[i3], ca + `.${i3}`)
                        }
                    }
                    else if(!ischeckable || isIncludeAble(da)){
                        dat_obj = addtodic(ca, dat_obj, '', {type: "event",code:d.list[i].code,eid:eventID,face:messageHasFace})
                    }
                    return dat_obj
                }
                
                if (acceptable.includes(d.list[i].code) && d.list[i].parameters !== undefined && d.list[i].parameters !== null){
                    if([101,102,105].includes(d.list[i].code)){
                        dat_obj = addComment(dat_obj, `--- ${d.list[i].code} ---`)
                    }
                    if(d.list[i].code === 101){
                        if(d.list[i].parameters.length >= 5){
                            dat_obj = checker(dat_obj, d.list[i].parameters[4], Path + `.list.${i}.parameters.${4}`)
                        }
                    }
                    else if(![105].includes(d.list[i].code)){
                        for(let i2=0;i2<d.list[i].parameters.length;i2++){
                            dat_obj = checker(dat_obj, d.list[i].parameters[i2], Path + `.list.${i}.parameters.${i2}`)
                        }
                    }
                }
                else{
                    try {
                        switch(d.list[i].code){
                            case 101:
                                messageHasFace = (d.list[i].parameters[0] !== '')
                                break
                        }   
                    } catch (error) {}
                }
            }
        }
    }
    return dat_obj
}

function jpathIsMap(jpath){
    const name = path.parse(jpath).name
    return (name.length === 6 && name.substring(0,3) === 'Map' && !isNaN(Number(name.substring(3))))
}


export const format_extracted = async(dats, typ = 0) => {
    const datobj = dats.datobj
    const conf = dats.conf
    const extended = conf.extended
    const fileName = conf.fileName
    const dir = conf.dir
    if(typ == 0){
        const Keys = Object.keys(datobj)
        let LenMemory = {}
        let LenKeys = []
        let usedEid = []
        ctx().rpg.gb[fileName].outputText = ''
        for(const d of Keys){
            let jpath = fileName
            if(datobj[d].qpath === 'script' && ctx().rpg.settings.onefile_src){
                jpath = 'ext_scripts.json'
            }
            else if(datobj[d].qpath === 'note' && ctx().rpg.settings.onefile_note){
                jpath = 'ext_note.json'
            }
            else if(datobj[d].qpath === 'note2' && ctx().rpg.settings.onefile_note){
                jpath = 'ext_note2.json'
            }
            else if(datobj[d].qpath === 'javascript' && ctx().rpg.settings.onefile_src){
                jpath = 'ext_javascript.json'
            }
            else if(ctx().rpg.settings.oneMapFile && jpathIsMap(jpath)){
                jpath = 'Maps.json'
            }
            if(ctx().rpg.useExternMsg){
                if(ctx().rpg.externMsgKeys.includes(datobj[d].var)){
                    datobj[d].var = ctx().rpg.externMsg[datobj[d].var]
                }
            }
            if(!LenKeys.includes(jpath)){
                LenMemory[jpath] = (ctx().rpg.gb[jpath].outputText.split('\n').length - 1)
                LenKeys.push(jpath)
            }
            if(ctx().rpg.settings.formatNice && obNullSafe(datobj[d].conf)){
                if(beautifyCodes.includes(datobj[d].conf.code)){
                    const toadd = '==========\n'
                    ctx().rpg.gb[jpath].outputText += toadd
                    LenMemory[jpath] += (toadd.split('\n').length - 1)
                }
                const eid = datobj[d].conf.eid
                if(eid !== undefined && eid !== null){
                    if(!usedEid.includes(eid) && beautifyCodes2.includes(datobj[d].conf.code)){
                        const toadd = `//==========//\n`
                        ctx().rpg.gb[jpath].outputText += toadd
                        LenMemory[jpath] += (toadd.split('\n').length - 1)
                        usedEid.push(eid)
                    }
                }
            }
            const cid = LenMemory[jpath]
            ctx().rpg.gb[jpath].data[cid] = {}
            ctx().rpg.gb[jpath].data[cid].origin = fileName
            ctx().rpg.gb[jpath].data[cid].type = 'None'
            ctx().rpg.gb[jpath].data[cid].val = d
            ctx().rpg.gb[jpath].data[cid].conf = datobj[d].conf
            ctx().rpg.gb[jpath].data[cid].originText = datobj[d].var
            ctx().rpg.gb[jpath].data[cid].qpath = datobj[d].qpath


            // const toadd = datobj[d].var + ` -- ${fileName}` +'\n' //for testing
            const toadd = datobj[d].var +'\n'

            ctx().rpg.gb[jpath].outputText += toadd
            LenMemory[jpath] += (toadd.split('\n').length - 1)

            ctx().rpg.gb[jpath].data[cid].m = LenMemory[jpath]
        }
    }
}

export const DecryptDir = DecryptDirs


export const EncryptDir = EncryptDirs
