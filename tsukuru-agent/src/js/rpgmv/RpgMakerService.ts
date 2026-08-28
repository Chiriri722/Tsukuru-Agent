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
import { OperationContext, ctx, withOperationContext } from '../../core/context';
import { OperationError, ErrorCodes } from '../../core/types';
import { buildRpgManifest } from '../../core/manifestBuild';
import { MANIFEST_FILE, sha256Text } from '../../core/manifest';
import { atomicWriteFileSync, makeStagingDir, removePathBestEffortSync, replaceArtifactGroupSync } from '../../core/atomic';
import { WorkspaceTransaction } from '../../core/workspaceTransaction';
import { throwIfSignalAborted } from '../../core/operationRuntime';
import { resolveContainedPathWithoutLinks } from '../../core/pathSafety';
import { loadRpgApplyPlan, setRpgDataPath } from './applyPlan';

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
    /** 비-legacy 적용 결과 경로. 생략하면 data/Completed를 사용한다. */
    outputDir?: string;
    /** 기존 outputDir 교체 허용. 생략 시 legacy Completed 교체 동작을 보존한다. */
    force?: boolean;
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

function serializeRpgData(data: unknown): string {
    const serialized = JSON.stringify(data);
    if (serialized === undefined) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'RPG Backup 데이터를 JSON으로 직렬화할 수 없습니다');
    }
    return serialized;
}

function pathContains(parent: string, child: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertRpgApplyOutputSafe(dataDir: string, outputDir: string): void {
    const dataRoot = path.resolve(dataDir);
    const outputRoot = path.resolve(outputDir);
    const protectedArtifacts = [
        path.join(dataRoot, 'Extract'),
        path.join(dataRoot, 'Backup'),
        path.join(dataRoot, '.extracteddata'),
    ];
    if (pathContains(outputRoot, dataRoot)
        || protectedArtifacts.some((artifact) => pathContains(artifact, outputRoot))) {
        throw new OperationError(
            ErrorCodes.OUTPUT_CONFLICT,
            'RPG 출력 경로는 원본 data 또는 Extract/Backup/.extracteddata와 겹칠 수 없습니다',
            { dataDir: dataRoot, outputDir: outputRoot },
        );
    }
}

function resolveRpgApplyChild(root: string, relativePath: string, label: string): string {
    const resolved = resolveContainedPathWithoutLinks(root, relativePath);
    if (resolved.ok === false) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, `${label} 경로가 작업 루트를 벗어나거나 링크를 통과합니다`, {
            root,
            relativePath,
            reason: resolved.reason,
        });
    }
    return resolved.path;
}

function assertRpgExtractRootSafe(dataDir: string): void {
    const root = path.resolve(dataDir);
    const rootStat = fs.lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            'RPG data 경로는 링크가 아닌 디렉터리여야 합니다',
            { dataDir: root },
        );
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const entryPath = path.join(root, entry.name);
        const stat = fs.lstatSync(entryPath);
        if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
            throw new OperationError(
                ErrorCodes.MAPPING_CORRUPT,
                'RPG 추출 입력 또는 관리 경로에 심볼릭 링크/정션이 있습니다',
                { entry: entry.name },
            );
        }
        if ((entry.name.endsWith('.json') || entry.name.endsWith('.json.yaml') || entry.name === 'ExternMessage.csv') && !stat.isFile()) {
            throw new OperationError(
                ErrorCodes.MAPPING_CORRUPT,
                'RPG JSON 추출 입력은 일반 파일이어야 합니다',
                { entry: entry.name },
            );
        }
        if (['Extract', 'Backup', 'Extract_img', 'Extract_audio'].includes(entry.name) && !stat.isDirectory()) {
            throw new OperationError(
                ErrorCodes.MAPPING_CORRUPT,
                'RPG 추출 관리 경로는 디렉터리여야 합니다',
                { entry: entry.name },
            );
        }
        if (entry.name === '.extracteddata' && !stat.isFile()) {
            throw new OperationError(
                ErrorCodes.MAPPING_CORRUPT,
                'RPG .extracteddata는 일반 파일이어야 합니다',
                { entry: entry.name },
            );
        }
    }
}

