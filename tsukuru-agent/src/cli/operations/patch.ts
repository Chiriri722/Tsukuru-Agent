import path from 'path';
import { AgentRequest, AgentResult } from '../../core/schema';
import { MANIFEST_FILE } from '../../core/manifest';
import { loadRpgTranslationDictionary, TranslationDictionaryOutcome } from '../../core/translationDictionary';
import { ErrorCodes, OperationError } from '../../core/types';
import { DetectedProject } from '../formatDetect';
import { patchWorkspacePath } from '../enginePaths';
import { selectEngineAdapter } from '../engineRegistry';
import { applyPatches } from '../patcher';

/** manifest ID·hash 검증 후 추출 작업본만 수정하고 줄 매핑을 재생성한다. */
export async function handlePatch(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
): Promise<void> {
    if (detected.container?.type === 'electron-asar') {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            '원본 ASAR 직접 패치는 아직 지원하지 않습니다. 먼저 별도 작업 디렉터리로 추출하세요',
            { format: detected.format },
        );
    }
    const engine = selectEngineAdapter(detected);
    if (!engine.operations.includes('patch') || engine.patchFormat === null) {
        throw new OperationError(
            ErrorCodes.NOT_IMPLEMENTED,
            `현재 엔진 프로파일은 진단만 지원합니다: ${detected.format}`,
            { format: detected.format },
        );
    }
    const patchExtractDir = patchWorkspacePath(detected);
    let patches = request.patches;
    let dictionary: TranslationDictionaryOutcome | undefined;
    if (typeof request.options.translationDirectory === 'string') {
        if (engine.patchFormat !== 'rpgmv') {
            throw new OperationError(
                ErrorCodes.NOT_IMPLEMENTED,
                'translationDirectory 자동 조립은 RPG MV/MZ만 지원합니다',
            );
        }
        dictionary = loadRpgTranslationDictionary(patchExtractDir, request.options.translationDirectory);
        patches = dictionary.patches;
        result.warnings.push(...dictionary.warnings);
    }
    if (patches.length === 0) {
        throw new OperationError(ErrorCodes.PATCH_EMPTY, '적용 가능한 번역 사전 항목이 없습니다');
    }
    const outcome = applyPatches(patchExtractDir, engine.patchFormat, patches);
    result.ok = true;
    result.artifacts = [path.join(patchExtractDir, MANIFEST_FILE)];
    result.stats = {
        patched: outcome.patched,
        files: outcome.files,
        ...(dictionary ? { dictionary: dictionary.stats } : {}),
    };
}
