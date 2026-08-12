import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import iconv from 'iconv-lite';

export interface ScoreInput {
    extractionCoverage: number;
    mappingIntegrity: number;
    reinsertionValidity: number;
    protectedScriptIntegrity: number;
    containerIntegrity: number;
    critical?: string[];
}

export interface ScoreResult {
    total: number;
    extractionCoverage: number;
    mappingIntegrity: number;
    reinsertionValidity: number;
    protectedScriptIntegrity: number;
    containerIntegrity: number;
    risk: 'low' | 'medium' | 'high' | 'critical';
    ok: boolean;
    issues: string[];
    components: {
        extractionCoverage: number;
        mappingIntegrity: number;
        reinsertionValidity: number;
        protectedScriptIntegrity: number;
        containerIntegrity: number;
    };
}

export interface FileMapEntry {
    path: string;
    size: number;
    hash: string;
    protected?: boolean;
}

export interface FileDiff {
    filesChanged: number;
    bytesChanged: number;
    protectedFilesChanged: number;
    protectedBytesChanged: number;
    addedFiles: number;
    removedFiles: number;
    protectedScriptDamage: number;
    textBytesChanged: number;
}

export type StructuralIssueSeverity = 'critical' | 'error' | 'warning';

export interface StructuralIssue {
    code: string;
    severity: StructuralIssueSeverity;
    file: string | null;
    entryId?: string;
    line?: number;
    column?: number;
    message: string;
}

export interface StructuralValidationReport {
    profile: 'rpgmv' | 'wolf' | 'tyrano' | 'gdevelop';
    ok: boolean;
    filesChecked: number;
    entriesChecked: number;
    validEntries: number;
    invalidEntries: number;
    encodingCounts: {
        utf8: number;
        shiftJis: number;
        unknown: number;
    };
    encodingWarnings: number;
    tokenErrors: number;
    issues: StructuralIssue[];
}

function containedPath(root: string, relativePath: unknown): string | null {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) return null;
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    return relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) ? target : null;
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

