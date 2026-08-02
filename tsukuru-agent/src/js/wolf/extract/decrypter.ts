import { exec } from "child_process";
import { removeSync } from "fs-extra";
import path from "path";
import { ctx } from '../../../core/context';

/**
 * 복호화 도구(wolfdec.exe) 경로를 해석한다.
 * GUI: 확장 시스템(extentions) 경로 사용. Headless(CLI): electron을 로드할 수
 * 없으므로 해석 실패 시 미설치로 처리한다 — CLI는 확장 프로그램을 설치하지
 * 않는다(계획서 §구현 방향). 모듈 로드 시 electron을 직접 참조하지 않도록
 * lazy require를 사용한다.
 */
function resolveDecrypterPath(): string | null {
    try {
        const ext = require('../../libs/extentions');
        return path.join(ext.ExtentionPath, 'wolfdec.exe');
    } catch {
        return null;
    }
}

async function checkDecrypter(): Promise<string | null> {
    const decrypter = resolveDecrypterPath();
    if (decrypter === null) {
        return null;
    }
    try {
        const ext = require('../../libs/extentions');
        return (await ext.checkExtention('wolfdec')) ? decrypter : null;
    } catch {
        return null;
    }
}

function setProgressBar(now: number, max: number, multipl = 100) {
    ctx().progress.set((now / max) * multipl);
}

function DecryptFile(decrypter: string, file: string) {
    return new Promise<void>((resolve) => {
        const d = exec(`${decrypter} ${file}`, { cwd: path.dirname(file) })
        d.on('exit', () => {
            removeSync(file)
            resolve()
        })
    })
}


export async function wolfDecrypt(files: string[]) {
    const decrypter = await checkDecrypter();
    if (decrypter !== null) {
        ctx().progress.setTag?.(`복호화 중`);
        let i = 0;
        for (const file of files) {
            setProgressBar(i, files.length)
            console.log(file)
            await DecryptFile(decrypter, file)
            i += 1
        }
        ctx().progress.setTag?.(``);
        return true
    }
    else {
        return false
    }
}
