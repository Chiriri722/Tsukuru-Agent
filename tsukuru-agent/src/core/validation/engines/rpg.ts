import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { finalizeValidationReport } from '../reportPolicy';
import { StructuralIssue, StructuralValidationReport } from '../types';
import { resolveContainedPathWithoutLinks } from '../../pathSafety';

function containedPath(root: string, relativePath: unknown): string | null {
    const resolution = resolveContainedPathWithoutLinks(root, relativePath);
    return resolution.ok ? resolution.path : null;
}

function valueAtDataPath(value: unknown, dataPath: unknown): unknown {
    if (typeof dataPath !== 'string' || dataPath === '') return undefined;
    let current = value;
    for (const segment of dataPath.split('.')) {
        if ((typeof current !== 'object' && !Array.isArray(current)) || current === null
            || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

const RPG_ARRAY_ROOTS = new Set([
    'Actors.json', 'Animations.json', 'Armors.json', 'Classes.json', 'CommonEvents.json',
    'Enemies.json', 'Items.json', 'MapInfos.json', 'Skills.json', 'States.json',
    'Tilesets.json', 'Troops.json', 'Weapons.json',
]);

interface RpgJsonWorkspace {
    backupRoot: string;
    backupIsDirectory: boolean;
    jsonRoot: string;
    jsonFiles: string[];
}

interface RpgParsedWorkspace {
    parsed: Map<string, unknown>;
    encodingCounts: { utf8: number; shiftJis: number; unknown: number };
}

function discoverRpgJsonWorkspace(root: string, issues: StructuralIssue[]): RpgJsonWorkspace {
    const rootEntries = fs.readdirSync(root, { withFileTypes: true });
    const rootJsonFiles = rootEntries
        .filter((entry) => entry.isFile() && !entry.name.startsWith('._') && entry.name.toLowerCase().endsWith('.json'))
        .map((entry) => entry.name)
        .sort();
    const backupRoot = path.join(root, 'Backup');
    const backupResolution = resolveContainedPathWithoutLinks(root, 'Backup');
    const backupIsDirectory = backupResolution.ok
        && fs.existsSync(backupResolution.path)
        && fs.lstatSync(backupResolution.path).isDirectory();
    for (const entry of rootEntries) {
        if (!entry.isSymbolicLink() || (entry.name !== 'Backup' && !entry.name.toLowerCase().endsWith('.json'))) continue;
        issues.push({
            code: 'RPG_LINKED_PATH', severity: 'critical', file: entry.name,
            message: 'RPG 데이터/Backup JSON 경로에 심볼릭 링크/정션을 사용할 수 없습니다',
        });
    }
    const backupEntries = backupIsDirectory
        ? fs.readdirSync(backupRoot, { withFileTypes: true })
        : [];
    for (const entry of backupEntries) {
        if (!entry.isSymbolicLink() || !entry.name.toLowerCase().endsWith('.json')) continue;
        issues.push({
            code: 'RPG_LINKED_PATH', severity: 'critical', file: `Backup/${entry.name}`,
            message: 'RPG Backup JSON 경로에 심볼릭 링크/정션을 사용할 수 없습니다',
        });
    }
    const jsonRoot = rootJsonFiles.length === 0 && backupIsDirectory ? backupRoot : root;
    const jsonFiles = jsonRoot === root
        ? rootJsonFiles
        : backupEntries
            .filter((entry) => entry.isFile() && !entry.name.startsWith('._') && entry.name.toLowerCase().endsWith('.json'))
            .map((entry) => entry.name)
            .sort();
    return { backupRoot, backupIsDirectory, jsonRoot, jsonFiles };
}

function parseRpgJsonWorkspace(
    jsonRoot: string,
    jsonFiles: string[],
    issues: StructuralIssue[],
): RpgParsedWorkspace {
    const encodingCounts = { utf8: 0, shiftJis: 0, unknown: 0 };
    const parsed = new Map<string, unknown>();
    for (const file of jsonFiles) {
        const filePath = path.join(jsonRoot, file);
        try {
            const bytes = fs.readFileSync(filePath);
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
            encodingCounts.utf8++;
            const value = JSON.parse(text);
            parsed.set(file, value);
            const shouldBeArray = RPG_ARRAY_ROOTS.has(file);
            const shouldBeObject = /^Map\d{3}\.json$/i.test(file) || file === 'System.json';
            if ((shouldBeArray && !Array.isArray(value))
                || (shouldBeObject && (typeof value !== 'object' || value === null || Array.isArray(value)))) {
                issues.push({
                    code: 'RPG_ROOT_TYPE_MISMATCH', severity: 'error', file,
                    message: `RPG JSON 루트 타입이 엔진 규칙과 다릅니다: ${shouldBeArray ? 'array' : 'object'} 필요`,
                });
            }
            if (Array.isArray(value) && shouldBeArray) {
                for (let index = 1; index < value.length; index++) {
                    const item = value[index];
                    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'number'
                        && (item as Record<string, unknown>).id !== index) {
                        issues.push({
                            code: 'RPG_ID_INDEX_MISMATCH', severity: 'error', file, entryId: String(index),
                            message: `RPG 데이터 id가 배열 index와 다릅니다: ${String((item as Record<string, unknown>).id)} != ${index}`,
                        });
                    }
                }
            }
        } catch {
            encodingCounts.unknown++;
            issues.push({
                code: 'RPG_JSON_PARSE_ERROR', severity: 'critical', file,
                message: 'RPG JSON 파일을 UTF-8 JSON으로 읽거나 파싱할 수 없습니다',
            });
        }
    }
    return { parsed, encodingCounts };
}

type ManifestFailure = (code: string, message: string, file: string | null) => void;

function inspectManifestExtractMapping(
    root: string,
    entry: Record<string, unknown>,
    extractLines: Map<string, string[]>,
    fail: ManifestFailure,
): void {
    const extractTarget = containedPath(path.join(root, 'Extract'), entry.extractFile);
    if (!extractTarget || !fs.existsSync(extractTarget)) {
        fail(
            'RPG_EXTRACT_FILE_MISSING',
            'RPG 추출 텍스트 파일이 없거나 Extract 밖을 가리킵니다',
            typeof entry.extractFile === 'string' ? entry.extractFile : null,
        );
        return;
    }
    if (!extractLines.has(extractTarget)) {
        extractLines.set(extractTarget, fs.readFileSync(extractTarget, 'utf8').split('\n'));
    }
    const lines = extractLines.get(extractTarget)!;
    const start = entry.lineStart;
    const end = entry.lineEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end)
        || Number(start) < 0 || Number(start) >= Number(end) || Number(end) > lines.length) {
        fail(
            'RPG_LINE_MAPPING_INVALID',
            `RPG 추출 줄 범위가 올바르지 않습니다: ${String(start)}..${String(end)} / ${lines.length}`,
            String(entry.extractFile),
        );
        return;
    }
    const text = lines.slice(Number(start), Number(end)).join('\n');
    const actualHash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    if (typeof entry.hash !== 'string' || entry.hash.toLowerCase() !== actualHash) {
        fail('RPG_EXTRACT_HASH_MISMATCH', 'RPG 추출 텍스트 해시가 manifest와 다릅니다', String(entry.extractFile));
    }
}