export function inspectRpgProject(dataRoot: string, manifest: unknown): StructuralValidationReport {
    const root = path.resolve(dataRoot);
    const issues: StructuralIssue[] = [];
    const encodingCounts = { utf8: 0, shiftJis: 0, unknown: 0 };
    const parsed = new Map<string, unknown>();
    const rootJsonFiles = fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map((entry) => entry.name)
        .sort();
    const backupRoot = path.join(root, 'Backup');
    const jsonRoot = rootJsonFiles.length === 0 && fs.existsSync(backupRoot) && fs.statSync(backupRoot).isDirectory()
        ? backupRoot
        : root;
    const jsonFiles = jsonRoot === root
        ? rootJsonFiles
        : fs.readdirSync(jsonRoot, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
            .map((entry) => entry.name)
            .sort();
    const arrayRoots = new Set([
        'Actors.json', 'Animations.json', 'Armors.json', 'Classes.json', 'CommonEvents.json',
        'Enemies.json', 'Items.json', 'MapInfos.json', 'Skills.json', 'States.json',
        'Tilesets.json', 'Troops.json', 'Weapons.json',
    ]);

    for (const file of jsonFiles) {
        const filePath = path.join(jsonRoot, file);
        try {
            const bytes = fs.readFileSync(filePath);
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
            encodingCounts.utf8++;
            const value = JSON.parse(text);
            parsed.set(file, value);
            const shouldBeArray = arrayRoots.has(file);
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
        } catch (error) {
            encodingCounts.unknown++;
            issues.push({
                code: 'RPG_JSON_PARSE_ERROR', severity: 'critical', file,
                message: `RPG JSON 파싱에 실패했습니다: ${String(error)}`,
            });
        }
    }

    const entries = manifest && typeof manifest === 'object' && Array.isArray((manifest as { entries?: unknown }).entries)
        ? (manifest as { entries: unknown[] }).entries
        : [];
    const invalidEntryIndexes = new Set<number>();
    const seenIds = new Set<string>();
    const extractLines = new Map<string, string[]>();
    const sourceJson = new Map<string, unknown>();
    for (let index = 0; index < entries.length; index++) {
        const raw = entries[index];
        const entry = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const entryId = typeof entry.id === 'string' ? entry.id : `(entry-${index})`;
        const fail = (code: string, message: string, file: string | null): void => {
            invalidEntryIndexes.add(index);
            issues.push({ code, severity: 'critical', file, entryId, message });
        };
        if (seenIds.has(entryId)) fail('RPG_MANIFEST_DUPLICATE_ID', 'RPG manifest에 중복 id가 있습니다', null);
        seenIds.add(entryId);
        const extractTarget = containedPath(path.join(root, 'Extract'), entry.extractFile);
        if (!extractTarget || !fs.existsSync(extractTarget)) {
            fail('RPG_EXTRACT_FILE_MISSING', 'RPG 추출 텍스트 파일이 없거나 Extract 밖을 가리킵니다', typeof entry.extractFile === 'string' ? entry.extractFile : null);
        } else {
            if (!extractLines.has(extractTarget)) extractLines.set(extractTarget, fs.readFileSync(extractTarget, 'utf8').split('\n'));
            const lines = extractLines.get(extractTarget)!;
            const start = entry.lineStart;
            const end = entry.lineEnd;
            if (!Number.isInteger(start) || !Number.isInteger(end) || Number(start) < 0 || Number(start) >= Number(end) || Number(end) > lines.length) {
                fail('RPG_LINE_MAPPING_INVALID', `RPG 추출 줄 범위가 올바르지 않습니다: ${String(start)}..${String(end)} / ${lines.length}`, String(entry.extractFile));
            } else {
                const text = lines.slice(Number(start), Number(end)).join('\n');
                const actualHash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
                if (typeof entry.hash !== 'string' || entry.hash.toLowerCase() !== actualHash) {
                    fail('RPG_EXTRACT_HASH_MISMATCH', 'RPG 추출 텍스트 해시가 manifest와 다릅니다', String(entry.extractFile));
                }
            }
        }
        const sourceTarget = containedPath(root, entry.sourceFile);
        if (!sourceTarget || !fs.existsSync(sourceTarget)) {
            fail('RPG_SOURCE_FILE_MISSING', 'RPG manifest 원본 JSON이 없거나 data 폴더 밖을 가리킵니다', typeof entry.sourceFile === 'string' ? entry.sourceFile : null);
        } else {
            try {
                if (!sourceJson.has(sourceTarget)) sourceJson.set(sourceTarget, JSON.parse(fs.readFileSync(sourceTarget, 'utf8').replace(/^\uFEFF/, '')));
                const mv = entry.mv && typeof entry.mv === 'object' ? entry.mv as Record<string, unknown> : {};
                const conf = mv.conf && typeof mv.conf === 'object' ? mv.conf as Record<string, unknown> : {};
                if (conf.isComment !== true && typeof valueAtDataPath(sourceJson.get(sourceTarget), entry.dataPath) !== 'string') {
                    fail('RPG_DATA_PATH_INVALID', 'RPG manifest dataPath가 원본 문자열을 가리키지 않습니다', path.relative(root, sourceTarget).replace(/\\/g, '/'));
                }
            } catch (error) {
                fail('RPG_SOURCE_JSON_PARSE_ERROR', `RPG manifest 원본 JSON 파싱에 실패했습니다: ${String(error)}`, path.relative(root, sourceTarget).replace(/\\/g, '/'));
            }
        }
    }

    const idSet = (file: string): Set<number> => {
        const value = parsed.get(file);
        return new Set(Array.isArray(value)
            ? value.flatMap((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'number'
                ? [(item as Record<string, unknown>).id as number] : [])
            : []);
    };
    const classes = idSet('Classes.json');
    const skills = idSet('Skills.json');
    const enemies = idSet('Enemies.json');
    const commonEvents = idSet('CommonEvents.json');
    const maps = idSet('MapInfos.json');
    const addReferenceIssue = (file: string, entryId: string, target: string): void => {
        issues.push({ code: 'RPG_REFERENCE_MISSING', severity: 'error', file, entryId, message: `RPG 참조 대상이 없습니다: ${target}` });
    };
    const eachRecord = (file: string, fn: (record: Record<string, unknown>, index: number) => void): void => {
        const value = parsed.get(file);
        if (!Array.isArray(value)) return;
        for (let index = 1; index < value.length; index++) {
            const record = value[index];
            if (record && typeof record === 'object') fn(record as Record<string, unknown>, index);
        }
    };
    eachRecord('Actors.json', (actor, index) => {
        if (typeof actor.classId === 'number' && actor.classId > 0 && !classes.has(actor.classId)) addReferenceIssue('Actors.json', `${index}.classId`, `Classes.json#${actor.classId}`);
    });
    eachRecord('Classes.json', (klass, index) => {
        if (!Array.isArray(klass.learnings)) return;
        for (let learningIndex = 0; learningIndex < klass.learnings.length; learningIndex++) {
            const learning = klass.learnings[learningIndex] as Record<string, unknown> | null;
            if (learning && typeof learning.skillId === 'number' && learning.skillId > 0 && !skills.has(learning.skillId)) {
                addReferenceIssue('Classes.json', `${index}.learnings.${learningIndex}.skillId`, `Skills.json#${learning.skillId}`);
            }
        }
    });
    eachRecord('Enemies.json', (enemy, index) => {
        if (!Array.isArray(enemy.actions)) return;
        for (let actionIndex = 0; actionIndex < enemy.actions.length; actionIndex++) {
            const action = enemy.actions[actionIndex] as Record<string, unknown> | null;
            if (action && typeof action.skillId === 'number' && action.skillId > 0 && !skills.has(action.skillId)) {
                addReferenceIssue('Enemies.json', `${index}.actions.${actionIndex}.skillId`, `Skills.json#${action.skillId}`);
            }
        }
    });
    eachRecord('Troops.json', (troop, index) => {
        if (!Array.isArray(troop.members)) return;
        for (let memberIndex = 0; memberIndex < troop.members.length; memberIndex++) {
            const member = troop.members[memberIndex] as Record<string, unknown> | null;
            if (member && typeof member.enemyId === 'number' && member.enemyId > 0 && !enemies.has(member.enemyId)) {
                addReferenceIssue('Troops.json', `${index}.members.${memberIndex}.enemyId`, `Enemies.json#${member.enemyId}`);
            }
        }
    });
    eachRecord('MapInfos.json', (mapInfo, index) => {
        const mapId = typeof mapInfo.id === 'number' ? mapInfo.id : index;
        const mapFile = `Map${String(mapId).padStart(3, '0')}.json`;
        if (!parsed.has(mapFile)) {
            issues.push({ code: 'RPG_MAP_FILE_MISSING', severity: 'error', file: 'MapInfos.json', entryId: String(mapId), message: `MapInfos 항목의 맵 파일이 없습니다: ${mapFile}` });
        }
    });
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
                    const code = command.code;
                    const parameters = command.parameters;
                    if (code === 117 && typeof parameters[0] === 'number' && !commonEvents.has(parameters[0])) {
                        addReferenceIssue(file, `${eventIndex}.pages.${pageIndex}.list.${commandIndex}`, `CommonEvents.json#${parameters[0]}`);
                    } else if (code === 201 && parameters[0] === 0 && typeof parameters[1] === 'number' && !maps.has(parameters[1])) {
                        addReferenceIssue(file, `${eventIndex}.pages.${pageIndex}.list.${commandIndex}`, `MapInfos.json#${parameters[1]}`);
                    }
                }
            }
        }
    }
    const system = parsed.get('System.json');
    if (system && typeof system === 'object' && typeof (system as Record<string, unknown>).startMapId === 'number') {
        const startMapId = (system as Record<string, unknown>).startMapId as number;
        if (startMapId > 0 && !maps.has(startMapId)) addReferenceIssue('System.json', 'startMapId', `MapInfos.json#${startMapId}`);
    }

    const invalidEntries = invalidEntryIndexes.size;
    const blockingIssues = issues.filter((issue) => issue.severity !== 'warning');
    return {
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
    };
}

