import { AgentRequest, AgentResult } from '../../core/schema';
import { ErrorCodes, OperationError } from '../../core/types';
import { selectEngineAdapter } from '../engineRegistry';
import { DetectedProject } from '../formatDetect';
import { verifyAsarContainer } from './verify/asar';
import { VerifyEngineHandler } from './verify/common';
import { verifyGdevelop } from './verify/gdevelop';
import { verifyManifestProject } from './verify/manifest';
import { verifyTyrano } from './verify/tyrano';

type VerifyEngineFamily = 'rpgmaker' | 'wolf' | 'tyrano' | 'gdevelop' | 'nwjs';

export const engineVerifyHandlerRegistry: Readonly<Record<VerifyEngineFamily, VerifyEngineHandler>> = Object.freeze({
    rpgmaker: verifyManifestProject,
    wolf: verifyManifestProject,
    tyrano: verifyTyrano,
    gdevelop: verifyGdevelop,
    nwjs: verifyManifestProject,
});

/** 포맷·경로·manifest·매핑·출력 조건을 읽기 전용으로 검사한다. */
export async function handleVerify(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
): Promise<void> {
    const engine = selectEngineAdapter(detected);
    if (!engine.operations.includes('verify')) {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            `현재 엔진 프로파일은 검증을 지원하지 않습니다: ${detected.format}`,
            { format: detected.format },
        );
    }
    if (detected.container?.type === 'electron-asar') {
        await verifyAsarContainer(request, detected, result);
        return;
    }
    const engineHandler = engineVerifyHandlerRegistry[engine.family as VerifyEngineFamily];
    if (!engineHandler) {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            `현재 엔진 프로파일은 검증을 지원하지 않습니다: ${detected.format}`,
            { format: detected.format },
        );
    }
    await engineHandler(request, detected, result);
}
