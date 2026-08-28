import { AgentRequest, AgentResult } from '../../../core/schema';
import { scoreVerification, StructuralIssue } from '../../../core/validator';
import { DetectedProject } from '../../formatDetect';

export type VerifyEngineHandler = (
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
) => Promise<void>;

export function emptyChange(): NonNullable<AgentResult['change']> {
    return {
        filesChanged: 0,
        bytesChanged: 0,
        textBytesChanged: 0,
        protectedFilesChanged: 0,
        protectedScriptDamage: 0,
    };
}

export function publicScores(scores: ReturnType<typeof scoreVerification>): AgentResult['scores'] {
    return {
        total: scores.total,
        extractionCoverage: scores.extractionCoverage,
        mappingIntegrity: scores.mappingIntegrity,
        reinsertionValidity: scores.reinsertionValidity,
        protectedScriptIntegrity: scores.protectedScriptIntegrity,
        containerIntegrity: scores.containerIntegrity,
        risk: scores.risk,
    };
}

export function structuralIssueMessage(issue: StructuralIssue): string {
    const position = issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : '';
    return `[${issue.code}] ${issue.file ?? '(project)'}${position}: ${issue.message}`;
}