function inspectManifestSourceMapping(
    root: string,
    entry: Record<string, unknown>,
    sourceJson: Map<string, unknown>,
    fail: ManifestFailure,
): void {
    const sourceTarget = containedPath(root, entry.sourceFile);
    if (!sourceTarget || !fs.existsSync(sourceTarget)) {
        fail(
            'RPG_SOURCE_FILE_MISSING',
            'RPG manifest 원본 JSON이 없거나 data 폴더 밖을 가리킵니다',
            typeof entry.sourceFile === 'string' ? entry.sourceFile : null,
        );
        return;
    }
    const relative = path.relative(root, sourceTarget).replace(/\\/g, '/');
    try {
        if (!sourceJson.has(sourceTarget)) {
            sourceJson.set(sourceTarget, JSON.parse(fs.readFileSync(sourceTarget, 'utf8').replace(/^\uFEFF/, '')));
        }
        const mv = entry.mv && typeof entry.mv === 'object' ? entry.mv as Record<string, unknown> : {};
        const conf = mv.conf && typeof mv.conf === 'object' ? mv.conf as Record<string, unknown> : {};
        if (conf.isComment !== true && typeof valueAtDataPath(sourceJson.get(sourceTarget), entry.dataPath) !== 'string') {
            fail('RPG_DATA_PATH_INVALID', 'RPG manifest dataPath가 원본 문자열을 가리키지 않습니다', relative);
        }
    } catch (error) {
        fail('RPG_SOURCE_JSON_PARSE_ERROR', `RPG manifest 원본 JSON 파싱에 실패했습니다: ${String(error)}`, relative);
    }
}

function manifestEntries(manifest: unknown): unknown[] {
    return manifest && typeof manifest === 'object' && Array.isArray((manifest as { entries?: unknown }).entries)
        ? (manifest as { entries: unknown[] }).entries
        : [];
}

