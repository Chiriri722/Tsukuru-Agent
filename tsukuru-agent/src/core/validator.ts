/**
 * Backward-compatible validation API.
 *
 * Engine inspection, report policy, scoring, protected-path policy, and file-map
 * comparison live in focused modules under ./validation. Existing callers keep
 * importing this barrel while new code may depend on the narrower modules.
 */
import { matchesProtectedPath } from './validation/protectedPaths';

export { inspectRpgProject } from './validation/engines/rpg';
export { inspectTyranoProject } from './validation/engines/tyrano';
export { inspectWolfBinaryMappings } from './validation/engines/wolf';
export { diffFileMaps, snapshotDirectory } from './validation/fileMap';
export { calculateVerificationScore as scoreVerification } from './validation/scoring';

export function isProtectedPath(filePath: string): boolean {
    return matchesProtectedPath(filePath);
}

export type {
    FileDiff,
    FileMapEntry,
    ScoreInput,
    ScoreResult,
    StructuralIssue,
    StructuralIssueSeverity,
    StructuralValidationReport,
} from './validation/types';
