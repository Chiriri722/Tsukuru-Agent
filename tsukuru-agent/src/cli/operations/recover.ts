import { AgentRequest, AgentResult } from '../../core/schema';
import { ErrorCodes, OperationError } from '../../core/types';
import * as edTool from '../../js/rpgmv/edtool';
import { DetectedProject } from '../formatDetect';
import { recoverRpgManifest } from '../manifestRecovery';

/** .extracteddata와 현재 Extract 텍스트를 기준으로 RPG manifest를 재구축한다. */
export async function handleRecover(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
): Promise<void> {
    if ((detected.container && detected.container.type !== 'directory')
        || (detected.format !== 'rpgmv' && detected.format !== 'rpgmz')) {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            'manifest 복구는 느슨한 RPG MV/MZ 추출 팩만 지원합니다',
            { format: detected.format },
        );
    }
    let extracted;
    try {
        extracted = edTool.read(detected.dataDir);
    } catch (error) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, '.extracteddata를 읽을 수 없습니다', {
            message: error instanceof Error ? error.message : String(error),
        });
    }
    const outcome = recoverRpgManifest(detected.dataDir, extracted.main, {
        dryRun: request.options.dryRun === true,
        conflictPolicy: request.options.conflictPolicy,
    });
    result.ok = true;
    result.artifacts = outcome.dryRun
        ? []
        : [outcome.manifestPath, ...(outcome.backupPath ? [outcome.backupPath] : [])];
    result.stats = {
        entries: outcome.entries,
        files: outcome.files,
        hashesUpdated: outcome.hashesUpdated,
        ...(outcome.dryRun || request.options.conflictPolicy
            ? {
                dryRun: outcome.dryRun,
                conflictPolicy: outcome.conflictPolicy,
                wouldReplaceExisting: outcome.wouldReplaceExisting,
                wouldConflict: outcome.wouldConflict,
                plannedManifestPath: outcome.manifestPath,
                ...(outcome.plannedBackupPath ? { plannedBackupPath: outcome.plannedBackupPath } : {}),
            }
            : {}),
    };
}
