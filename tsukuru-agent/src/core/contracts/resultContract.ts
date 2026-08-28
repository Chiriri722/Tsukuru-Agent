import { AgentResult, ResultWarning } from '../schema';
import { ErrorCodes, OperationError, WarningCodes } from '../types';
import { validateContract } from './schemaRegistry';

function legacyWarning(message: string): ResultWarning {
    return { code: WarningCodes.LEGACY_MESSAGE, message };
}

/**
 * v1은 기존 키를 보존한다. v2는 기존 문자열 warning과 구조화 warning을 병행하고
 * 반환 직전 canonical result schema를 반드시 통과한다.
 */
export function finalizeAgentResult(result: AgentResult, schemaVersion: 1 | 2): AgentResult {
    if (schemaVersion === 1) {
        delete result.schemaVersion;
        delete result.warningDetails;
    } else {
        result.schemaVersion = 2;
        const details = result.warningDetails ?? [];
        const detailedMessages = new Set(details.map((warning) => warning.message));
        for (const message of result.warnings) {
            if (!detailedMessages.has(message)) details.push(legacyWarning(message));
        }
        result.warningDetails = details;
    }
    const validation = validateContract('result', schemaVersion, result);
    if (!validation.ok) {
        throw new OperationError(ErrorCodes.INTERNAL, '결과 계약 검증에 실패했습니다', {
            schemaVersion,
            violations: validation.errors,
        });
    }
    return result;
}
