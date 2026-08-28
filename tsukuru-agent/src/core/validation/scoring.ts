import { ScoreInput, ScoreResult } from './types';

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}

export function calculateVerificationScore(input: ScoreInput): ScoreResult {
    const components = {
        extractionCoverage: clampScore(input.extractionCoverage),
        mappingIntegrity: clampScore(input.mappingIntegrity),
        reinsertionValidity: clampScore(input.reinsertionValidity),
        protectedScriptIntegrity: clampScore(input.protectedScriptIntegrity),
        containerIntegrity: clampScore(input.containerIntegrity),
    };
    const total = Math.round(
        components.extractionCoverage * 0.2
        + components.mappingIntegrity * 0.2
        + components.reinsertionValidity * 0.3
        + components.protectedScriptIntegrity * 0.2
        + components.containerIntegrity * 0.1,
    );
    const issues = [...(input.critical ?? [])];
    let risk: ScoreResult['risk'];
    if (issues.length > 0) risk = 'critical';
    else if (total >= 90) risk = 'low';
    else if (total >= 75) risk = 'medium';
    else if (total >= 50) risk = 'high';
    else risk = 'critical';
    return {
        ...components,
        total,
        risk,
        ok: issues.length === 0 && total >= 75,
        issues,
        components,
    };
}
