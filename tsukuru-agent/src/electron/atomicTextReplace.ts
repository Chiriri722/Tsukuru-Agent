import fs from 'fs';
import path from 'path';
import { throwIfSignalAborted } from '../core/operationRuntime';
import { WorkspaceTransaction } from '../core/workspaceTransaction';

export interface AtomicTextReplaceResult {
  filesScanned: number;
  filesChanged: number;
  replacements: number;
}

export interface AtomicTextReplaceOptions {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

const MAX_FILES = 100_000;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

function containedBy(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function listRegularFiles(root: string, signal?: AbortSignal): string[] {
  const files: string[] = [];
  let totalBytes = 0;
  const visit = (directory: string): void => {
    throwIfSignalAborted(signal, 'change-all-strings:scan');
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      throwIfSignalAborted(signal, 'change-all-strings:scan');
      const filePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) throw new Error('Extract workspace must not contain symbolic links');
      if (stat.isDirectory()) visit(filePath);
      else if (stat.isFile()) {
        if (stat.size > MAX_FILE_BYTES) throw new Error('Extract workspace contains an oversized file');
        totalBytes += stat.size;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Extract workspace exceeds the total size limit');
        files.push(filePath);
        if (files.length > MAX_FILES) throw new Error('Extract workspace exceeds the file count limit');
      } else {
        throw new Error('Extract workspace contains an unsupported filesystem entry');
      }
    }
  };
  visit(root);
  return files;
}

function copyRegularTree(root: string, target: string, signal?: AbortSignal): void {
  let files = 0;
  let totalBytes = 0;
  fs.cpSync(root, target, {
    recursive: true,
    filter: (candidate) => {
      throwIfSignalAborted(signal, 'change-all-strings:stage');
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error('Extract workspace must not contain symbolic links');
      if (stat.isDirectory()) return true;
      if (!stat.isFile()) throw new Error('Extract workspace contains an unsupported filesystem entry');
      files += 1;
      totalBytes += stat.size;
      if (files > MAX_FILES) throw new Error('Extract workspace exceeds the file count limit');
      if (stat.size > MAX_FILE_BYTES) throw new Error('Extract workspace contains an oversized file');
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Extract workspace exceeds the total size limit');
      return true;
    },
  });
}

function decodeText(buffer: Buffer): string | undefined {
  if (buffer.includes(0)) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
}

export function replaceAllStringsAtomic(
  dataRoot: string,
  search: string,
  replacement: string,
  options: AtomicTextReplaceOptions = {},
): AtomicTextReplaceResult {
  throwIfSignalAborted(options.signal, 'change-all-strings:validate');
  if (typeof search !== 'string' || search.length === 0) throw new Error('Search string must not be empty');
  if (typeof replacement !== 'string') throw new Error('Replacement must be a string');
  if (search === replacement) throw new Error('Search and replacement strings must be different');
  if (!path.isAbsolute(dataRoot) || dataRoot.includes('\0')) throw new Error('Workspace root must be an absolute local path');

  let canonicalRoot: string;
  try {
    canonicalRoot = fs.realpathSync(dataRoot);
    if (!fs.statSync(canonicalRoot).isDirectory()) throw new Error('not directory');
  } catch {
    throw new Error('Workspace root directory does not exist');
  }
  const extractPath = path.join(canonicalRoot, 'Extract');
  if (!fs.existsSync(extractPath) || !fs.statSync(extractPath).isDirectory() || fs.lstatSync(extractPath).isSymbolicLink()) {
    throw new Error('Extract directory does not exist or is not a regular directory');
  }
  const canonicalExtract = fs.realpathSync(extractPath);
  if (!containedBy(canonicalRoot, canonicalExtract)) throw new Error('Extract directory escapes the workspace root');

  const sourceFiles = listRegularFiles(canonicalExtract, options.signal);
  const transaction = new WorkspaceTransaction({
    outputPath: canonicalExtract,
    force: true,
    signal: options.signal,
  });
  const result: AtomicTextReplaceResult = { filesScanned: sourceFiles.length, filesChanged: 0, replacements: 0 };

  try {
    copyRegularTree(canonicalExtract, transaction.stagingPath, options.signal);
    throwIfSignalAborted(options.signal, 'change-all-strings:stage');
    for (let index = 0; index < sourceFiles.length; index += 1) {
      throwIfSignalAborted(options.signal, 'change-all-strings:transform');
      const sourceFile = sourceFiles[index];
      const relative = path.relative(canonicalExtract, sourceFile);
      const stagedFile = path.join(transaction.stagingPath, relative);
      const text = decodeText(fs.readFileSync(stagedFile));
      if (text === undefined || !text.includes(search)) continue;
      const occurrences = text.split(search).length - 1;
      fs.writeFileSync(stagedFile, text.replaceAll(search, replacement), 'utf8');
      result.filesChanged += 1;
      result.replacements += occurrences;
      options.onProgress?.((index + 1) / sourceFiles.length * 100);
    }

    throwIfSignalAborted(options.signal, 'change-all-strings:commit');
    transaction.commit();
    return result;
  } finally {
    transaction.dispose();
  }
}
