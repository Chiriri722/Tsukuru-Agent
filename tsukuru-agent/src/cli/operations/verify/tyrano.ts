import fs from 'fs';
import path from 'path';
import { MANIFEST_FILE } from '../../../core/manifest';
import { AgentRequest, AgentResult } from '../../../core/schema';
import { ErrorCodes, toOperationError } from '../../../core/types';
import { inspectTyranoProject, scoreVerification } from '../../../core/validator';
import { TyranoService } from '../../../js/tyrano/TyranoService';
import { tyranoProjectRoot } from '../../enginePaths';
import { DetectedProject } from '../../formatDetect';
import { writeHumanSummary } from '../../presenter';
import { emptyChange, publicScores, structuralIssueMessage } from './common';

export async function verifyTyrano(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
): Promise<void> {
    const change = emptyChange();
    const projectRoot = tyranoProjectRoot(detected);
    const extractManifest = path.join(projectRoot, 'data', '_Extract', MANIFEST_FILE);
    if (fs.existsSync(extractManifest)) {
        let validation;
        try {
            validation = new TyranoService().verifyWorkspace(projectRoot);
        } catch (error) {
            const operationError = toOperationError(error);
            validation = inspectTyranoProject(projectRoot);
            let manifestEntries = 0;
            try {
                const parsedManifest = JSON.parse(fs.readFileSync(extractManifest, 'utf8'));
                manifestEntries = Array.isArray(parsedManifest.entries) ? parsedManifest.entries.length : 0;
            } catch { /* 아래 issue가 manifest 실패를 대표한다. */ }
            const details = operationError.details && typeof operationError.details === 'object'
                ? operationError.details as Record<string, unknown>
                : {};
            const issueCode = operationError.code === ErrorCodes.SOURCE_CHANGED
                ? 'TYRANO_SOURCE_CHANGED'
                : operationError.code === ErrorCodes.PATCH_HASH_MISMATCH
                    ? 'TYRANO_EXTRACT_HASH_MISMATCH'
                    : operationError.code === ErrorCodes.ENCODING_UNREPRESENTABLE
                        ? 'TYRANO_ENCODING_UNREPRESENTABLE'
                        : operationError.code === ErrorCodes.MAPPING_CORRUPT
                            ? 'TYRANO_MAPPING_CORRUPT'
                            : 'TYRANO_REINSERTION_FAILED';
            validation.ok = false;
            validation.entriesChecked = manifestEntries;
            validation.invalidEntries = manifestEntries > 0 ? 1 : 0;
            validation.validEntries = Math.max(0, manifestEntries - validation.invalidEntries);
            validation.tokenErrors++;
            validation.issues.push({
                code: issueCode,
                severity: 'critical',
                file: typeof details.sourceFile === 'string' ? details.sourceFile : null,
                message: operationError.message,
            });
        }
        result.validation = validation;
        const scores = scoreVerification({
            extractionCoverage: 100,
            mappingIntegrity: validation.entriesChecked > 0 ? 100 : 0,
            reinsertionValidity: validation.ok ? 100 : 0,
            protectedScriptIntegrity: validation.ok ? 100 : 0,
            containerIntegrity: 100,
            critical: validation.ok ? [] : ['tyrano-workspace-invalid'],
        });
        result.ok = validation.ok && scores.ok;
        result.warnings = validation.issues.map(structuralIssueMessage);
        result.scores = publicScores(scores);
        result.change = change;
        result.stats = {
            entries: validation.entriesChecked,
            files: validation.filesChecked,
            invalidEntries: validation.invalidEntries,
            tokenErrors: validation.tokenErrors,
            encodingWarnings: validation.encodingWarnings,
            score: scores.total,
        };
        if (!result.ok) {
            result.error = {
                code: ErrorCodes.VERIFY_FAILED,
                message: '검증 실패: Tyrano 작업본을 안전하게 재삽입할 수 없습니다',
                details: result.warnings,
            };
        }
        if (request.options.humanSummary === true) writeHumanSummary(result, { protectedMetric: 'integrity' });
        return;
    }

    const validation = inspectTyranoProject(projectRoot);
    result.validation = validation;
    const mappingIntegrity = validation.entriesChecked > 0
        ? Math.round(validation.validEntries / validation.entriesChecked * 100)
        : 0;
    const structuralIssues = validation.issues.map(structuralIssueMessage);
    const warnings = [
        'Tyrano 원본 구조 검사는 완료했지만 data/_Extract 작업본이 없습니다. 먼저 extract를 실행하세요',
        ...structuralIssues,
    ];
    const scores = scoreVerification({
        extractionCoverage: 0,
        mappingIntegrity,
        reinsertionValidity: 0,
        protectedScriptIntegrity: validation.ok ? 100 : 0,
        containerIntegrity: 100,
        critical: validation.ok ? [] : ['tyrano-structure-invalid'],
    });
    result.ok = false;
    result.warnings = warnings;
    result.scores = publicScores(scores);
    result.change = change;
    result.stats = {
        entries: validation.entriesChecked,
        files: validation.filesChecked,
        invalidEntries: validation.invalidEntries,
        tokenErrors: validation.tokenErrors,
        encodingWarnings: validation.encodingWarnings,
        score: scores.total,
    };
    result.error = {
        code: ErrorCodes.VERIFY_FAILED,
        message: validation.ok
            ? '검증 제한: Tyrano 추출 작업본이 없습니다'
            : `검증 실패: Tyrano 구조 오류 ${validation.tokenErrors}건`,
        details: warnings,
    };
    if (request.options.humanSummary === true) writeHumanSummary(result, { protectedMetric: 'integrity' });
}
