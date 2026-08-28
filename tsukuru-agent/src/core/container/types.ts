export type ContainerType = 'directory' | 'electron-asar' | 'nwjs-package' | 'unknown';
export type SupportedContainerType = Exclude<ContainerType, 'unknown'>;
export type EngineType = 'rpgmv' | 'rpgmz' | 'wolf' | 'tyrano' | 'gdevelop' | 'unknown';

export interface ContainerLimits {
    maxFiles?: number;
    maxBytes?: number;
    maxFileBytes?: number;
}

export const DEFAULT_CONTAINER_LIMITS: Readonly<Required<ContainerLimits>> = Object.freeze({
    maxFiles: 20000,
    maxBytes: 8 * 1024 * 1024 * 1024,
    maxFileBytes: 2 * 1024 * 1024 * 1024,
});

export interface ArchiveInspection {
    path: string;
    entries: string[];
    fileEntries: string[];
    fileCount: number;
    directoryCount: number;
    totalBytes: number;
    sha256: string;
    integrity: 'present' | 'absent' | 'unreadable';
    invalidEntryCount: number;
    invalidEntries: string[];
    unsafeLinkCount: number;
    unpackedEntries: string[];
    appendedZip?: import('./nwjsAppendedZip').NwAppendedZipInspection;
}

export interface EngineDetection {
    type: EngineType;
    root: string;
    wrapper: string | null;
    features: string[];
    confidence: number;
}

export interface ContainerInfo {
    type: ContainerType;
    rootPath: string;
    archivePath: string | null;
    unpackedPath: string | null;
    packagePath: string | null;
    archive: ArchiveInspection | null;
    engine: EngineDetection;
    entries: string[];
}

export interface ContainerFormatAdapter {
    readonly type: SupportedContainerType;
    inspect(sourcePath: string, rootPath: string, limits?: ContainerLimits): ContainerInfo;
    assertExtractable(info: ContainerInfo): void;
    extract(info: ContainerInfo, stagingDir: string): Promise<void>;
    pack(info: ContainerInfo, stagingDir: string, outputPath: string): Promise<void>;
    copyExternalResources(info: ContainerInfo, outputRoot: string): void;
}

export interface ContainerAdapter {
    inspect(): ContainerInfo;
    extractTo(stagingDir: string): Promise<void>;
    packFrom(stagingDir: string, outputPath: string): Promise<void>;
    copyUnpacked(outputRoot: string): void;
    verifyOutput(outputPath: string, requiredEntries?: string[]): ContainerInfo;
}

export function effectiveContainerLimits(limits: ContainerLimits = {}): Required<ContainerLimits> {
    return { ...DEFAULT_CONTAINER_LIMITS, ...limits };
}

export function unknownContainerInfo(inputPath: string): ContainerInfo {
    return {
        type: 'unknown',
        rootPath: inputPath,
        archivePath: null,
        unpackedPath: null,
        packagePath: null,
        archive: null,
        engine: { type: 'unknown', root: '', wrapper: null, features: [], confidence: 0 },
        entries: [],
    };
}
