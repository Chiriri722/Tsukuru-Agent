import fs from 'fs';
import path from 'path';
import { MANIFEST_FILE } from '../../../core/manifest';
import { AgentRequest, AgentResult } from '../../../core/schema';
import { ErrorCodes, toOperationError } from '../../../core/types';
import { scoreVerification, StructuralValidationReport } from '../../../core/validator';
import { GDevelopService } from '../../../js/gdevelop/GDevelopService';
import { gdevelopProjectRoot } from '../../enginePaths';
import { DetectedProject } from '../../formatDetect';
import { writeHumanSummary } from '../../presenter';
import { emptyChange, publicScores, structuralIssueMessage } from './common';

export async function verifyGdevelop(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
): Promise<void> {
    const projectRoot = gdevelopProjectRoot(detected);
    const extractManifest = path.join(projectRoot, '_Extract', MANIFEST_FILE);
    let validation: StructuralValidationReport;
    if (!fs.existsSync(extractManifest)) {
        validation = {
            profile: 'gdevelop',
            ok: false,
            filesChecked: fs.existsSync(path.join(projectRoot, 'data.js')) ? 1 : 0,
            entriesChecked: 0,
            validEntries: 0,
            invalidEntries: 0,
            encodingCounts: { utf8: 0, shiftJis: 0, unknown: 0 },
            encodingWarnings: 0,
            tokenErrors: 1,
            issues: [{
                code: 'GDEVELOP_MANIFEST_MISSING',
                severity: 'critical',
                file: null,
                message: 'GDevelop _Extract 작업본이 없습니다. 먼저 extract를 실행하세요',
            }],
        };
    } else {
        try {
            validation = new GDevelopService().verifyWorkspace(projectRoot);
        } catch (error) {
            const operationError = toOperationError(error);
            let manifestEntries = 0;
            try {
                const parsedManifest = JSON.parse(fs.readFileSync(extractManifest, 'utf8'));
                manifestEntries = Array.isArray(parsedManifest.entries) ? parsedManifest.entries.length : 0;
            } catch { /* 아래 issue가 manifest 실패를 대표한다. */ }
            validation = {
                profile: 'gdevelop',
                ok: false,
                filesChecked: 1,
                entriesChecked: manifestEntries,
                validEntries: Math.max(0, manifestEntries - 1),
                invalidEntries: manifestEntries > 0 ? 1 : 0,
                encodingCounts: { utf8: 1, shiftJis: 0, unknown: 0 },
                encodingWarnings: 0,
                tokenErrors: 1,
                issues: [{
                    code: operationError.code === ErrorCodes.SOURCE_CHANGED
                        ? 'GDEVELOP_SOURCE_CHANGED'
                        : operationError.code === ErrorCodes.PATCH_HASH_MISMATCH
                            ? 'GDEVELOP_EXTRACT_HASH_MISMATCH'
                            : 'GDEVELOP_REINSERTION_FAILED',
                    severity: 'critical',
                    file: null,
                    message: operationError.message,
                }],
            };
        }
    }
    result.validation = validation;
    const scores = scoreVerification({
        extractionCoverage: validation.entriesChecked > 0 ? 100 : 0,
        mappingIntegrity: validation.entriesChecked > 0
            ? Math.round(validation.validEntries / validation.entriesChecked * 100)
            : 0,
        reinsertionValidity: validation.ok ? 100 : 0,
        protectedScriptIntegrity: validation.ok ? 100 : 0,
        containerIntegrity: detected.container?.archive
            ? (detected.container.archive.invalidEntryCount === 0 ? 100 : 0)
            : 100,
        critical: validation.ok ? [] : ['gdevelop-workspace-invalid'],
    });
    result.ok = validation.ok && scores.ok;
    result.warnings = validation.issues.map(structuralIssueMessage);
    result.scores = publicScores(scores);
    result.change = emptyChange();
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
            message: '검증 실패: GDevelop 작업본을 안전하게 재삽입할 수 없습니다',
            details: result.warnings,
        };
    }
    if (request.options.humanSummary === true) writeHumanSummary(result, { protectedMetric: 'integrity' });
}