function decodeTyranoText(bytes: Buffer): { text: string; encoding: 'utf8' | 'shiftJis' | 'unknown' } {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return { text: bytes.subarray(3).toString('utf8'), encoding: 'utf8' };
    }
    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
    } catch {
        const text = iconv.decode(bytes, 'shift_jis');
        if (iconv.encode(text, 'shift_jis').equals(bytes)) {
            return { text, encoding: 'shiftJis' };
        }
        return { text, encoding: 'unknown' };
    }
}

function inspectTjsDelimiters(text: string, file: string): StructuralIssue[] {
    const issues: StructuralIssue[] = [];
    const stack: Array<{ opener: string; closer: string; line: number; column: number }> = [];
    const closers: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    let line = 1;
    let column = 0;
    let quote: "'" | '"' | '`' | null = null;
    let quoteStart: { line: number; column: number } | null = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    let blockCommentStart: { line: number; column: number } | null = null;

    for (let index = 0; index < text.length; index++) {
        const current = text[index];
        const next = text[index + 1];
        column++;
        if (current === '\n') {
            if (quote && quote !== '`') {
                if (escaped) {
                    escaped = false;
                } else if (quoteStart) {
                    issues.push({
                        code: 'TYRANO_TJS_UNTERMINATED_STRING',
                        severity: 'error',
                        file,
                        line: quoteStart.line,
                        column: quoteStart.column,
                        message: `Tyrano TJS ${quote} 문자열이 줄 끝에서 닫히지 않았습니다`,
                    });
                    quote = null;
                    quoteStart = null;
                }
            }
            line++;
            column = 0;
            lineComment = false;
            continue;
        }
        if (lineComment) continue;
        if (blockComment) {
            if (current === '*' && next === '/') {
                blockComment = false;
                blockCommentStart = null;
                index++;
                column++;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (current === '\\') {
                escaped = true;
            } else if (current === quote) {
                quote = null;
                quoteStart = null;
            }
            continue;
        }
        if (current === '/' && next === '/') {
            lineComment = true;
            index++;
            column++;
            continue;
        }
        if (current === '/' && next === '*') {
            blockComment = true;
            blockCommentStart = { line, column };
            index++;
            column++;
            continue;
        }
        if (current === "'" || current === '"' || current === '`') {
            quote = current;
            quoteStart = { line, column };
            continue;
        }
        if (closers[current]) {
            stack.push({ opener: current, closer: closers[current], line, column });
            continue;
        }
        if (current === ')' || current === ']' || current === '}') {
            const opener = stack[stack.length - 1];
            if (opener?.closer === current) {
                stack.pop();
            } else {
                issues.push({
                    code: 'TYRANO_TJS_UNEXPECTED_CLOSER',
                    severity: 'error',
                    file,
                    line,
                    column,
                    message: `Tyrano TJS 닫힘 기호 ${current} 앞에 대응하는 열림 기호가 없습니다`,
                });
            }
        }
    }
    if (blockComment && blockCommentStart) {
        issues.push({
            code: 'TYRANO_TJS_UNTERMINATED_COMMENT',
            severity: 'error',
            file,
            line: blockCommentStart.line,
            column: blockCommentStart.column,
            message: 'Tyrano TJS 블록 주석이 닫히지 않았습니다',
        });
    }
    if (quote && quoteStart) {
        issues.push({
            code: 'TYRANO_TJS_UNTERMINATED_STRING',
            severity: 'error',
            file,
            line: quoteStart.line,
            column: quoteStart.column,
            message: `Tyrano TJS ${quote} 문자열이 파일 끝에서 닫히지 않았습니다`,
        });
    }
    for (const opener of stack) {
        issues.push({
            code: 'TYRANO_TJS_UNCLOSED_DELIMITER',
            severity: 'error',
            file,
            line: opener.line,
            column: opener.column,
            message: `Tyrano TJS ${opener.opener} 기호에 대응하는 ${opener.closer} 기호가 없습니다`,
        });
    }
    return issues;
}

export function inspectWolfBinaryMappings(_dataRoot: string, manifest: unknown): StructuralValidationReport {
    const entries = manifest && typeof manifest === 'object' && Array.isArray((manifest as { entries?: unknown }).entries)
        ? (manifest as { entries: unknown[] }).entries
        : [];
    const root = path.resolve(_dataRoot);
    const issues: StructuralIssue[] = [];
    const files = new Set<string>();
    const encodingCounts = { utf8: 0, shiftJis: 0, unknown: 0 };
    let validEntries = 0;
    for (const rawEntry of entries) {
        const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry as Record<string, unknown> : {};
        const entryId = typeof entry.id === 'string' ? entry.id : '(unknown)';
        const sourceFile = typeof entry.sourceFile === 'string' ? entry.sourceFile : '';
        const wolf = entry.wolf && typeof entry.wolf === 'object' ? entry.wolf as Record<string, unknown> : {};
        const pos1 = wolf.pos1;
        const pos2 = wolf.pos2;
        const pos3 = wolf.pos3;
        const len = wolf.len;
        if (entry.encoding === 'utf8') encodingCounts.utf8++;
        else if (entry.encoding === 'shift_jis') encodingCounts.shiftJis++;
        else encodingCounts.unknown++;
        const target = path.resolve(root, sourceFile);
        const relative = path.relative(root, target);
        let valid = true;
        if (!sourceFile || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !fs.existsSync(target)) {
            issues.push({ code: 'WOLF_SOURCE_MISSING', severity: 'critical', file: sourceFile || null, entryId, message: 'Wolf 원본 파일이 없거나 데이터 루트 밖을 가리킵니다' });
            valid = false;
        } else {
            files.add(sourceFile);
        }
        if (valid && (!Number.isInteger(pos1)
            || !Number.isInteger(pos2)
            || !Number.isInteger(pos3)
            || !Number.isInteger(len)
            || Number(pos1) < 0
            || Number(pos2) !== Number(pos1) + 4
            || Number(pos3) < Number(pos2)
            || Number(pos3) > fs.statSync(target).size
            || Number(pos3) - Number(pos2) !== Number(len))) {
            issues.push({ code: 'WOLF_OFFSET_INVALID', severity: 'critical', file: sourceFile, entryId, message: 'Wolf 길이 prefix offset이 파일 범위를 벗어났습니다' });
            valid = false;
        } else if (valid) {
            const bytes = fs.readFileSync(target);
            const actualLength = bytes.readUInt32LE(Number(pos1));
            if (actualLength !== Number(len)) {
                issues.push({
                    code: 'WOLF_LENGTH_PREFIX_MISMATCH',
                    severity: 'critical',
                    file: sourceFile,
                    entryId,
                    message: `Wolf 길이 prefix가 manifest와 다릅니다: ${actualLength} != ${String(len)}`,
                });
                valid = false;
            }
            const original = bytes.subarray(Number(pos2), Number(pos3));
            if (entry.nullTerminated === true && (original.length === 0 || original[original.length - 1] !== 0)) {
                issues.push({
                    code: 'WOLF_NULL_TERMINATOR_MISSING',
                    severity: 'critical',
                    file: sourceFile,
                    entryId,
                    message: 'Wolf 문자열의 필수 널 종료 바이트가 없습니다',
                });
                valid = false;
            }
            const payload = entry.nullTerminated === true && original[original.length - 1] === 0
                ? original.subarray(0, original.length - 1)
                : original;
            const decoded = (entry.encoding === 'shift_jis'
                ? iconv.decode(Buffer.from(payload), 'shift_jis')
                : Buffer.from(payload).toString('utf8')).replaceAll('\\', '\\\\');
            const actualHash = crypto.createHash('sha256').update(decoded, 'utf8').digest('hex');
            if (typeof entry.hash !== 'string' || entry.hash.toLowerCase() !== actualHash) {
                issues.push({
                    code: 'WOLF_SOURCE_HASH_MISMATCH',
                    severity: 'critical',
                    file: sourceFile,
                    entryId,
                    message: 'Wolf 원문 바이트를 디코딩한 해시가 manifest와 다릅니다',
                });
                valid = false;
            }
        }
        if (valid) validEntries++;
    }
    const invalidEntries = entries.length - validEntries;
    return {
        profile: 'wolf',
        ok: invalidEntries === 0,
        filesChecked: files.size,
        entriesChecked: entries.length,
        validEntries,
        invalidEntries,
        encodingCounts,
        encodingWarnings: 0,
        tokenErrors: 0,
        issues,
    };
}

export function inspectTyranoProject(projectRoot: string): StructuralValidationReport {
    const root = path.resolve(projectRoot);
    const files: string[] = [];
    const visit = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) continue;
            const child = path.join(current, entry.name);
            if (entry.isDirectory()) visit(child);
            else if (entry.isFile() && /\.(?:ks|tjs)$/i.test(entry.name)) files.push(child);
        }
    };
    visit(root);
    const issues: StructuralIssue[] = [];
    const invalidFiles = new Set<string>();
    const encodingCounts = { utf8: 0, shiftJis: 0, unknown: 0 };
    for (const file of files) {
        const relative = path.relative(root, file).replace(/\\/g, '/');
        const decoded = decodeTyranoText(fs.readFileSync(file));
        encodingCounts[decoded.encoding]++;
        const text = decoded.text;
        if (decoded.encoding === 'unknown') {
            issues.push({
                code: 'TYRANO_ENCODING_UNCERTAIN',
                severity: 'warning',
                file: relative,
                message: 'Tyrano 텍스트가 올바른 UTF-8 또는 왕복 가능한 Shift_JIS인지 확인할 수 없습니다',
            });
        }
        if (file.toLowerCase().endsWith('.tjs')) {
            const tjsIssues = inspectTjsDelimiters(text, relative);
            issues.push(...tjsIssues);
            if (tjsIssues.some((issue) => issue.severity !== 'warning')) invalidFiles.add(relative);
            continue;
        }
        const lines = text.split(/\r?\n/);
        const blocks: Array<{ tag: string; expected: string; line: number; column: number }> = [];
        const openers: Record<string, string> = {
            if: 'endif',
            macro: 'endmacro',
            ignore: 'endignore',
            iscript: 'endscript',
            while: 'endwhile',
            for: 'endfor',
        };
        const knownClosers = new Set(Object.values(openers));
        let inScript = false;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            if (inScript) {
                const endScript = /\[\s*endscript\b[^\]]*\]/i.exec(line);
                if (endScript) {
                    inScript = false;
                    if (blocks[blocks.length - 1]?.expected === 'endscript') blocks.pop();
                }
                continue;
            }
            if (/^\s*;/.test(line)) continue;
            for (let cursor = 0; cursor < line.length; cursor++) {
                if (line[cursor] !== '[') continue;
                const start = cursor;
                let quote: string | null = null;
                let escaped = false;
                for (cursor = start + 1; cursor < line.length; cursor++) {
                    const current = line[cursor];
                    if (escaped) {
                        escaped = false;
                        continue;
                    }
                    if (current === '\\') {
                        escaped = true;
                        continue;
                    }
                    if (quote) {
                        if (current === quote) quote = null;
                        continue;
                    }
                    if (current === '"' || current === "'") {
                        quote = current;
                        continue;
                    }
                    if (current === ']') break;
                }
                if (cursor >= line.length) {
                    issues.push({
                        code: 'TYRANO_KS_UNTERMINATED_TAG',
                        severity: 'error',
                        file: relative,
                        line: lineIndex + 1,
                        column: start + 1,
                        message: 'Tyrano KS 태그의 닫는 대괄호가 없습니다',
                    });
                    invalidFiles.add(relative);
                    break;
                }
                const tagName = line.slice(start + 1, cursor).trim().split(/\s+/)[0]?.toLowerCase();
                if (tagName && openers[tagName]) {
                    blocks.push({ tag: tagName, expected: openers[tagName], line: lineIndex + 1, column: start + 1 });
                    if (tagName === 'iscript') inScript = true;
                } else if (tagName && knownClosers.has(tagName)) {
                    if (blocks[blocks.length - 1]?.expected === tagName) {
                        blocks.pop();
                    } else {
                        issues.push({
                            code: 'TYRANO_KS_UNEXPECTED_CLOSER',
                            severity: 'error',
                            file: relative,
                            line: lineIndex + 1,
                            column: start + 1,
                            message: `Tyrano KS 제어 태그 순서가 맞지 않습니다: ${tagName}`,
                        });
                        invalidFiles.add(relative);
                    }
                }
            }
        }
        for (const block of blocks) {
            issues.push({
                code: 'TYRANO_KS_UNCLOSED_BLOCK',
                severity: 'error',
                file: relative,
                line: block.line,
                column: block.column,
                message: `Tyrano KS ${block.tag} 블록에 ${block.expected} 태그가 없습니다`,
            });
            invalidFiles.add(relative);
        }
    }
    const invalidEntries = invalidFiles.size;
    return {
        profile: 'tyrano',
        ok: invalidEntries === 0,
        filesChecked: files.length,
        entriesChecked: files.length,
        validEntries: files.length - invalidEntries,
        invalidEntries,
        encodingCounts,
        encodingWarnings: issues.filter((issue) => issue.code === 'TYRANO_ENCODING_UNCERTAIN').length,
        tokenErrors: issues.filter((issue) => issue.severity !== 'warning').length,
        issues,
    };
}

