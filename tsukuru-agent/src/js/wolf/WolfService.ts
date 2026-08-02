/**
 * WolfService: Wolf RPG 추출·적용 로직의 UI 비의존 서비스 (계획서 §구현 방향).
 * 기존 wolf/main.ts의 wolf_ext/wolf_apply IPC 핸들러 로직을 이식했다.
 * WolfMetadata/WolfExtData/WolfCache/sourceDir는 OperationContext.wolf로 이동했다.
 */
import path from 'path';
import fs from 'fs';
import { extractWolfFolder } from './extract/extractor';
import makeText from './extract/makeText';
import { wolfAppyier } from './apply/applyWolf';
import { getAllFileInDir } from '../../utils';
import { wolfDecrypt } from './extract/decrypter';
import { OperationContext, ctx, setActiveContext } from '../../core/context';
import { OperationError, ErrorCodes } from '../../core/types';
import { buildWolfManifest } from '../../core/manifestBuild';
import { MANIFEST_FILE } from '../../core/manifest';
import { atomicWriteFileSync } from '../../core/atomic';

export interface WolfOperationOptions {
    /** 게임 루트 또는 data 폼더(평문 경로). extract는 둘 다 허용, apply는 data 폼더만. */
    folder: string;
    /** force: data 폼더 검사 우회 / extPattern, extBuran, extAll: 추출 옵션. */
    config: { [key: string]: boolean };
}

export interface WolfOperationReport {
    folder: string;
    dataDir?: string;
    extractDir?: string;
    extractedEntries: number;
    appliedEntries: number;
    manifestPath?: string;
}

export class WolfService {
    constructor(private readonly context: OperationContext) {}

    /** 기존 wolf_ext 핸들러 이식. .wolf 복호화 시도 → 추출 → 텍스트화. */
    async extract(arg: WolfOperationOptions): Promise<WolfOperationReport> {
        setActiveContext(this.context);
        ctx().wolf.metadata = { ver: -1 };
        let dir = arg.folder;
        if (path.parse(dir).name !== 'data') {
            if (fs.existsSync(path.join(dir, 'Data'))) {
                dir = path.join(dir, 'Data');
            }
            else if (fs.existsSync(path.join(dir, 'data'))) {
                dir = path.join(dir, 'data');
            }
        }
        if (!fs.existsSync(dir)) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, '지정된 디렉토리가 없습니다', { dir: arg.folder });
        }
        if ((path.parse(dir).name !== 'data' && (!fs.existsSync(path.join(dir, 'Data.wolf')))) && (!arg.config.force)) {
            throw new OperationError(ErrorCodes.FORMAT_MISMATCH, 'data 폼더가 아닙니다', { dir });
        }

        ctx().wolf.sourceDir = arg.folder;
        ctx().wolf.extData = [];
        const encrypted = getAllFileInDir(path.dirname(dir), '.wolf');
        if (encrypted.length > 0) {
            const d = await wolfDecrypt(encrypted);
            if (!d) {
                // 기존 코드는 worked()만 호출하고 계속 진행했다(복호화 확장 프로그램 부재 등).
                ctx().logger.warn('wolf 아카이브 복호화를 건너뛰었습니다(복호화 도구 부재 또는 실패)');
            }
        }
        if (path.parse(dir).name !== 'data') {
            if (fs.existsSync(path.join(dir, 'Data'))) {
                dir = path.join(dir, 'Data');
            }
            else if (fs.existsSync(path.join(dir, 'data'))) {
                dir = path.join(dir, 'data');
            }
        }
        await extractWolfFolder(dir, arg.config);
        await makeText();
        // _Extract/manifest.json 생성(계획서 §Manifest와 안전성)
        const encoding = ctx().wolf.metadata.ver === 2 ? 'shift_jis' : 'utf8';
        const manifest = buildWolfManifest(ctx().wolf.extData, ctx().wolf.sourceDir, encoding);
        const manifestPath = path.join(ctx().wolf.sourceDir, '_Extract', MANIFEST_FILE);
        atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        return {
            folder: arg.folder,
            dataDir: dir,
            extractDir: path.join(ctx().wolf.sourceDir, '_Extract'),
            extractedEntries: ctx().wolf.extData.length,
            appliedEntries: 0,
            manifestPath,
        };
    }

    /** 기존 wolf_apply 핸들러 이식. _Extract의 텍스트를 바이너리에 적용한다. */
    async apply(arg: WolfOperationOptions): Promise<WolfOperationReport> {
        setActiveContext(this.context);
        const dir = arg.folder;
        if (!fs.existsSync(dir)) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, '지정된 디렉토리가 없습니다', { dir });
        }
        if (path.parse(dir).name !== 'data' && (!arg.config.force)) {
            throw new OperationError(ErrorCodes.FORMAT_MISMATCH, 'data 폼더가 아닙니다', { dir });
        }
        ctx().wolf.sourceDir = arg.folder;
        ctx().wolf.extData = [];
        const res = await wolfAppyier();
        for (const skipped of res.skipped) {
            ctx().logger.warn(`wolf apply skipped: ${skipped.sourceFile} - ${skipped.reason}`);
        }
        return {
            folder: arg.folder,
            extractedEntries: 0,
            appliedEntries: res.applied,
        };
    }

    /**
     * CLI 전용(계획서 §CLI 계약 apply): dataDir의 _Extract를 읽어
     * targetDir(게임 복사본)에만 적용한다. 원본 바이너리는 변경하지 않는다.
     * targetDir는 호출자가 미리 dataDir의 복사본으로 만들어 두어야 한다.
     */
    async applyToCopy(arg: { dataDir: string; targetDir: string }): Promise<WolfOperationReport> {
        setActiveContext(this.context);
        if (!fs.existsSync(arg.dataDir)) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, '지정된 디렉토리가 없습니다', { dir: arg.dataDir });
        }
        const extDir = path.join(arg.dataDir, '_Extract');
        if (!fs.existsSync(path.join(extDir, '.extracteddata'))) {
            throw new OperationError(ErrorCodes.MANIFEST_MISSING, '_Extract/.extracteddata가 없습니다. 먼저 extract를 실행하세요', { dir: extDir });
        }
        if (!fs.existsSync(arg.targetDir)) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, '대상 복사본 디렉토리가 없습니다', { dir: arg.targetDir });
        }
        ctx().wolf.sourceDir = arg.dataDir;
        ctx().wolf.extData = [];
        const res = await wolfAppyier({ from: arg.dataDir, to: arg.targetDir });
        for (const skipped of res.skipped) {
            ctx().logger.warn(`wolf apply skipped: ${skipped.sourceFile} - ${skipped.reason}`);
        }
        return {
            folder: arg.dataDir,
            extractedEntries: 0,
            appliedEntries: res.applied,
        };
    }
}
