/** Backward-compatible import path for the versioned container provenance policy. */
export {
    CONTAINER_PROVENANCE_FILE,
    createContainerProvenance,
    readContainerProvenance,
    writeContainerProvenance,
} from './container/provenance';
export type { ContainerProvenance } from './container/provenance';