function assertRpgTemporaryInputsSafe(
    dataDir: string,
    arg: RpgExtractOptions,
    externMsgJson: boolean,
): void {
    const root = path.resolve(dataDir);
    const planned = new Map<string, string>();
    const reserve = (fileName: string, source: string): void => {
        const collisionKey = fileName.normalize('NFC').toLowerCase();
        const existingPlan = planned.get(collisionKey);
        if (existingPlan !== undefined) {
            throw new OperationError(
                ErrorCodes.OUTPUT_CONFLICT,
                'RPG 임시 JSON 입력 이름이 서로 충돌합니다',
                { fileName, first: existingPlan, second: source },
            );
        }
        const target = path.join(root, fileName);
        if (fs.existsSync(target)) {
            throw new OperationError(
                ErrorCodes.OUTPUT_CONFLICT,
                'RPG 임시 JSON 변환이 기존 파일을 덮어쓸 수 있습니다',
                { fileName, source },
            );
        }
        planned.set(collisionKey, source);
    };

    if (arg.ext_plugin) reserve('ext_plugins.json', 'plugins.js');
    if (arg.exJson && externMsgJson && fs.existsSync(path.join(root, 'ExternMessage.csv'))) {
        reserve('ExternMsgcsv.json', 'ExternMessage.csv');
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.name.endsWith('.json.yaml')) continue;
        reserve(path.parse(entry.name).name, entry.name);
    }
}

