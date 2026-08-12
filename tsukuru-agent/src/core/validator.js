"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectRpgProject = inspectRpgProject;
exports.inspectWolfBinaryMappings = inspectWolfBinaryMappings;
exports.inspectTyranoProject = inspectTyranoProject;
exports.scoreVerification = scoreVerification;
exports.diffFileMaps = diffFileMaps;
exports.isProtectedPath = isProtectedPath;
exports.snapshotDirectory = snapshotDirectory;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const iconv_lite_1 = __importDefault(require("iconv-lite"));
function containedPath(root, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' || path_1.default.isAbsolute(relativePath))
        return null;
    const target = path_1.default.resolve(root, relativePath);
    const relative = path_1.default.relative(root, target);
    return relative && !relative.startsWith('..' + path_1.default.sep) && !path_1.default.isAbsolute(relative) ? target : null;
}
function valueAtDataPath(value, dataPath) {
    if (typeof dataPath !== 'string' || dataPath === '')
        return undefined;
    let current = value;
    for (const segment of dataPath.split('.')) {
        if ((typeof current !== 'object' && !Array.isArray(current)) || current === null
            || !Object.prototype.hasOwnProperty.call(current, segment))
            return undefined;
        current = current[segment];
    }
    return current;
}
function inspectRpgProject(dataRoot, manifest) {
    const root = path_1.default.resolve(dataRoot);
    const issues = [];
    const encodingCounts = { utf8: 0, shiftJis: 0, unknown: 0 };
    const parsed = new Map();
    const rootJsonFiles = fs_1.default.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map((entry) => entry.name)
        .sort();
    const backupRoot = path_1.default.join(root, 'Backup');
    const jsonRoot = rootJsonFiles.length === 0 && fs_1.default.existsSync(backupRoot) && fs_1.default.statSync(backupRoot).isDirectory()
        ? backupRoot
        : root;
    const jsonFiles = jsonRoot === root
        ? rootJsonFiles
        : fs_1.default.readdirSync(jsonRoot, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
            .map((entry) => entry.name)
            .sort();
    const arrayRoots = new Set([
        'Actors.json', 'Animations.json', 'Armors.json', 'Classes.json', 'CommonEvents.json',
        'Enemies.json', 'Items.json', 'MapInfos.json', 'Skills.json', 'States.json',
        'Tilesets.json', 'Troops.json', 'Weapons.json',
    ]);
    for (const file of jsonFiles) {
        const filePath = path_1.default.join(jsonRoot, file);
        try {
            const bytes = fs_1.default.readFileSync(filePath);
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
                    if (item && typeof item === 'object' && typeof item.id === 'number'
                        && item.id !== index) {
                        issues.push({
                            code: 'RPG_ID_INDEX_MISMATCH', severity: 'error', file, entryId: String(index),
                            message: `RPG 데이터 id가 배열 index와 다릅니다: ${String(item.id)} != ${index}`,
                        });
                    }
                }
            }
        }
        catch (error) {
            encodingCounts.unknown++;
            issues.push({
                code: 'RPG_JSON_PARSE_ERROR', severity: 'critical', file,
                message: `RPG JSON 파싱에 실패했습니다: ${String(error)}`,
            });
        }
    }
    const entries = manifest && typeof manifest === 'object' && Array.isArray(manifest.entries)
        ? manifest.entries
        : [];
    const invalidEntryIndexes = new Set();
    const seenIds = new Set();
    const extractLines = new Map();
    const sourceJson = new Map();
    for (let index = 0; index < entries.length; index++) {
        const raw = entries[index];
        const entry = raw && typeof raw === 'object' ? raw : {};
        const entryId = typeof entry.id === 'string' ? entry.id : `(entry-${index})`;
        const fail = (code, message, file) => {
            invalidEntryIndexes.add(index);
            issues.push({ code, severity: 'critical', file, entryId, message });
        };
        if (seenIds.has(entryId))
            fail('RPG_MANIFEST_DUPLICATE_ID', 'RPG manifest에 중복 id가 있습니다', null);
        seenIds.add(entryId);
        const extractTarget = containedPath(path_1.default.join(root, 'Extract'), entry.extractFile);
        if (!extractTarget || !fs_1.default.existsSync(extractTarget)) {
            fail('RPG_EXTRACT_FILE_MISSING', 'RPG 추출 텍스트 파일이 없거나 Extract 밖을 가리킵니다', typeof entry.extractFile === 'string' ? entry.extractFile : null);
        }
        else {
            if (!extractLines.has(extractTarget))
                extractLines.set(extractTarget, fs_1.default.readFileSync(extractTarget, 'utf8').split('\n'));
            const lines = extractLines.get(extractTarget);
            const start = entry.lineStart;
            const end = entry.lineEnd;
            if (!Number.isInteger(start) || !Number.isInteger(end) || Number(start) < 0 || Number(start) >= Number(end) || Number(end) > lines.length) {
                fail('RPG_LINE_MAPPING_INVALID', `RPG 추출 줄 범위가 올바르지 않습니다: ${String(start)}..${String(end)} / ${lines.length}`, String(entry.extractFile));
            }
            else {
                const text = lines.slice(Number(start), Number(end)).join('\n');
                const actualHash = crypto_1.default.createHash('sha256').update(text, 'utf8').digest('hex');
                if (typeof entry.hash !== 'string' || entry.hash.toLowerCase() !== actualHash) {
                    fail('RPG_EXTRACT_HASH_MISMATCH', 'RPG 추출 텍스트 해시가 manifest와 다릅니다', String(entry.extractFile));
                }
            }
        }
        const sourceTarget = containedPath(root, entry.sourceFile);
        if (!sourceTarget || !fs_1.default.existsSync(sourceTarget)) {
            fail('RPG_SOURCE_FILE_MISSING', 'RPG manifest 원본 JSON이 없거나 data 폴더 밖을 가리킵니다', typeof entry.sourceFile === 'string' ? entry.sourceFile : null);
        }
        else {
            try {
                if (!sourceJson.has(sourceTarget))
                    sourceJson.set(sourceTarget, JSON.parse(fs_1.default.readFileSync(sourceTarget, 'utf8').replace(/^\uFEFF/, '')));
                const mv = entry.mv && typeof entry.mv === 'object' ? entry.mv : {};
                const conf = mv.conf && typeof mv.conf === 'object' ? mv.conf : {};
                if (conf.isComment !== true && typeof valueAtDataPath(sourceJson.get(sourceTarget), entry.dataPath) !== 'string') {
                    fail('RPG_DATA_PATH_INVALID', 'RPG manifest dataPath가 원본 문자열을 가리키지 않습니다', path_1.default.relative(root, sourceTarget).replace(/\\/g, '/'));
                }
            }
            catch (error) {
                fail('RPG_SOURCE_JSON_PARSE_ERROR', `RPG manifest 원본 JSON 파싱에 실패했습니다: ${String(error)}`, path_1.default.relative(root, sourceTarget).replace(/\\/g, '/'));
            }
        }
    }
    const idSet = (file) => {
        const value = parsed.get(file);
        return new Set(Array.isArray(value)
            ? value.flatMap((item) => item && typeof item === 'object' && typeof item.id === 'number'
                ? [item.id] : [])
            : []);
    };
    const classes = idSet('Classes.json');
    const skills = idSet('Skills.json');
    const enemies = idSet('Enemies.json');
    const commonEvents = idSet('CommonEvents.json');
    const maps = idSet('MapInfos.json');
    const addReferenceIssue = (file, entryId, target) => {
        issues.push({ code: 'RPG_REFERENCE_MISSING', severity: 'error', file, entryId, message: `RPG 참조 대상이 없습니다: ${target}` });
    };
    const eachRecord = (file, fn) => {
        const value = parsed.get(file);
        if (!Array.isArray(value))
            return;
        for (let index = 1; index < value.length; index++) {
            const record = value[index];
            if (record && typeof record === 'object')
                fn(record, index);
        }
    };
    eachRecord('Actors.json', (actor, index) => {
        if (typeof actor.classId === 'number' && actor.classId > 0 && !classes.has(actor.classId))
            addReferenceIssue('Actors.json', `${index}.classId`, `Classes.json#${actor.classId}`);
    });
    eachRecord('Classes.json', (klass, index) => {
        if (!Array.isArray(klass.learnings))
            return;
        for (let learningIndex = 0; learningIndex < klass.learnings.length; learningIndex++) {
            const learning = klass.learnings[learningIndex];
            if (learning && typeof learning.skillId === 'number' && learning.skillId > 0 && !skills.has(learning.skillId)) {
                addReferenceIssue('Classes.json', `${index}.learnings.${learningIndex}.skillId`, `Skills.json#${learning.skillId}`);
            }
        }
    });
    eachRecord('Enemies.json', (enemy, index) => {
        if (!Array.isArray(enemy.actions))
            return;
        for (let actionIndex = 0; actionIndex < enemy.actions.length; actionIndex++) {
            const action = enemy.actions[actionIndex];
            if (action && typeof action.skillId === 'number' && action.skillId > 0 && !skills.has(action.skillId)) {
                addReferenceIssue('Enemies.json', `${index}.actions.${actionIndex}.skillId`, `Skills.json#${action.skillId}`);
            }
        }
    });
    eachRecord('Troops.json', (troop, index) => {
        if (!Array.isArray(troop.members))
            return;
        for (let memberIndex = 0; memberIndex < troop.members.length; memberIndex++) {
            const member = troop.members[memberIndex];
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
        if (!/^Map\d{3}\.json$/i.test(file) || !value || typeof value !== 'object')
            continue;
        const events = value.events;
        if (!Array.isArray(events))
            continue;
        for (let eventIndex = 1; eventIndex < events.length; eventIndex++) {
            const event = events[eventIndex];
            if (!event || !Array.isArray(event.pages))
                continue;
            for (let pageIndex = 0; pageIndex < event.pages.length; pageIndex++) {
                const page = event.pages[pageIndex];
                if (!page || !Array.isArray(page.list))
                    continue;
                for (let commandIndex = 0; commandIndex < page.list.length; commandIndex++) {
                    const command = page.list[commandIndex];
                    if (!command || !Array.isArray(command.parameters))
                        continue;
                    const code = command.code;
                    const parameters = command.parameters;
                    if (code === 117 && typeof parameters[0] === 'number' && !commonEvents.has(parameters[0])) {
                        addReferenceIssue(file, `${eventIndex}.pages.${pageIndex}.list.${commandIndex}`, `CommonEvents.json#${parameters[0]}`);
                    }
                    else if (code === 201 && parameters[0] === 0 && typeof parameters[1] === 'number' && !maps.has(parameters[1])) {
                        addReferenceIssue(file, `${eventIndex}.pages.${pageIndex}.list.${commandIndex}`, `MapInfos.json#${parameters[1]}`);
                    }
                }
            }
        }
    }
    const system = parsed.get('System.json');
    if (system && typeof system === 'object' && typeof system.startMapId === 'number') {
        const startMapId = system.startMapId;
        if (startMapId > 0 && !maps.has(startMapId))
            addReferenceIssue('System.json', 'startMapId', `MapInfos.json#${startMapId}`);
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
function decodeTyranoText(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return { text: bytes.subarray(3).toString('utf8'), encoding: 'utf8' };
    }
    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
    }
    catch (_a) {
        const text = iconv_lite_1.default.decode(bytes, 'shift_jis');
        if (iconv_lite_1.default.encode(text, 'shift_jis').equals(bytes)) {
            return { text, encoding: 'shiftJis' };
        }
        return { text, encoding: 'unknown' };
    }
}
function inspectTjsDelimiters(text, file) {
    const issues = [];
    const stack = [];
    const closers = { '(': ')', '[': ']', '{': '}' };
    let line = 1;
    let column = 0;
    let quote = null;
    let quoteStart = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    let blockCommentStart = null;
    for (let index = 0; index < text.length; index++) {
        const current = text[index];
        const next = text[index + 1];
        column++;
        if (current === '\n') {
            if (quote && quote !== '`') {
                if (escaped) {
                    escaped = false;
                }
                else if (quoteStart) {
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
        if (lineComment)
            continue;
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
            }
            else if (current === '\\') {
                escaped = true;
            }
            else if (current === quote) {
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
            if ((opener === null || opener === void 0 ? void 0 : opener.closer) === current) {
                stack.pop();
            }
            else {
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
function inspectWolfBinaryMappings(_dataRoot, manifest) {
    const entries = manifest && typeof manifest === 'object' && Array.isArray(manifest.entries)
        ? manifest.entries
        : [];
    const root = path_1.default.resolve(_dataRoot);
    const issues = [];
    const files = new Set();
    const encodingCounts = { utf8: 0, shiftJis: 0, unknown: 0 };
    let validEntries = 0;
    for (const rawEntry of entries) {
        const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
        const entryId = typeof entry.id === 'string' ? entry.id : '(unknown)';
        const sourceFile = typeof entry.sourceFile === 'string' ? entry.sourceFile : '';
        const wolf = entry.wolf && typeof entry.wolf === 'object' ? entry.wolf : {};
        const pos1 = wolf.pos1;
        const pos2 = wolf.pos2;
        const pos3 = wolf.pos3;
        const len = wolf.len;
        if (entry.encoding === 'utf8')
            encodingCounts.utf8++;
        else if (entry.encoding === 'shift_jis')
            encodingCounts.shiftJis++;
        else
            encodingCounts.unknown++;
        const target = path_1.default.resolve(root, sourceFile);
        const relative = path_1.default.relative(root, target);
        let valid = true;
        if (!sourceFile || relative.startsWith('..' + path_1.default.sep) || path_1.default.isAbsolute(relative) || !fs_1.default.existsSync(target)) {
            issues.push({ code: 'WOLF_SOURCE_MISSING', severity: 'critical', file: sourceFile || null, entryId, message: 'Wolf 원본 파일이 없거나 데이터 루트 밖을 가리킵니다' });
            valid = false;
        }
        else {
            files.add(sourceFile);
        }
        if (valid && (!Number.isInteger(pos1)
            || !Number.isInteger(pos2)
            || !Number.isInteger(pos3)
            || !Number.isInteger(len)
            || Number(pos1) < 0
            || Number(pos2) !== Number(pos1) + 4
            || Number(pos3) < Number(pos2)
            || Number(pos3) > fs_1.default.statSync(target).size
            || Number(pos3) - Number(pos2) !== Number(len))) {
            issues.push({ code: 'WOLF_OFFSET_INVALID', severity: 'critical', file: sourceFile, entryId, message: 'Wolf 길이 prefix offset이 파일 범위를 벗어났습니다' });
            valid = false;
        }
        else if (valid) {
            const bytes = fs_1.default.readFileSync(target);
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
                ? iconv_lite_1.default.decode(Buffer.from(payload), 'shift_jis')
                : Buffer.from(payload).toString('utf8')).replaceAll('\\', '\\\\');
            const actualHash = crypto_1.default.createHash('sha256').update(decoded, 'utf8').digest('hex');
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
        if (valid)
            validEntries++;
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
function inspectTyranoProject(projectRoot) {
    var _a, _b, _c;
    const root = path_1.default.resolve(projectRoot);
    const files = [];
    const visit = (current) => {
        for (const entry of fs_1.default.readdirSync(current, { withFileTypes: true })) {
            if (entry.isSymbolicLink())
                continue;
            const child = path_1.default.join(current, entry.name);
            if (entry.isDirectory())
                visit(child);
            else if (entry.isFile() && /\.(?:ks|tjs)$/i.test(entry.name))
                files.push(child);
        }
    };
    visit(root);
    const issues = [];
    const invalidFiles = new Set();
    const encodingCounts = { utf8: 0, shiftJis: 0, unknown: 0 };
    for (const file of files) {
        const relative = path_1.default.relative(root, file).replace(/\\/g, '/');
        const decoded = decodeTyranoText(fs_1.default.readFileSync(file));
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
            if (tjsIssues.some((issue) => issue.severity !== 'warning'))
                invalidFiles.add(relative);
            continue;
        }
        const lines = text.split(/\r?\n/);
        const blocks = [];
        const openers = {
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
                    if (((_a = blocks[blocks.length - 1]) === null || _a === void 0 ? void 0 : _a.expected) === 'endscript')
                        blocks.pop();
                }
                continue;
            }
            if (/^\s*;/.test(line))
                continue;
            for (let cursor = 0; cursor < line.length; cursor++) {
                if (line[cursor] !== '[')
                    continue;
                const start = cursor;
                let quote = null;
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
                        if (current === quote)
                            quote = null;
                        continue;
                    }
                    if (current === '"' || current === "'") {
                        quote = current;
                        continue;
                    }
                    if (current === ']')
                        break;
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
                const tagName = (_b = line.slice(start + 1, cursor).trim().split(/\s+/)[0]) === null || _b === void 0 ? void 0 : _b.toLowerCase();
                if (tagName && openers[tagName]) {
                    blocks.push({ tag: tagName, expected: openers[tagName], line: lineIndex + 1, column: start + 1 });
                    if (tagName === 'iscript')
                        inScript = true;
                }
                else if (tagName && knownClosers.has(tagName)) {
                    if (((_c = blocks[blocks.length - 1]) === null || _c === void 0 ? void 0 : _c.expected) === tagName) {
                        blocks.pop();
                    }
                    else {
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
function clampScore(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
}
function scoreVerification(input) {
    var _a;
    const components = {
        extractionCoverage: clampScore(input.extractionCoverage),
        mappingIntegrity: clampScore(input.mappingIntegrity),
        reinsertionValidity: clampScore(input.reinsertionValidity),
        protectedScriptIntegrity: clampScore(input.protectedScriptIntegrity),
        containerIntegrity: clampScore(input.containerIntegrity),
    };
    const total = Math.round(components.extractionCoverage * 0.2
        + components.mappingIntegrity * 0.2
        + components.reinsertionValidity * 0.3
        + components.protectedScriptIntegrity * 0.2
        + components.containerIntegrity * 0.1);
    const issues = [...((_a = input.critical) !== null && _a !== void 0 ? _a : [])];
    let risk;
    if (issues.length > 0) {
        risk = 'critical';
    }
    else if (total >= 90) {
        risk = 'low';
    }
    else if (total >= 75) {
        risk = 'medium';
    }
    else if (total >= 50) {
        risk = 'high';
    }
    else {
        risk = 'critical';
    }
    return { ...components, total, risk, ok: issues.length === 0 && total >= 75, issues, components };
}
function diffFileMaps(before, after) {
    var _a, _b, _c, _d, _e, _f;
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
        bytesChanged += Math.abs(((_a = newEntry === null || newEntry === void 0 ? void 0 : newEntry.size) !== null && _a !== void 0 ? _a : 0) - ((_b = oldEntry === null || oldEntry === void 0 ? void 0 : oldEntry.size) !== null && _b !== void 0 ? _b : 0));
        if ((oldEntry === null || oldEntry === void 0 ? void 0 : oldEntry.protected) || (newEntry === null || newEntry === void 0 ? void 0 : newEntry.protected)) {
            protectedFilesChanged++;
            protectedBytesChanged += Math.max((_c = oldEntry === null || oldEntry === void 0 ? void 0 : oldEntry.size) !== null && _c !== void 0 ? _c : 0, (_d = newEntry === null || newEntry === void 0 ? void 0 : newEntry.size) !== null && _d !== void 0 ? _d : 0);
        }
        const textPath = /\.(json|txt|ks|tjs|yaml|yml|csv|js|html|css)$/i.test(filePath);
        if (textPath && !((oldEntry === null || oldEntry === void 0 ? void 0 : oldEntry.protected) || (newEntry === null || newEntry === void 0 ? void 0 : newEntry.protected))) {
            textBytesChanged += Math.abs(((_e = newEntry === null || newEntry === void 0 ? void 0 : newEntry.size) !== null && _e !== void 0 ? _e : 0) - ((_f = oldEntry === null || oldEntry === void 0 ? void 0 : oldEntry.size) !== null && _f !== void 0 ? _f : 0));
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
function isProtectedPath(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return /(^|\/)(package\.json|main\.js|preload[^/]*\.js|ElectronForMz\.js|js\/rmmz_[^/]*\.js|js\/plugins\.js|www\/js\/rmmz_[^/]*\.js)$/i.test(normalized)
        || /(^|\/)(gdjs|libs\/gdjs|Extensions)\/.*\.js$/i.test(normalized)
        || /(^|\/)code\d*\.js$/i.test(normalized);
}
function snapshotDirectory(rootPath, maxFiles = 20000) {
    const root = path_1.default.resolve(rootPath);
    const output = [];
    const visit = (current, relative) => {
        if (output.length > maxFiles)
            throw new Error('스냅샷 파일 수 제한 초과: ' + maxFiles);
        for (const entry of fs_1.default.readdirSync(current, { withFileTypes: true })) {
            if (entry.isSymbolicLink())
                throw new Error('심볼릭 링크/정션은 검증할 수 없습니다: ' + path_1.default.join(current, entry.name));
            if (['Extract', '_Extract', 'Backup', 'Completed', '.git'].includes(entry.name))
                continue;
            const child = path_1.default.join(current, entry.name);
            const childRelative = relative ? path_1.default.join(relative, entry.name) : entry.name;
            if (entry.isDirectory()) {
                visit(child, childRelative);
            }
            else if (entry.isFile()) {
                if (output.length >= maxFiles)
                    throw new Error('스냅샷 파일 수 제한 초과: ' + maxFiles);
                const bytes = fs_1.default.readFileSync(child);
                const normalized = childRelative.replace(/\\/g, '/');
                output.push({
                    path: normalized,
                    size: bytes.length,
                    hash: crypto_1.default.createHash('sha256').update(bytes).digest('hex'),
                    protected: isProtectedPath(normalized),
                });
            }
        }
    };
    visit(root, '');
    return output;
}