function clampScore(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreVerification(input: ScoreInput): ScoreResult {
    const components = {
        extractionCoverage: clampScore(input.extractionCoverage),
        mappingIntegrity: clampScore(input.mappingIntegrity),
        reinsertionValidity: clampScore(input.reinsertionValidity),
        protectedScriptIntegrity: clampScore(input.protectedScriptIntegrity),
        containerIntegrity: clampScore(input.containerIntegrity),
    };
    const total = Math.round(
        components.extractionCoverage * 0.2
        + components.mappingIntegrity * 0.2
        + components.reinsertionValidity * 0.3
        + components.protectedScriptIntegrity * 0.2
        + components.containerIntegrity * 0.1,
    );
    const issues = [...(input.critical ?? [])];
    let risk: ScoreResult['risk'];
    if (issues.length > 0) {
        risk = 'critical';
    } else if (total >= 90) {
        risk = 'low';
    } else if (total >= 75) {
        risk = 'medium';
    } else if (total >= 50) {
        risk = 'high';
    } else {
        risk = 'critical';
    }
    return { ...components, total, risk, ok: issues.length === 0 && total >= 75, issues, components };
}

export function diffFileMaps(before: FileMapEntry[], after: FileMapEntry[]): FileDiff {
    const oldByPath = new Map(before.map((entry) => [entry.path, entry]));
    const newByPath = new Map(after.map((entry) => [entry.path, entry]));
    const paths = new Set([...oldByPath.keys(), ...newByPath.keys()]);
    let filesChanged = 0;
    let bytesChanged = 0;
    let protectedFilesChanged = 0;
    let protectedBytesChanged = 0;
    let addedFiles = 0;
    let removedFiles = 0;
    let textBytesChanged = 0;

    for (const filePath of paths) {
        const oldEntry = oldByPath.get(filePath);
        const newEntry = newByPath.get(filePath);
        if (!oldEntry) {
            addedFiles++;
        }
        if (!newEntry) {
            removedFiles++;
        }
        if (oldEntry && newEntry && oldEntry.hash === newEntry.hash && oldEntry.size === newEntry.size) {
            continue;
        }
        filesChanged++;
        bytesChanged += Math.abs((newEntry?.size ?? 0) - (oldEntry?.size ?? 0));
        if (oldEntry?.protected || newEntry?.protected) {
            protectedFilesChanged++;
            protectedBytesChanged += Math.max(oldEntry?.size ?? 0, newEntry?.size ?? 0);
        }
        const textPath = /\.(json|txt|ks|tjs|yaml|yml|csv|js|html|css)$/i.test(filePath);
        if (textPath && !(oldEntry?.protected || newEntry?.protected)) {
            textBytesChanged += Math.abs((newEntry?.size ?? 0) - (oldEntry?.size ?? 0));
        }
    }

    return {
        filesChanged,
        bytesChanged,
        protectedFilesChanged,
        protectedBytesChanged,
        addedFiles,
        removedFiles,
        protectedScriptDamage: protectedFilesChanged > 0 ? 100 : 0,
        textBytesChanged,
    };
}

export function isProtectedPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return /(^|\/)(package\.json|main\.js|preload[^/]*\.js|ElectronForMz\.js|js\/rmmz_[^/]*\.js|js\/plugins\.js|www\/js\/rmmz_[^/]*\.js)$/i.test(normalized)
        || /(^|\/)(gdjs|libs\/gdjs|Extensions)\/.*\.js$/i.test(normalized)
        || /(^|\/)code\d*\.js$/i.test(normalized);
}

export function snapshotDirectory(rootPath: string, maxFiles = 20000): FileMapEntry[] {
    const root = path.resolve(rootPath);
    const output: FileMapEntry[] = [];
    const visit = (current: string, relative: string): void => {
        if (output.length > maxFiles) throw new Error('스냅샷 파일 수 제한 초과: ' + maxFiles);
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) throw new Error('심볼릭 링크/정션은 검증할 수 없습니다: ' + path.join(current, entry.name));
            if (['Extract', '_Extract', 'Backup', 'Completed', '.git'].includes(entry.name)) continue;
            const child = path.join(current, entry.name);
            const childRelative = relative ? path.join(relative, entry.name) : entry.name;
            if (entry.isDirectory()) {
                visit(child, childRelative);
            } else if (entry.isFile()) {
                if (output.length >= maxFiles) throw new Error('스냅샷 파일 수 제한 초과: ' + maxFiles);
                const bytes = fs.readFileSync(child);
                const normalized = childRelative.replace(/\\/g, '/');
                output.push({
                    path: normalized,
                    size: bytes.length,
                    hash: crypto.createHash('sha256').update(bytes).digest('hex'),
                    protected: isProtectedPath(normalized),
                });
            }
        }
    };
    visit(root, '');
    return output;
}
