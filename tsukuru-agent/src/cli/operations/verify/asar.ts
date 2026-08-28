import path from 'path';
import { inspectElectronRuntime } from '../../../core/runtimeDiagnostics';
import { AgentRequest, AgentResult } from '../../../core/schema';
import { ErrorCodes, OperationError } from '../../../core/types';
import { scoreVerification } from '../../../core/validator';
import { DetectedProject } from '../../formatDetect';
import { writeHumanSummary } from '../../presenter';
import { emptyChange, publicScores } from './common';

export async function verifyAsarContainer(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
): Promise<void> {
    const container = detected.container;
    if (!container || container.type !== 'electron-asar') {
        throw new OperationError(ErrorCodes.NOT_IMPLEMENTED, 'Electron ASAR 검증기에 ASAR가 아닌 입력이 전달되었습니다');
    }
    const archive = container.archive;
    const runtime = container.archivePath
        ? await inspectElectronRuntime(
            container.rootPath,
            container.archivePath,
            path.relative(container.rootPath, container.archivePath),
        )
        : undefined;
    result.runtime = runtime;
    let containerIntegrity = archive && archive.fileCount > 0 && archive.integrity !== 'unreadable'
        ? (archive.invalidEntryCount > 0 ? 70 : 100)
        : 50;
    if (runtime?.blocked) containerIntegrity = 0;
    else if (runtime?.signature?.status === 'hash-mismatch') containerIntegrity = Math.min(containerIntegrity, 40);
    const critical = container.engine.type === 'unknown' ? ['engine-unknown'] : [];
    if (runtime?.blocked) critical.push('electron-asar-integrity-mismatch');
    if (runtime?.signature?.status === 'hash-mismatch') critical.push('authenticode-hash-mismatch');
    const scores = scoreVerification({
        extractionCoverage: 0,
        mappingIntegrity: 0,
        reinsertionValidity: 0,
        protectedScriptIntegrity: 50,
        containerIntegrity,
        critical,
    });
    result.scores = publicScores(scores);
    result.change = emptyChange();
    result.stats = { entries: archive?.fileCount ?? 0, score: scores.total };
    result.warnings = [
        'ASAR 컨테이너는 식별되었지만 추출 산출물은 아직 없습니다',
        ...(runtime?.warnings ?? []),
    ];
    result.ok = false;
    result.error = {
        code: ErrorCodes.VERIFY_FAILED,
        message: '검증 실패: ASAR 추출 산출물이 없습니다',
        details: result.warnings,
    };
    if (request.options.humanSummary === true) {
        writeHumanSummary(result, { protectedMetric: 'damage', damageAssessed: false });
    }
}