function inspectRpgManifestEntries(root: string, entries: unknown[], issues: StructuralIssue[]): number {
    const invalidEntryIndexes = new Set<number>();
    const seenIds = new Set<string>();
    const extractLines = new Map<string, string[]>();
    const sourceJson = new Map<string, unknown>();
    for (let index = 0; index < entries.length; index++) {
        const raw = entries[index];
        const entry = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const entryId = typeof entry.id === 'string' ? entry.id : `(entry-${index})`;
        const fail: ManifestFailure = (code, message, file) => {
            invalidEntryIndexes.add(index);
            issues.push({ code, severity: 'critical', file, entryId, message });
        };
        if (seenIds.has(entryId)) fail('RPG_MANIFEST_DUPLICATE_ID', 'RPG manifest에 중복 id가 있습니다', null);
        seenIds.add(entryId);
        inspectManifestExtractMapping(root, entry, extractLines, fail);
        inspectManifestSourceMapping(root, entry, sourceJson, fail);
    }
    return invalidEntryIndexes.size;
}

function numericIdSet(parsed: Map<string, unknown>, file: string): Set<number> {
    const value = parsed.get(file);
    return new Set(Array.isArray(value)
        ? value.flatMap((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'number'
            ? [(item as Record<string, unknown>).id as number] : [])
        : []);
}

function forEachRpgRecord(
    parsed: Map<string, unknown>,
    file: string,
    visit: (record: Record<string, unknown>, index: number) => void,
): void {
    const value = parsed.get(file);
    if (!Array.isArray(value)) return;
    for (let index = 1; index < value.length; index++) {
        const record = value[index];
        if (record && typeof record === 'object') visit(record as Record<string, unknown>, index);
    }
}

function pushReferenceIssue(issues: StructuralIssue[], file: string, entryId: string, target: string): void {
    issues.push({
        code: 'RPG_REFERENCE_MISSING', severity: 'error', file, entryId,
        message: `RPG 참조 대상이 없습니다: ${target}`,
    });
}

function inspectRpgMapCommandReferences(
    parsed: Map<string, unknown>,
    commonEvents: Set<number>,
    maps: Set<number>,
    issues: StructuralIssue[],
): void {
    for (const [file, value] of parsed) {
        if (!/^Map\d{3}\.json$/i.test(file) || !value || typeof value !== 'object') continue;
        const events = (value as Record<string, unknown>).events;
        if (!Array.isArray(events)) continue;
        for (let eventIndex = 1; eventIndex < events.length; eventIndex++) {
            const event = events[eventIndex] as Record<string, unknown> | null;
            if (!event || !Array.isArray(event.pages)) continue;
            for (let pageIndex = 0; pageIndex < event.pages.length; pageIndex++) {
                const page = event.pages[pageIndex] as Record<string, unknown> | null;
                if (!page || !Array.isArray(page.list)) continue;
                for (let commandIndex = 0; commandIndex < page.list.length; commandIndex++) {
                    const command = page.list[commandIndex] as Record<string, unknown> | null;
                    if (!command || !Array.isArray(command.parameters)) continue;
                    const entryId = `${eventIndex}.pages.${pageIndex}.list.${commandIndex}`;
                    const parameters = command.parameters;
                    if (command.code === 117 && typeof parameters[0] === 'number' && !commonEvents.has(parameters[0])) {
                        pushReferenceIssue(issues, file, entryId, `CommonEvents.json#${parameters[0]}`);
                    } else if (command.code === 201 && parameters[0] === 0
                        && typeof parameters[1] === 'number' && !maps.has(parameters[1])) {
                        pushReferenceIssue(issues, file, entryId, `MapInfos.json#${parameters[1]}`);
                    }
                }
            }
        }
    }
}

function inspectRpgReferences(parsed: Map<string, unknown>, issues: StructuralIssue[]): void {
    const classes = numericIdSet(parsed, 'Classes.json');
    const skills = numericIdSet(parsed, 'Skills.json');
    const enemies = numericIdSet(parsed, 'Enemies.json');
    const commonEvents = numericIdSet(parsed, 'CommonEvents.json');
    const maps = numericIdSet(parsed, 'MapInfos.json');
    forEachRpgRecord(parsed, 'Actors.json', (actor, index) => {
        if (typeof actor.classId === 'number' && actor.classId > 0 && !classes.has(actor.classId)) {
            pushReferenceIssue(issues, 'Actors.json', `${index}.classId`, `Classes.json#${actor.classId}`);
        }
    });
    forEachRpgRecord(parsed, 'Classes.json', (klass, index) => {
        if (!Array.isArray(klass.learnings)) return;
        for (let learningIndex = 0; learningIndex < klass.learnings.length; learningIndex++) {
            const learning = klass.learnings[learningIndex] as Record<string, unknown> | null;
            if (learning && typeof learning.skillId === 'number' && learning.skillId > 0 && !skills.has(learning.skillId)) {
                pushReferenceIssue(issues, 'Classes.json', `${index}.learnings.${learningIndex}.skillId`, `Skills.json#${learning.skillId}`);
            }
        }
    });
    forEachRpgRecord(parsed, 'Enemies.json', (enemy, index) => {
        if (!Array.isArray(enemy.actions)) return;
        for (let actionIndex = 0; actionIndex < enemy.actions.length; actionIndex++) {
            const action = enemy.actions[actionIndex] as Record<string, unknown> | null;
            if (action && typeof action.skillId === 'number' && action.skillId > 0 && !skills.has(action.skillId)) {
                pushReferenceIssue(issues, 'Enemies.json', `${index}.actions.${actionIndex}.skillId`, `Skills.json#${action.skillId}`);
            }
        }
    });
    forEachRpgRecord(parsed, 'Troops.json', (troop, index) => {
        if (!Array.isArray(troop.members)) return;
        for (let memberIndex = 0; memberIndex < troop.members.length; memberIndex++) {
            const member = troop.members[memberIndex] as Record<string, unknown> | null;
            if (member && typeof member.enemyId === 'number' && member.enemyId > 0 && !enemies.has(member.enemyId)) {
                pushReferenceIssue(issues, 'Troops.json', `${index}.members.${memberIndex}.enemyId`, `Enemies.json#${member.enemyId}`);
            }
        }
    });
    forEachRpgRecord(parsed, 'MapInfos.json', (mapInfo, index) => {
        const mapId = typeof mapInfo.id === 'number' ? mapInfo.id : index;
        const mapFile = `Map${String(mapId).padStart(3, '0')}.json`;
        if (!parsed.has(mapFile)) {
            issues.push({
                code: 'RPG_MAP_FILE_MISSING', severity: 'error', file: 'MapInfos.json', entryId: String(mapId),
                message: `MapInfos 항목의 맵 파일이 없습니다: ${mapFile}`,
            });
        }
    });
    inspectRpgMapCommandReferences(parsed, commonEvents, maps, issues);
    const system = parsed.get('System.json');
    if (system && typeof system === 'object' && typeof (system as Record<string, unknown>).startMapId === 'number') {
        const startMapId = (system as Record<string, unknown>).startMapId as number;
        if (startMapId > 0 && !maps.has(startMapId)) {
            pushReferenceIssue(issues, 'System.json', 'startMapId', `MapInfos.json#${startMapId}`);
        }
    }
}

const RPG_REFERENCE_CODES = new Set(['RPG_REFERENCE_MISSING', 'RPG_MAP_FILE_MISSING']);

function referenceIssueKey(issue: StructuralIssue): string {
    return JSON.stringify([issue.code, issue.file, issue.entryId ?? '', issue.message]);
}

function applyBackupReferenceBaseline(
    jsonRoot: string,
    backupRoot: string,
    backupIsDirectory: boolean,
    issues: StructuralIssue[],
): void {
    const currentReferenceIssues = issues.filter((issue) => RPG_REFERENCE_CODES.has(issue.code));
    const baselineKeys = new Set<string>();
    if (path.resolve(jsonRoot) === path.resolve(backupRoot)) {
        for (const issue of currentReferenceIssues) baselineKeys.add(referenceIssueKey(issue));
    } else if (backupIsDirectory) {
        const baselineReport = inspectRpgProject(backupRoot, { entries: [] }, false);
        for (const issue of baselineReport.issues) {
            if (RPG_REFERENCE_CODES.has(issue.code)) baselineKeys.add(referenceIssueKey(issue));
        }
    }
    for (const issue of currentReferenceIssues) {
        if (!baselineKeys.has(referenceIssueKey(issue))) continue;
        issue.code = `${issue.code}_BASELINE`;
        issue.severity = 'warning';
        issue.message = `원본 Backup 기준선에도 존재하는 손상입니다: ${issue.message}`;
    }
}

export function inspectRpgProject(
    dataRoot: string,
    manifest: unknown,
    compareBackupBaseline = true,
): StructuralValidationReport {
    const root = path.resolve(dataRoot);
    const issues: StructuralIssue[] = [];
    const { backupRoot, backupIsDirectory, jsonRoot, jsonFiles } = discoverRpgJsonWorkspace(root, issues);
    const { parsed, encodingCounts } = parseRpgJsonWorkspace(jsonRoot, jsonFiles, issues);
    const entries = manifestEntries(manifest);
    const invalidEntries = inspectRpgManifestEntries(root, entries, issues);

    inspectRpgReferences(parsed, issues);
    if (compareBackupBaseline) {
        applyBackupReferenceBaseline(jsonRoot, backupRoot, backupIsDirectory, issues);
    }
    const blockingIssues = issues.filter((issue) => issue.severity !== 'warning');
    return finalizeValidationReport({
        profile: 'rpgmv',
        ok: blockingIssues.length === 0,
        filesChecked: jsonFiles.length,
        entriesChecked: entries.length,
        validEntries: entries.length - invalidEntries,
        invalidEntries,
        encodingCounts,
        encodingWarnings: 0,
        tokenErrors: blockingIssues.length,
        issues,
    });
}
