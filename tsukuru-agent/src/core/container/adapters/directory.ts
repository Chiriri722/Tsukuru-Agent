import { detectContainerEngine, findNestedEngineRoot } from '../engineDetection';
import { assertNoSymbolicLinks, copyTreeWithoutLinks, walkContainerFiles } from '../fileSystemPolicy';
import {
    ContainerFormatAdapter,
    ContainerInfo,
    ContainerLimits,
    DEFAULT_CONTAINER_LIMITS,
} from '../types';

function inspectDirectory(rootPath: string, _ignoredRoot: string, limits: ContainerLimits = {}): ContainerInfo {
    const entries = walkContainerFiles(rootPath, '', limits.maxFiles ?? DEFAULT_CONTAINER_LIMITS.maxFiles);
    const root = findNestedEngineRoot(entries);
    return {
        type: 'directory',
        rootPath,
        archivePath: null,
        unpackedPath: null,
        packagePath: null,
        archive: null,
        engine: detectContainerEngine(entries, root),
        entries,
    };
}

async function extractDirectory(info: ContainerInfo, stagingDir: string): Promise<void> {
    copyTreeWithoutLinks(info.rootPath, stagingDir);
}

async function packDirectory(_info: ContainerInfo, stagingDir: string, outputPath: string): Promise<void> {
    copyTreeWithoutLinks(stagingDir, outputPath);
}

export const directoryContainerAdapter: ContainerFormatAdapter = Object.freeze({
    type: 'directory',
    inspect: inspectDirectory,
    assertExtractable: (info) => assertNoSymbolicLinks(info.rootPath),
    extract: extractDirectory,
    pack: packDirectory,
    copyExternalResources: () => undefined,
});
