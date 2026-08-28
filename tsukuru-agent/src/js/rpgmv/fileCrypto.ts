"use strict";

import path from 'path';
import fs from 'fs';
import * as rpgencrypt from "../libs/rpgencrypt";
import yaml from 'js-yaml';
import fsx from 'fs-extra'
import { ctx } from '../../core/context';
import { throwIfSignalAborted } from '../../core/operationRuntime';
import { ErrorCodes, OperationError } from '../../core/types';
import { WorkspaceTransaction } from '../../core/workspaceTransaction';

function reader(dir:string){
    if(fs.existsSync(dir+'.yaml')){
        let data = fs.readFileSync(dir+'.yaml', "utf-8")
        return yaml.load(data)
    }
    let data = fs.readFileSync(dir, "utf-8")
    if (data.charCodeAt(0) === 0xFEFF) {
        data = data.substring(1);
    }
    return JSON.parse(data)
}

const sleep = (ms:number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getFilesRecursively (directory:string, dita:null|string = null):string[] {
    const files:string[] = []
    if (fs.lstatSync(directory).isSymbolicLink()) {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            'RPG 암호화 자산 경로에 심볼릭 링크/정션이 있습니다',
            { path: directory },
        )
    }
    const filesInDirectory = fs.readdirSync(directory, { withFileTypes: true });
    const dira = dita ?? ''
    for (const entry of filesInDirectory) {
      const absolute = path.join(directory, entry.name);
      const absoluteDira = path.join(dira, entry.name);
      if (entry.isSymbolicLink()) {
          throw new OperationError(
              ErrorCodes.MAPPING_CORRUPT,
              'RPG 암호화 자산 경로에 심볼릭 링크/정션이 있습니다',
              { path: absolute },
          )
      }
      if (entry.isDirectory()) {
          const fi = getFilesRecursively(absolute, absoluteDira);
          for(const f of fi){
            files.push(f)
          }
      } else if (entry.isFile()) {
          files.push(absoluteDira);
      } else {
          throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'RPG 암호화 자산에 일반 파일이 아닌 항목이 있습니다', { path: absolute })
      }
    }
    return files
};

export async function DecryptDir (DataDir:string, type:string, outputDir?:string):Promise<void> {
    const operationContext = ctx();
    operationContext.progress.set(0);
    throwIfSignalAborted(operationContext.signal, 'rpg-decrypt-validate');
    if (type !== 'img' && type !== 'audio') {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, 'RPG 복호화 자산 유형은 img 또는 audio여야 합니다', { type });
    }
    operationContext.progress.setTag?.(`${type} 복호화 중`);
    const SysFile = reader(path.join(DataDir, "System.json"))
    const Key = SysFile.encryptionKey
    if (typeof Key !== 'string' || !/^[0-9a-fA-F]{32}$/.test(Key)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'RPG System.json의 encryptionKey가 유효하지 않습니다');
    }
    const ExtractImgDir = outputDir ?? path.join(DataDir, `Extract_${type}`)
    const imgDir = path.join(path.dirname(DataDir), type)
    const files:string[] = getFilesRecursively(imgDir)
        .sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')));
    const transaction = new WorkspaceTransaction({
        outputPath: ExtractImgDir,
        force: true,
        signal: operationContext.signal,
    });
    try {
        for(let i=0;i<files.length;i++){
            throwIfSignalAborted(operationContext.signal, 'rpg-decrypt-file');
            operationContext.progress.setTag?.(`${type} 복호화 중 : `);
            operationContext.progress.set((i/files.length)*100)
            throwIfSignalAborted(operationContext.signal, 'rpg-decrypt-file');
            const loc = path.join(imgDir,files[i])
            const targetDir = path.join(transaction.stagingPath, path.dirname(files[i]))
            try{
                fsx.mkdirsSync(targetDir)
                await rpgencrypt.Decrypt(loc, targetDir, Key)
            }catch(error){
                throw new OperationError(
                    ErrorCodes.MAPPING_CORRUPT,
                    `RPG ${type} 자산 복호화에 실패했습니다`,
                    { path: loc, cause: error instanceof Error ? error.message : String(error) },
                )
            }
            throwIfSignalAborted(operationContext.signal, 'rpg-decrypt-file');
            await sleep(1)
        }
        throwIfSignalAborted(operationContext.signal, 'rpg-decrypt-commit');
        transaction.commit();
    } finally {
        transaction.dispose();
        operationContext.progress.set(0);
    }
}


export async function EncryptDir (DataDir:string, type:string, instantapply:boolean, completedRoot?:string) {
    const operationContext = ctx();
    throwIfSignalAborted(operationContext.signal, 'rpg-encrypt-validate');
    if (type !== 'img' && type !== 'audio') {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, 'RPG 암호화 자산 유형은 img 또는 audio여야 합니다', { type });
    }
    const ExtractImgDirReal = path.join(DataDir, `Extract_${type}`)
    const ExtractImgDir = ExtractImgDirReal
    const CompleteDir = (()=>{
        if(instantapply){
            return path.join(path.dirname(DataDir), type)
        }
        return path.join(completedRoot ?? path.join(DataDir, 'Completed'), type)
    })()
    if(!fs.existsSync(ExtractImgDirReal)){
        return
    }
    const SysFile = reader(path.join(DataDir, "System.json"))
    const Key = SysFile.encryptionKey
    if (typeof Key !== 'string' || !/^[0-9a-fA-F]{32}$/.test(Key)) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'RPG System.json의 encryptionKey가 유효하지 않습니다');
    }
    const files = getFilesRecursively(ExtractImgDir)
        .sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')))
    if(!fs.existsSync(CompleteDir)){
        fs.mkdirSync(CompleteDir, { recursive: true })
    }
    else {
        getFilesRecursively(CompleteDir)
    }
    const MVMode = path.basename(path.dirname(path.resolve(DataDir))).toLowerCase() === 'www'

    try {
        for(let i=0;i<files.length;i++){
            throwIfSignalAborted(operationContext.signal, 'rpg-encrypt-file');
            operationContext.progress.setTag?.(`${type} 암호화 중 : `);
            operationContext.progress.set((i/files.length)*100)
            throwIfSignalAborted(operationContext.signal, 'rpg-encrypt-file');
            const loc = path.join(ExtractImgDir,files[i])
            const targetDir = path.join(CompleteDir, path.dirname(files[i]))
            try{
                fsx.mkdirsSync(targetDir)
                await rpgencrypt.Encrypt(loc, targetDir, Key, MVMode)
            }catch(error){
                throw new OperationError(
                    ErrorCodes.MAPPING_CORRUPT,
                    `RPG ${type} 자산 암호화에 실패했습니다`,
                    { path: loc, cause: error instanceof Error ? error.message : String(error) },
                )
            }
            throwIfSignalAborted(operationContext.signal, 'rpg-encrypt-file');
            await sleep(1)
        }
    } finally {
        operationContext.progress.set(0);
    }
}
