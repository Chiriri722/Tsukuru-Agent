import fs from 'fs';
import path from 'path';
import { removePathBestEffortSync } from '../atomic';
import { findLinkedPathComponent } from '../pathSafety';
import { assertOutsidePath, normalizeArchiveEntry } from './archivePolicy';
import { assertNoSymbolicLinks, isDirectory, prepareEmptyDirectory } from './fileSystemPolicy';
import { inspectContainer } from './inspect';
import { getContainerAdapter } from './registry';
import { ContainerAdapter, ContainerInfo } from './types';

function attachCleanupError(primaryError: unknown, cleanupErrors: Error[]): void {
    if (!(primaryError instanceof Error) || cleanupErrors.length === 0) return;
    try {
        Object.defineProperty(primaryError, 'cleanupError', {
            value: cleanupErrors.length === 1 ? cleanupErrors[0] : cleanupErrors,
            enumerable: false,
            configurable: true,
        });
    } catch { /* 최초 작업 오류를 그대로 보존한다. */ }
}

function cleanupFailedPaths(paths: readonly string[], primaryError: unknown): void {
    const cleanupErrors = paths
        .map((candidate) => removePathBestEffortSync(candidate, { recursive: true, force: true }))
        .filter((error): error is Error => error !== undefined);
    attachCleanupError(primaryError, cleanupErrors);
}

function containerOutputArtifacts(info: ContainerInfo, output: string): string[] {
    return info.type === 'electron-asar' ? [output, output + '.unpacked'] : [output];
}

function assertNoLinkedPathComponents(candidate: string, label: string): void {
    const linkedPath = findLinkedPathComponent(candidate);
    if (linkedPath) throw new Error(`${label} 경로에 심볼릭 링크/정션이 있습니다: ${linkedPath}`);
}

export async function extractContainer(info: ContainerInfo, stagingDir: string): Promise<void> {
    assertOutsidePath(info.rootPath, stagingDir, 'staging');
    assertNoLinkedPathComponents(stagingDir, 'staging');
    const adapter = getContainerAdapter(info.type);
    adapter.assertExtractable(info);
    prepareEmptyDirectory(stagingDir);
    try {
        await adapter.extract(info, stagingDir);
    } catch (error) {
        cleanupFailedPaths([stagingDir], error);
        throw error;
    }
}

export async function packContainer(info: ContainerInfo, stagingDir: string, outputPath: string): Promise<void> {
    if (!isDirectory(stagingDir)) throw new Error('staging 디렉터리가 없습니다: ' + stagingDir);
    assertNoLinkedPathComponents(stagingDir, 'staging');
    assertNoSymbolicLinks(stagingDir);
    const output = path.resolve(outputPath);
    assertOutsidePath(stagingDir, output, 'output');
    assertOutsidePath(info.rootPath, output, 'output');
    assertNoLinkedPathComponents(output, 'output');
    if (info.archivePath && output === path.resolve(info.archivePath)) throw new Error('원본 archive에 직접 pack할 수 없습니다');
    const outputArtifacts = containerOutputArtifacts(info, output);
    const existingArtifact = outputArtifacts.find((candidate) => fs.existsSync(candidate));
    if (existingArtifact) throw new Error('출력 파일/디렉터리가 이미 존재합니다: ' + existingArtifact);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    try {
        await getContainerAdapter(info.type).pack(info, stagingDir, output);
    } catch (error) {
        cleanupFailedPaths(outputArtifacts, error);
        throw error;
    }
}

export function copyExternalResources(info: ContainerInfo, outputRoot: string): void {
    if (info.type === 'unknown') return;
    getContainerAdapter(info.type).copyExternalResources(info, outputRoot);
}

export function verifyContainerOutput(outputPath: string, requiredEntries: string[] = []): ContainerInfo {
    const info = inspectContainer(outputPath);
    const entries = info.archive?.entries ?? info.entries;
    const missing = requiredEntries.map(normalizeArchiveEntry).filter((entry) => !entries.includes(entry));
    if (missing.length > 0) throw new Error('출력 컨테이너 필수 항목이 없습니다: ' + missing.join(', '));
    return info;
}

class RegisteredContainer implements ContainerAdapter {
    protected readonly info: ContainerInfo;

    constructor(sourcePath: string) {
        this.info = inspectContainer(sourcePath);
    }

    inspect(): ContainerInfo { return this.info; }
    extractTo(stagingDir: string): Promise<void> { return extractContainer(this.info, stagingDir); }
    packFrom(stagingDir: string, outputPath: string): Promise<void> { return packContainer(this.info, stagingDir, outputPath); }
    copyUnpacked(outputRoot: string): void { copyExternalResources(this.info, outputRoot); }
    verifyOutput(outputPath: string, requiredEntries: string[] = []): ContainerInfo {
        return verifyContainerOutput(outputPath, requiredEntries);
    }
}

export class AsarContainer extends RegisteredContainer {}
export class DirectoryContainer extends RegisteredContainer {}
export class NwjsContainer extends RegisteredContainer {}
