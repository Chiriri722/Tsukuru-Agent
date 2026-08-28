import { DetectedFormat, Operation } from '../core/schema';
import { ErrorCodes, OperationError } from '../core/types';
import { DetectedProject } from './formatDetect';

export type EngineFamily = 'rpgmaker' | 'wolf' | 'tyrano' | 'gdevelop' | 'nwjs' | 'unknown';
export type ExtractLayout = 'rpg-data' | 'wolf-data' | 'tyrano-data' | 'gdevelop-root' | 'none';

export interface EngineAdapter {
    readonly format: DetectedFormat;
    readonly family: EngineFamily;
    readonly operations: readonly Operation[];
    readonly patchFormat: DetectedFormat | null;
    readonly extractLayout: ExtractLayout;
}

const allRpgOperations = Object.freeze<Operation[]>(['verify', 'extract', 'patch', 'apply', 'recover']);
const translationOperations = Object.freeze<Operation[]>(['verify', 'extract', 'patch', 'apply']);

function adapter(
    format: DetectedFormat,
    family: EngineFamily,
    operations: readonly Operation[],
    patchFormat: DetectedFormat | null,
    extractLayout: ExtractLayout,
): EngineAdapter {
    return Object.freeze({ format, family, operations, patchFormat, extractLayout });
}

export const engineRegistry: Readonly<Record<DetectedFormat, EngineAdapter>> = Object.freeze({
    rpgmv: adapter('rpgmv', 'rpgmaker', allRpgOperations, 'rpgmv', 'rpg-data'),
    rpgmz: adapter('rpgmz', 'rpgmaker', allRpgOperations, 'rpgmv', 'rpg-data'),
    wolf: adapter('wolf', 'wolf', translationOperations, 'wolf', 'wolf-data'),
    tyrano: adapter('tyrano', 'tyrano', translationOperations, 'tyrano', 'tyrano-data'),
    gdevelop: adapter('gdevelop', 'gdevelop', translationOperations, 'gdevelop', 'gdevelop-root'),
    nwjs: adapter('nwjs', 'nwjs', Object.freeze<Operation[]>(['verify']), null, 'none'),
    unknown: adapter('unknown', 'unknown', Object.freeze<Operation[]>([]), null, 'none'),
});

export function selectEngineAdapter(
    detected: DetectedProject,
    registry: Readonly<Record<DetectedFormat, EngineAdapter>> = engineRegistry,
): EngineAdapter {
    const selected = registry[detected.format];
    if (!selected || selected.family === 'unknown') {
        throw new OperationError(
            ErrorCodes.FORMAT_UNKNOWN,
            `지원되는 엔진 프로파일을 찾을 수 없습니다: ${String(detected.format)}`,
        );
    }
    return selected;
}