function resolveRpgPluginSource(dataDir: string): string {
    const gameRoot = path.dirname(path.resolve(dataDir));
    const resolution = resolveContainedPathWithoutLinks(gameRoot, path.join('js', 'plugins.js'));
    if (resolution.ok === false) {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            'RPG plugins.js 경로가 게임 루트를 벗어나거나 심볼릭 링크/정션을 통과합니다',
            { dataDir, reason: resolution.reason },
        );
    }
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(resolution.path);
    } catch (error) {
        throw new OperationError(ErrorCodes.PATH_NOT_FOUND, 'plugins.js가 존재하지 않습니다', {
            pluginPath: resolution.path,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new OperationError(
            ErrorCodes.MAPPING_CORRUPT,
            'RPG plugins.js는 링크가 아닌 일반 파일이어야 합니다',
            { pluginPath: resolution.path },
        );
    }
    return resolution.path;
}

type RpgApplyPlan = ReturnType<typeof loadRpgApplyPlan>;

async function applyRpgTextMappings(plan: RpgApplyPlan, arg: RpgApplyOptions): Promise<void> {
    const maxFiles = plan.buckets.length;
    let workedFiles = 0;
    for (const bucket of plan.buckets) {
        throwIfSignalAborted(ctx().signal, 'rpg-apply-file');
        for (const entry of bucket.entries) {
            let output = '';
            let autoline = false;
            let autolineSize = 0;
            const entryConfig = entry.conf;
            if (entryConfig !== undefined) {
                if (entryConfig.isComment === true) continue;
                if (arg.autoline && entryConfig.type == 'event' && entryConfig.code == 401) {
                    autoline = true;
                    autolineSize = entryConfig.face ? 80 : 60;
                }
                if (arg.isComment) continue;
            }
            for (let lineIndex = entry.start; lineIndex < entry.end; lineIndex++) {
                let currentLine = bucket.lines[lineIndex];
                if (autoline && getBinarySize(currentLine) > autolineSize) {
                    const words = currentLine.split(' ');
                    if (words.length > 1) {
                        const splitAt = Math.max(0, Math.floor(words.length / 2) - 1);
                        words[splitAt] = `\n${words[splitAt]}`;
                    }
                    currentLine = words.join(' ');
                }
                output += currentLine;
                if (lineIndex !== entry.end - 1) output += '\n';
            }
            setRpgDataPath(plan.backups.get(entry.originFile), entry.dataPath, output);
        }
        workedFiles += 1;
        ctx().progress.set(workedFiles / maxFiles * 100);
        await sleep(0);
    }
}

function writeRpgPluginOutput(
    plan: RpgApplyPlan,
    arg: RpgApplyOptions,
    completedRoot: string,
    gameRoot: string,
    compactJson: string,
    unchanged: boolean,
): string {
    const pluginScript = `var $plugins = ${compactJson};`;
    if (arg.instantapply) {
        const output = resolveRpgApplyChild(gameRoot, path.join('js', 'plugins.js'), 'RPG plugins 출력');
        fs.writeFileSync(output, pluginScript, 'utf8');
        return output;
    }

    const output = resolveRpgApplyChild(completedRoot, path.join('js', 'plugins.js'), 'RPG plugins 출력');
    const source = resolveRpgApplyChild(gameRoot, path.join('js', 'plugins.js'), 'RPG plugins 원본');
    const canPreserveSource = unchanged
        && path.basename(plan.dataRoot).toLowerCase() === 'data'
        && fs.existsSync(source)
        && fs.lstatSync(source).isFile();
    if (canPreserveSource) fs.copyFileSync(source, output);
    else fs.writeFileSync(output, pluginScript, 'utf8');
    return output;
}

async function writeRpgExternalMessageOutput(
    plan: RpgApplyPlan,
    arg: RpgApplyOptions,
    completedRoot: string,
    data: unknown,
): Promise<string> {
    const outputRoot = arg.instantapply ? plan.dataRoot : path.join(completedRoot, 'data');
    const output = resolveRpgApplyChild(outputRoot, 'ExternMessage.csv', 'RPG 외부 메시지 출력');
    await ExtTool.pack_externMsg(output, data);
    return output;
}

function writeRpgJsonOutput(
    plan: RpgApplyPlan,
    arg: RpgApplyOptions,
    completedRoot: string,
    fileName: string,
    data: unknown,
    compactJson: string,
    unchanged: boolean,
): string {
    const outputRoot = arg.instantapply ? plan.dataRoot : path.join(completedRoot, 'data');
    const jsonOutput = resolveRpgApplyChild(outputRoot, fileName, 'RPG JSON 출력');
    const yamlOutput = resolveRpgApplyChild(outputRoot, `${fileName}.yaml`, 'RPG YAML 출력');
    const output = arg.useYaml ? yamlOutput : jsonOutput;
    if (!arg.instantapply && !arg.useYaml && unchanged) {
        const backupSource = resolveRpgApplyChild(plan.backupRoot, fileName, 'RPG Backup 원본');
        fs.copyFileSync(backupSource, output);
    } else {
        const serialized = arg.useYaml
            ? yaml.dump(data)
            : (ctx().rpg.settings.JsonChangeLine ? JSON.stringify(data, null, 4) : compactJson);
        fs.writeFileSync(output, serialized, 'utf8');
    }
    if (arg.useYaml && fs.existsSync(jsonOutput)) fs.rmSync(jsonOutput);
    else if (!arg.useYaml && fs.existsSync(yamlOutput)) fs.rmSync(yamlOutput);
    return output;
}

async function writeRpgApplyOutputs(
    plan: RpgApplyPlan,
    arg: RpgApplyOptions,
    completedRoot: string,
    originalBackupHashes: Map<string, string>,
    report: RpgOperationReport,
): Promise<void> {
    const gameRoot = path.dirname(path.resolve(arg.dir));
    for (const [fileName, data] of plan.backups) {
        throwIfSignalAborted(ctx().signal, 'rpg-apply-write');
        const compactJson = serializeRpgData(data);
        const unchanged = originalBackupHashes.get(fileName) === sha256Text(compactJson);
        let output: string;
        if (fileName == 'ext_plugins.json') {
            output = writeRpgPluginOutput(plan, arg, completedRoot, gameRoot, compactJson, unchanged);
        } else if (fileName == 'ExternMsgcsv.json') {
            output = await writeRpgExternalMessageOutput(plan, arg, completedRoot, data);
        } else {
            output = writeRpgJsonOutput(plan, arg, completedRoot, fileName, data, compactJson, unchanged);
        }
        report.appliedFiles.push(output);
    }
}

export class RpgMakerService {
    constructor(private readonly context: OperationContext) {}

    /** 기존 main.ts의 extractor() 이식. Extract/Backup/.extracteddata를 생성한다. */
    async extract(arg: RpgExtractOptions): Promise<RpgOperationReport> {
        return withOperationContext(this.context, async () => {
        const report: RpgOperationReport = { dir: arg.dir, extractedFiles: [], appliedFiles: [], textBytes: 0, elapsedMs: 0 };
        const performT = performance.now();
        ctx().rpg.gb = {};
        const extended = true;
        const dir = arg.dir;
        if (!fs.existsSync(dir)) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, '지정된 디렉토리가 없습니다', { dir });
        }
        if (path.parse(dir).name !== 'data' && (!arg.force)) {
            throw new OperationError(ErrorCodes.FORMAT_MISMATCH, 'data 폼더가 아닙니다', { dir });
        }
        assertRpgExtractRootSafe(dir);
        assertRpgTemporaryInputsSafe(dir, arg, ctx().rpg.settings.ExternMsgJson);
        const pluginSourcePath = arg.ext_plugin ? resolveRpgPluginSource(dir) : undefined;
        const managedArtifacts = [
            'Extract',
            'Backup',
            '.extracteddata',
            ...(arg.decryptImg ? ['Extract_img'] : []),
            ...(arg.decryptAudio ? ['Extract_audio'] : []),
        ];
        const existingArtifacts = managedArtifacts.filter((name) => fs.existsSync(path.join(dir, name)));
        if (existingArtifacts.length > 0 && !arg.force) {
            // GUI adapter는 이 코드를 받으면 기존 check_force 확인 흐름을 재현한다.
            throw new OperationError(
                ErrorCodes.EXTRACT_EXISTS,
                `기존 RPG 추출 산출물이 존재합니다: ${existingArtifacts.join(', ')}`,
                { dir, artifacts: existingArtifacts },
            );
        }
        const virtualJsonInputs = new Map<string, string>();
        if (arg.ext_plugin) {
            try {
                let pluginSource = fs.readFileSync(pluginSourcePath!, 'utf-8');
                const assignments = pluginSource.split('$plugins =');
                pluginSource = assignments[assignments.length - 1] + '  ';
                const jsonSource = pluginSource.substring(pluginSource.indexOf('['), pluginSource.lastIndexOf(']') + 1);
                virtualJsonInputs.set('ext_plugins.json', JSON.stringify(JSON.parse(jsonSource)));
            } catch (error) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'RPG plugins.js의 $plugins JSON 파싱에 실패했습니다', {
                    pluginSourcePath,
                    cause: error instanceof Error ? error.message : String(error),
                });
            }
        }
        ctx().rpg.externMsg = {};
        ctx().rpg.useExternMsg = false;
        const externMessagePath = path.join(dir, 'ExternMessage.csv');
        if (fs.existsSync(externMessagePath) && arg.exJson) {
            const Emsg = await ExtTool.parse_externMsg(externMessagePath, !ctx().rpg.settings.ExternMsgJson) as { [key: string]: string };
            ctx().rpg.externMsg = Emsg;
            if (ctx().rpg.settings.ExternMsgJson) {
                virtualJsonInputs.set('ExternMsgcsv.json', JSON.stringify(Emsg, null, 4));
            }
            else {
                ctx().rpg.useExternMsg = true;
                ctx().rpg.externMsgKeys = Object.keys(Emsg);
            }
        }
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.name.endsWith('.json.yaml')) continue;
            const yamlPath = resolveRpgApplyChild(dir, entry.name, 'RPG YAML 입력');
            try {
                const jsonName = path.parse(entry.name).name;
                virtualJsonInputs.set(
                    jsonName,
                    JSON.stringify(yaml.load(fs.readFileSync(yamlPath, 'utf-8') as string)),
                );
            } catch (error) {
                throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'RPG YAML 입력 파싱에 실패했습니다', {
                    yamlPath,
                    cause: error instanceof Error ? error.message : String(error),
                });
            }
        }

        const fileList = [
            ...fs.readdirSync(dir, { withFileTypes: true })
                .filter((entry) => entry.isFile() && path.extname(entry.name) === '.json')
                .map((entry) => entry.name),
            ...virtualJsonInputs.keys(),
        ].sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')));
        if (fileList.length === 0) {
            throw new OperationError(ErrorCodes.FORMAT_MISMATCH, '추출할 RPG JSON 파일이 없습니다', { dir });
        }

        const stagingRoot = makeStagingDir(dir, '.tsukuru-rpg-extract');
        const stagingExtract = path.join(stagingRoot, 'Extract');
        const stagingBackup = path.join(stagingRoot, 'Backup');
        fs.mkdirSync(stagingExtract);
        fs.mkdirSync(stagingBackup);
        const onebyone = dataBaseO.onebyone;

        const maxFiles = fileList.length;
        let workedFiles = 0;
        let jT = 0;
        let manifestEntries = 0;
        try {
        ExtTool.init_extract(arg);
        for (const fileName of fileList) {
            throwIfSignalAborted(ctx().signal, 'rpg-extract-file');
            workedFiles += 1;
            const conf = {
                extended: extended,
                fileName: fileName,
                dir: dir,
                srce: arg.ext_src,
                autoline: arg.autoline,
                note: arg.ext_note,
                arg: arg,
            };
            const virtualSource = virtualJsonInputs.get(fileName);
            const sourcePath = virtualSource === undefined
                ? resolveRpgApplyChild(dir, fileName, 'RPG JSON 입력')
                : undefined;
            const backupPath = resolveRpgApplyChild(stagingBackup, fileName, 'RPG Backup 출력');
            if (virtualSource === undefined) fs.copyFileSync(sourcePath!, backupPath);
            else fs.writeFileSync(backupPath, virtualSource, 'utf8');

            let extractorType: string | undefined;
            if (checkIsMapFile(fileName)) {
                extractorType = 'map';
            }
            else if (Object.keys(onebyone).includes(fileName)) {
                extractorType = onebyone[fileName];
            }
            else if (arg.exJson && !dataBaseO.ignores.includes(fileName)) {
                extractorType = 'ex';
            }
            if (extractorType !== undefined) {
                const file = virtualSource ?? fs.readFileSync(sourcePath!, 'utf8');
                jT += file.length;
                await ExtTool.format_extracted(await ExtTool.extract(file, conf, extractorType));
            }
            ctx().progress.set(workedFiles / maxFiles * 100);
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
                const outputName = `${path.parse(fileName).name}.js`;
                fs.writeFileSync(
                    resolveRpgApplyChild(stagingExtract, outputName, 'RPG Extract 출력'),
                    ctx().rpg.gb[fileName].outputText,
                    'utf-8',
                );
                report.extractedFiles.push(`Extract/${path.parse(fileName).name}.js`);
                delete ctx().rpg.gb[fileName].outputText;
            }
            else {
                const outputName = `${path.parse(fileName).name}.txt`;
                fs.writeFileSync(
                    resolveRpgApplyChild(stagingExtract, outputName, 'RPG Extract 출력'),
                    ctx().rpg.gb[fileName].outputText,
                    'utf-8',
                );
                report.extractedFiles.push(`Extract/${path.parse(fileName).name}.txt`);
                delete ctx().rpg.gb[fileName].outputText;
            }
        }
        const ext_data = {
            main: ctx().rpg.gb,
        };
        edTool.write(stagingRoot, ext_data);
        // Extract/manifest.json 생성(계획서 §Manifest와 안전성)
        const manifest = buildRpgManifest(ctx().rpg.gb);
        atomicWriteFileSync(path.join(stagingExtract, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
        manifestEntries = manifest.entries.length;
        if (arg.decryptImg) {
            await ExtTool.DecryptDir(dir, 'img', path.join(stagingRoot, 'Extract_img'));
        }
        if (arg.decryptAudio) {
            await ExtTool.DecryptDir(dir, 'audio', path.join(stagingRoot, 'Extract_audio'));
        }
        replaceArtifactGroupSync(stagingRoot, dir, managedArtifacts);
        } finally {
            if (fs.existsSync(stagingRoot)) {
                const cleanupError = removePathBestEffortSync(stagingRoot, { recursive: true, force: true });
                if (cleanupError) ctx().logger.warn(`RPG extract staging cleanup failed: ${cleanupError.message}`);
            }
        }
        report.manifestPath = path.join(dir, 'Extract', MANIFEST_FILE);
        report.manifestEntries = manifestEntries;
        report.elapsedMs = performance.now() - performT;
        return report;
        });
    }

    /** 기존 apply.ts의 apply() 이식. .extracteddata + Extract 텍스트를 원본 구조에 적용한다. */
    async apply(arg: RpgApplyOptions): Promise<RpgOperationReport> {
        return withOperationContext(this.context, async () => {
        const report: RpgOperationReport = { dir: arg.dir, extractedFiles: [], appliedFiles: [], textBytes: 0, elapsedMs: 0 };
        const performT = performance.now();
        const dir = arg.dir;
        if (!fs.existsSync(path.join(dir, 'Extract'))) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, 'Extract 폼더가 존재하지 않습니다', { dir });
        }
        if (!edTool.exists(dir)) {
            throw new OperationError(ErrorCodes.PATH_NOT_FOUND, '.extracteddata 파일이 존재하지 않습니다', { dir });
        }
        // 모든 매핑·경로·Backup·manifest 검사는 출력 transaction을 만들기 전에 끝낸다.
        const plan = loadRpgApplyPlan(dir);
        const originalBackupHashes = new Map(
            Array.from(plan.backups, ([fileName, data]) => [fileName, sha256Text(serializeRpgData(data))]),
        );
        const completedFinal = path.resolve(arg.outputDir ?? path.join(dir, 'Completed'));
        if (!arg.instantapply) assertRpgApplyOutputSafe(dir, completedFinal);
        await applyRpgTextMappings(plan, arg);

        // instantapply(legacy)만 원본 위치에 직접 쓰고, 나머지는 공통 transaction으로 전환한다.
        const transaction = arg.instantapply
            ? null
            : new WorkspaceTransaction({ outputPath: completedFinal, force: arg.force ?? true, signal: ctx().signal });
        const completedRoot = transaction?.stagingPath ?? completedFinal;
        try {
        if (!arg.instantapply) {
            fs.mkdirSync(path.join(completedRoot, 'data'));
            fs.mkdirSync(path.join(completedRoot, 'js'));
        }
        await writeRpgApplyOutputs(plan, arg, completedRoot, originalBackupHashes, report);

        await ExtTool.EncryptDir(dir, 'img', arg.instantapply ?? false, completedRoot);
        await ExtTool.EncryptDir(dir, 'audio', arg.instantapply ?? false, completedRoot);
        throwIfSignalAborted(ctx().signal, 'rpg-apply-commit');
        transaction?.commit();
        if (transaction) {
            report.appliedFiles = report.appliedFiles.map((file) => (
                path.join(completedFinal, path.relative(completedRoot, file))
            ));
        }
        report.elapsedMs = performance.now() - performT;
        return report;
        } finally {
            transaction?.dispose();
        }
        });
    }
}
