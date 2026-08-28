/**
 * Backward-compatible container API.
 *
 * Detection, common archive policy, format adapters, and lifecycle operations
 * live under ./container. Existing imports remain stable through this barrel.
 */
export {
    archiveEntryCollisionKey,
    isUnsafeArchiveEntry,
} from './container/archivePolicy';
export { inspectContainer } from './container/inspect';
export {
    AsarContainer,
    copyExternalResources,
    DirectoryContainer,
    extractContainer,
    NwjsContainer,
    packContainer,
    verifyContainerOutput,
} from './container/operations';
export {
    CONTAINER_PROVENANCE_FILE,
    createContainerProvenance,
    readContainerProvenance,
    writeContainerProvenance,
} from './container/provenance';
export { containerAdapterRegistry, getContainerAdapter } from './container/registry';

export type {
    ArchiveInspection,
    ContainerAdapter,
    ContainerFormatAdapter,
    ContainerInfo,
    ContainerLimits,
    ContainerType,
    EngineDetection,
    EngineType,
    SupportedContainerType,
} from './container/types';
export type { ContainerProvenance } from './container/provenance';
