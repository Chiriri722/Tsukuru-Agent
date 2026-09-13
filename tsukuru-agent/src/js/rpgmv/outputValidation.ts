import fs from 'fs';
import path from 'path';
import * as acorn from 'acorn';
import yaml from 'js-yaml';
import { RpgApplyPlan, readRpgDataPath } from './applyPlan';
import { parseRpgMessageCsv, RpgTranslation } from './translation';
import { ErrorCodes, OperationError } from '../../core/types';
import { diagnosticLabel } from '../../core/translationLint';
import { inspectRpgProject } from '../../core/validation/engines/rpg';
import { ArtifactReplacement, makeStagingDir, removePathBestEffortSync, replaceArtifactPathsSync } from '../../core/atomic';
import { findLinkedPathComponent, resolveContainedPathWithoutLinks } from '../../core/pathSafety';

function invalidOutput(file: string, entryId?: string): OperationError {
    return new OperationError(ErrorCodes.VERIFY_FAILED, 'RPG 최종 출력이 허용된 번역 계획과 일치하지 않습니다', {
        file: diagnosticLabel(file), ...(entryId ? { entryId: diagnosticLabel(entryId) } : {}),
    });
}

function safeChild(root: string, relative: string): string {
    const resolved = resolveContainedPathWithoutLinks(root, relative);
    if (!resolved.ok) throw invalidOutput(relative);
    return resolved.path;
}

function readText(root: string, relative: string): string {
    const file = safeChild(root, relative);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw invalidOutput(relative);
    return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)).replace(/^\uFEFF/, '');
}

function outputPath(file: string, useYaml: boolean): string {
    if (file === 'ext_plugins.json') return 'js/plugins.js';
    if (file === 'ExternMsgcsv.json') return 'data/ExternMessage.csv';
    return `data/${file}${useYaml ? '.yaml' : ''}`;
}

function parsePluginOutput(script: string, expected: unknown, original: string, plan: RpgApplyPlan): unknown {
    const generated = `var $plugins = ${JSON.stringify(expected)};`;
    if (script !== generated) {
        const sourcePath = safeChild(path.dirname(plan.dataRoot), 'js/plugins.js');
        if (JSON.stringify(expected) !== original || !fs.existsSync(sourcePath)
            || script !== readText(path.dirname(plan.dataRoot), 'js/plugins.js')) throw invalidOutput('js/plugins.js');
    }
    const ast: any = acorn.parse(script, { ecmaVersion: 'latest' });
    const initializers: any[] = [];
    for (const node of ast.body) {
        if (node.type === 'VariableDeclaration') for (const declaration of node.declarations) {
            if (declaration.id?.type === 'Identifier' && declaration.id.name === '$plugins') initializers.push(declaration.init);
        }
        if (node.type === 'ExpressionStatement' && node.expression?.type === 'AssignmentExpression'
            && node.expression.left?.type === 'Identifier' && node.expression.left.name === '$plugins') {
            initializers.push(node.expression.right);
        }
    }
    if (initializers.length !== 1 || !initializers[0]) throw invalidOutput('js/plugins.js');
    return JSON.parse(script.slice(initializers[0].start, initializers[0].end));
}

/** A current plugins.js may contain a previous instant translation rather than Backup text. */
export function canPreserveRpgPluginSource(script: string, expectedJson: string, plan: RpgApplyPlan): boolean {
    try {
        return JSON.stringify(parsePluginOutput(script, JSON.parse(expectedJson), expectedJson, plan)) === expectedJson;
    } catch { return false; }
}

function assertAllowedChanges(file: string, original: unknown, actual: unknown, translations: RpgTranslation[]): void {
    const allowed = new Map(translations.map(item => [JSON.stringify(item.entry.dataPath.split('.')), item.text]));
    const stack: { before: any; after: any; segments: string[] }[] = [{ before: original, after: actual, segments: [] }];
    while (stack.length) {
        const { before, after, segments } = stack.pop()!;
        if (before === null || typeof before !== 'object') {
            const expected = allowed.get(JSON.stringify(segments));
            if (!Object.is(before, after) && (expected === undefined || expected !== after)) {
                throw invalidOutput(file, `${file}#${segments.join('.')}`);
            }
            continue;
        }
        if (after === null || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) throw invalidOutput(file);
        const keys = Object.keys(before).sort();
        const actualKeys = Object.keys(after).sort();
        if (keys.length !== actualKeys.length || keys.some((key, index) => key !== actualKeys[index])) throw invalidOutput(file);
        for (const key of keys) stack.push({ before: before[key], after: after[key], segments: [...segments, key] });
    }
    for (const translation of translations) {
        if (readRpgDataPath(actual, translation.entry.dataPath) !== translation.text) throw invalidOutput(file, translation.entryId);
    }
}

