import fs from 'fs';
import path from 'path';
import { throwIfSignalAborted } from '../core/operationRuntime';
import { WorkspaceTransaction } from '../core/workspaceTransaction';

export interface VersionPortRequest {
  translatedRoot: string;
  oldRoot: string;
  newRoot: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export interface VersionPortResult {
  filesScanned: number;
  filesChanged: number;
  replacements: number;
}

interface PlannedFile {
  name: string;
  output: string;
  replacements: number;
}

const MAX_FILES = 100_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const TRANSLATABLE_EXTENSIONS = new Set(['.txt', '.csv', '.yaml', '.yml']);

function containedBy(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function resolveExtractRoot(root: string, label: string): string {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) {
    throw new Error(`${label} workspace must be an absolute local path`);
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = fs.realpathSync(root);
    if (!fs.statSync(canonicalRoot).isDirectory()) throw new Error('not directory');
  } catch {
    throw new Error(`${label} workspace does not exist`);
  }
  const extract = path.join(canonicalRoot, 'Extract');
  if (!fs.existsSync(extract) || fs.lstatSync(extract).isSymbolicLink() || !fs.statSync(extract).isDirectory()) {
    throw new Error(`${label} Extract directory does not exist or is unsafe`);
  }
  const canonicalExtract = fs.realpathSync(extract);
  if (!containedBy(canonicalRoot, canonicalExtract)) throw new Error(`${label} Extract directory escapes its workspace`);
  return canonicalExtract;
}

function assertSafeTree(root: string, signal?: AbortSignal): void {
  let files = 0;
  let bytes = 0;
  const visit = (directory: string): void => {
    throwIfSignalAborted(signal, 'version-port:scan');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      throwIfSignalAborted(signal, 'version-port:scan');
      const candidate = path.join(directory, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error('Version workspace must not contain symbolic links');
      if (stat.isDirectory()) visit(candidate);
      else if (stat.isFile()) {
        files += 1;
        bytes += stat.size;
        if (files > MAX_FILES) throw new Error('Version workspace exceeds the file count limit');
        if (stat.size > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES) {
          throw new Error('Version workspace exceeds the size limit');
        }
      } else {
        throw new Error('Version workspace contains an unsupported filesystem entry');
      }
    }
  };
  visit(root);
}

function copySafeTree(root: string, target: string, signal?: AbortSignal): void {
  let files = 0;
  let bytes = 0;
  fs.cpSync(root, target, {
    recursive: true,
    filter: (candidate) => {
      throwIfSignalAborted(signal, 'version-port:stage');
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error('Version workspace must not contain symbolic links');
      if (stat.isDirectory()) return true;
      if (!stat.isFile()) throw new Error('Version workspace contains an unsupported filesystem entry');
      files += 1;
      bytes += stat.size;
      if (files > MAX_FILES) throw new Error('Version workspace exceeds the file count limit');
      if (stat.size > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES) {
        throw new Error('Version workspace exceeds the size limit');
      }
      return true;
    },
  });
}

function readBoundedText(filePath: string, label: string): string {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FILE_BYTES) {
    throw new Error(`${label} is not a safe regular file`);
  }
  const contents = fs.readFileSync(filePath);
  if (contents.includes(0)) throw new Error(`${label} is not a text file`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(contents);
  } catch {
    throw new Error(`${label} is not valid UTF-8 text`);
  }
}

function sameCanonicalPath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

export function portVersionTranslationsAtomic(request: VersionPortRequest): VersionPortResult {
  throwIfSignalAborted(request.signal, 'version-port:validate');
  const translatedExtract = resolveExtractRoot(request.translatedRoot, 'Translated');
  const oldExtract = resolveExtractRoot(request.oldRoot, 'Old');
  const newExtract = resolveExtractRoot(request.newRoot, 'New');
  if (sameCanonicalPath(translatedExtract, oldExtract) ||
      sameCanonicalPath(translatedExtract, newExtract) ||
      sameCanonicalPath(oldExtract, newExtract)) {
    throw new Error('Version port workspaces must be distinct');
  }

  assertSafeTree(translatedExtract, request.signal);
  assertSafeTree(oldExtract, request.signal);
  assertSafeTree(newExtract, request.signal);
  const sourceFiles = fs.readdirSync(oldExtract, { withFileTypes: true })
    .filter((entry) => entry.isFile() && TRANSLATABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (sourceFiles.length === 0) throw new Error('Old Extract contains no translatable files');

  const planned: PlannedFile[] = [];
  let totalReplacements = 0;
  for (const name of sourceFiles) {
    throwIfSignalAborted(request.signal, 'version-port:plan');
    const oldFile = path.join(oldExtract, name);
    const translatedFile = path.join(translatedExtract, name);
    const newFile = path.join(newExtract, name);
    if (!fs.existsSync(translatedFile)) throw new Error(`Translated Extract file is missing: ${name}`);
    if (!fs.existsSync(newFile)) throw new Error(`New Extract file is missing: ${name}`);

    const oldLines = readBoundedText(oldFile, `Old Extract/${name}`).split('\n');
    const translatedLines = readBoundedText(translatedFile, `Translated Extract/${name}`).split('\n');
    if (oldLines.length !== translatedLines.length) {
      throw new Error(`Translated Extract line count differs from old Extract: ${name}`);
    }
    const dictionary = new Map<string, string>();
    for (let index = 0; index < oldLines.length; index += 1) {
      const source = oldLines[index];
      const translated = translatedLines[index];
      if (source === translated) continue;
      const previous = dictionary.get(source);
      if (previous !== undefined && previous !== translated) {
        throw new Error(`Translated Extract has conflicting translations: ${name}`);
      }
      dictionary.set(source, translated);
    }

    const newLines = readBoundedText(newFile, `New Extract/${name}`).split('\n');
    let replacements = 0;
    for (let index = 0; index < newLines.length; index += 1) {
      const translated = dictionary.get(newLines[index]);
      if (translated === undefined) continue;
      newLines[index] = translated;
      replacements += 1;
    }
    totalReplacements += replacements;
    planned.push({ name, output: newLines.join('\n'), replacements });
  }

  const transaction = new WorkspaceTransaction({
    outputPath: newExtract,
    force: true,
    signal: request.signal,
  });
  try {
    copySafeTree(newExtract, transaction.stagingPath, request.signal);
    throwIfSignalAborted(request.signal, 'version-port:stage');
    for (let index = 0; index < planned.length; index += 1) {
      throwIfSignalAborted(request.signal, 'version-port:transform');
      const file = planned[index];
      if (file.replacements > 0) fs.writeFileSync(path.join(transaction.stagingPath, file.name), file.output, 'utf8');
      request.onProgress?.((index + 1) / planned.length * 100);
    }
    throwIfSignalAborted(request.signal, 'version-port:commit');
    transaction.commit();
  } finally {
    transaction.dispose();
  }

  return {
    filesScanned: planned.length,
    filesChanged: planned.filter((file) => file.replacements > 0).length,
    replacements: totalReplacements,
  };
}
