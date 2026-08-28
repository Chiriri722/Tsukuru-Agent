import fs from 'fs';
import path from 'path';
import { findLinkedPathComponent } from '../pathSafety';
import { detectContainerEngine, findNestedEngineRoot } from './engineDetection';
import { isDirectory, isFile, walkContainerFiles } from './fileSystemPolicy';
import { containerAdapterRegistry } from './registry';
import { inspectNwAppendedZip } from './nwjsAppendedZip';
import {
    ContainerInfo,
    ContainerLimits,
    DEFAULT_CONTAINER_LIMITS,
    unknownContainerInfo,
} from './types';

function containerRootForArchive(archivePath: string): string {
    return path.basename(path.dirname(archivePath)).toLowerCase() === 'resources'
        ? path.dirname(path.dirname(archivePath))
        : path.dirname(archivePath);
}

export function inspectContainer(projectPath: string, limits: ContainerLimits = {}): ContainerInfo {
    const resolved = path.resolve(projectPath);
    const linkedPath = findLinkedPathComponent(resolved);
    if (linkedPath) throw new Error('컨테이너 경로에 심볼릭 링크/정션이 있습니다: ' + linkedPath);
    if (isFile(resolved)) {
        if (path.extname(resolved).toLowerCase() === '.asar' || path.basename(resolved).toLowerCase() === 'app.asar') {
            return containerAdapterRegistry['electron-asar'].inspect(resolved, containerRootForArchive(resolved), limits);
        }
        if (path.extname(resolved).toLowerCase() === '.nw' || path.basename(resolved).toLowerCase() === 'package.nw') {
            return containerAdapterRegistry['nwjs-package'].inspect(resolved, containerRootForArchive(resolved), limits);
        }
        if (path.extname(resolved).toLowerCase() === '.exe' && inspectNwAppendedZip(resolved)) {
            return containerAdapterRegistry['nwjs-package'].inspect(resolved, path.dirname(resolved), limits);
        }
        return unknownContainerInfo(path.dirname(resolved));
    }
    if (!isDirectory(resolved)) throw new Error('경로가 없습니다: ' + resolved);

    if (path.basename(resolved).toLowerCase() === 'package.nw') {
        return containerAdapterRegistry['nwjs-package'].inspect(resolved, containerRootForArchive(resolved), limits);
    }

    const archivePath = [
        path.join(resolved, 'resources', 'app.asar'),
        path.join(resolved, 'app.asar'),
    ].find((candidate) => isFile(candidate));
    if (archivePath) return containerAdapterRegistry['electron-asar'].inspect(archivePath, resolved, limits);

    const packagePath = [
        path.join(resolved, 'package.nw'),
        path.join(resolved, 'resources', 'package.nw'),
    ].find((candidate) => isFile(candidate) || isDirectory(candidate)) ?? null;
    if (packagePath) {
        try {
            return containerAdapterRegistry['nwjs-package'].inspect(packagePath, resolved, limits);
        } catch {
            const entries = walkContainerFiles(resolved, '', limits.maxFiles ?? DEFAULT_CONTAINER_LIMITS.maxFiles);
            const engine = detectContainerEngine(entries, findNestedEngineRoot(entries));
            engine.wrapper = 'nwjs';
            engine.features.push('nwjs-package-unreadable');
            return {
                type: 'nwjs-package',
                rootPath: resolved,
                archivePath: packagePath,
                unpackedPath: null,
                packagePath,
                archive: null,
                engine,
                entries,
            };
        }
    }
    const appendedCandidates: ContainerInfo[] = [];
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })
        .filter((candidate) => candidate.isFile() && path.extname(candidate.name).toLowerCase() === '.exe')
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const candidate = path.join(resolved, entry.name);
        try {
            if (!inspectNwAppendedZip(candidate)) continue;
            const info = containerAdapterRegistry['nwjs-package'].inspect(candidate, resolved, limits);
            if (info.archive?.entries.some((archiveEntry) => archiveEntry.toLowerCase() === 'package.json')) {
                appendedCandidates.push(info);
            }
        } catch {
            // A malformed or oversized executable remains outside automatic mutation support.
        }
    }
    if (appendedCandidates.length === 1) return appendedCandidates[0];
    if (appendedCandidates.length > 1) {
        const entries = walkContainerFiles(resolved, '', limits.maxFiles ?? DEFAULT_CONTAINER_LIMITS.maxFiles);
        const engine = detectContainerEngine(entries, findNestedEngineRoot(entries));
        engine.wrapper = 'nwjs';
        engine.features.push('nwjs-appended-zip-ambiguous');
        return {
            type: 'nwjs-package',
            rootPath: resolved,
            archivePath: null,
            unpackedPath: null,
            packagePath: null,
            archive: null,
            engine,
            entries,
        };
    }
    return containerAdapterRegistry.directory.inspect(resolved, resolved, limits);
}