function regularFiles(root: string, relative = ''): string[] {
    const dir = relative ? safeChild(root, relative) : root;
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        safeChild(root, child);
        if (entry.isDirectory()) files.push(...regularFiles(root, child));
        else if (entry.isFile()) files.push(child);
        else throw invalidOutput(child);
    }
    return files;
}

export function validateRpgOutput(
    plan: RpgApplyPlan, completed: string, originals: Map<string, string>, translations: RpgTranslation[], useYaml: boolean,
): ReturnType<typeof inspectRpgProject> {
    const byFile = new Map<string, RpgTranslation[]>();
    for (const translation of translations) {
        const list = byFile.get(translation.file) ?? [];
        list.push(translation); byFile.set(translation.file, list);
    }
    const allowedOutputs = new Set(Array.from(plan.backups.keys(), file => outputPath(file, useYaml)));
    const merged = makeStagingDir(plan.dataRoot, '.tsukuru-rpg-validation');
    try {
        fs.mkdirSync(path.join(merged, 'Backup'));
        for (const entry of fs.readdirSync(plan.backupRoot, { withFileTypes: true })) {
            if (!entry.name.endsWith('.json') || entry.name.startsWith('._')) continue;
            const source = safeChild(plan.backupRoot, entry.name);
            if (!entry.isFile()) throw invalidOutput(entry.name);
            fs.copyFileSync(source, path.join(merged, entry.name));
            fs.copyFileSync(source, path.join(merged, 'Backup', entry.name));
        }
        for (const relative of regularFiles(completed)) {
            if (!['data', 'js', 'img', 'audio'].includes(relative.split('/')[0])) throw invalidOutput(relative);
            if ((relative.startsWith('data/') || relative.startsWith('js/')) && !allowedOutputs.has(relative)) throw invalidOutput(relative);
        }
        for (const [file, expected] of plan.backups) {
            let actual: unknown;
            try {
                const text = readText(completed, outputPath(file, useYaml));
                if (file === 'ext_plugins.json') actual = parsePluginOutput(text, expected, originals.get(file)!, plan);
                else if (file === 'ExternMsgcsv.json') actual = parseRpgMessageCsv(text, true);
                else actual = useYaml ? yaml.load(text) : JSON.parse(text);
                assertAllowedChanges(file, JSON.parse(originals.get(file)!), actual, byFile.get(file) ?? []);
            } catch (error) {
                if (error instanceof OperationError && error.code === ErrorCodes.VERIFY_FAILED) throw error;
                throw invalidOutput(file);
            }
            fs.writeFileSync(path.join(merged, file), JSON.stringify(actual));
        }
        const validation = inspectRpgProject(merged, { entries: [] });
        validation.entriesChecked = translations.length;
        validation.validEntries = translations.length;
        if (!validation.ok) throw new OperationError(ErrorCodes.VERIFY_FAILED, 'RPG 최종 구조 검사에 실패했습니다', { validation });
        return validation;
    } finally { removePathBestEffortSync(merged, { recursive: true, force: true }); }
}

/** GUI legacy mode keeps its destination semantics, but publishes only fully validated files. */
export function publishLegacyRpgOutput(plan: RpgApplyPlan, completed: string, useYaml: boolean): Map<string, string> {
    const replacements: ArtifactReplacement[] = [];
    const installedPaths = new Map<string, string>();
    const createdDirectories: string[] = [];
    let committed = false;
    try {
        for (const relative of regularFiles(completed)) {
            const [area, ...segments] = relative.split('/');
            if (!['data', 'js', 'img', 'audio'].includes(area)) throw invalidOutput(relative);
            const targetRoot = area === 'data' ? plan.dataRoot : path.join(path.dirname(plan.dataRoot), area);
            const target = safeChild(targetRoot, segments.join('/'));
            let parent = path.dirname(target);
            const missing: string[] = [];
            if (findLinkedPathComponent(parent)) throw invalidOutput(relative);
            while (!fs.existsSync(parent)) { missing.push(parent); parent = path.dirname(parent); }
            for (const dir of missing.reverse()) { fs.mkdirSync(dir); createdDirectories.push(dir); }
            const staged = safeChild(completed, relative);
            replacements.push({ staged, target });
            installedPaths.set(staged, target);
        }
        for (const file of plan.backups.keys()) {
            if (file === 'ext_plugins.json' || file === 'ExternMsgcsv.json') continue;
            const counterpart = safeChild(plan.dataRoot, useYaml ? file : `${file}.yaml`);
            if (fs.existsSync(counterpart)) replacements.push({ remove: true, target: counterpart });
        }
        replaceArtifactPathsSync(replacements);
        committed = true;
        return installedPaths;
    } finally {
        if (!committed) for (const dir of createdDirectories.reverse()) {
            try { fs.rmdirSync(dir); } catch { /* Keep nonempty recoverable directories. */ }
        }
    }
}
