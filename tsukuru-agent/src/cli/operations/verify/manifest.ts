import fs from 'fs';
import path from 'path';
import { ExtractManifest, MANIFEST_FILE } from '../../../core/manifest';
import { readExtractManifest } from '../../../core/contracts/manifestContract';
import { AgentRequest, AgentResult } from '../../../core/schema';
import { ErrorCodes, OperationError } from '../../../core/types';
import {
    diffFileMaps,
    inspectRpgProject,
    inspectWolfBinaryMappings,
    scoreVerification,
    snapshotDirectory,
} from '../../../core/validator';
import { extractionWorkspacePath } from '../../enginePaths';
import { selectEngineAdapter } from '../../engineRegistry';
import { DetectedProject } from '../../formatDetect';
import { resolveExtractArtifactPath } from '../../patcher';
import { writeHumanSummary } from '../../presenter';
import { emptyChange, publicScores, structuralIssueMessage } from './common';
import { loadRpgApplyPlan, RpgApplyPlan } from '../../../js/rpgmv/applyPlan';
import { planRpgTranslations, RpgTranslation } from '../../../js/rpgmv/translation';
import { inspectTranslations, addTranslationIssue, translationQualitySummary } from '../../../core/translationLint';
import { assertReviewSize, buildRpgReview } from '../../../js/rpgmv/review';
import { assertDiagnosticReportTarget, writeDiagnosticReport } from '../../../core/diagnostics';
import { findLinkedPathComponent } from '../../../core/pathSafety';
import { OperationRuntime, throwIfOperationAborted } from '../../../core/operationRuntime';
import { validateContract } from '../../../core/contracts/schemaRegistry';

export function assertReviewTarget(request: AgentRequest, dataDir?: string): string | undefined {
    if (request.schemaVersion !== 2 || !request.options.review) return undefined;
    const target = path.resolve(request.options.review.reportPath);
    if (findLinkedPathComponent(target)) {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, 'review 출력 경로에 링크/정션이 있습니다');
    }
    for (const root of [request.projectPath, dataDir, request.outputPath].filter((value): value is string => !!value)) {
        assertDiagnosticReportTarget(target, root);
        if (fs.existsSync(root)) assertDiagnosticReportTarget(target, fs.realpathSync(root));
    }
    const diagnostic = request.options.diagnosticReportPath;
    if (diagnostic && path.relative(target, path.resolve(diagnostic)) === '') {
        throw new OperationError(ErrorCodes.REQUEST_INVALID, 'review와 진단 보고서 경로는 달라야 합니다');
    }
    return target;
}

async function publishReview(request: AgentRequest, detected: DetectedProject, result: AgentResult,
    plan: RpgApplyPlan | undefined, manifest: ExtractManifest | undefined,
    translations: RpgTranslation[], runtime: OperationRuntime | undefined): Promise<void> {
    const target = assertReviewTarget(request, detected.dataDir);
    if (!target) return;
    if (!plan || !manifest || (result.validation?.invalidEntries ?? 1) > 0) {
        throw new OperationError(ErrorCodes.MAPPING_CORRUPT, 'review에 필요한 원문/manifest 매핑이 유효하지 않습니다');
    }
    const report = buildRpgReview(plan, manifest, translations, request.options.review!);
    assertReviewSize(report);
    if (!validateContract('review', 1, report).ok) throw new OperationError(ErrorCodes.INTERNAL, 'review 결과 계약 검증 실패');
    // Give pending abort/timeout events a turn after synchronous parsing, before any publication.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (runtime) throwIfOperationAborted(runtime, 'before-review-publication');
    assertReviewTarget(request, detected.dataDir);
    // Deliberately unredacted, explicitly requested private artifact; diagnostic request omits review options.
    writeDiagnosticReport(target, report);
    result.artifacts.push(target);
    result.stats.review = { entries: report.entries.length, omittedEntries: report.omittedEntries };
    if (runtime) throwIfOperationAborted(runtime, 'after-review-publication');
}

type EngineAdapter = ReturnType<typeof selectEngineAdapter>;
type VerificationChange = ReturnType<typeof emptyChange>;

interface ArtifactInspection {
    entries: number;
    manifest?: ExtractManifest;
}

interface OutputComparison {
    change: VerificationChange;
    performed: boolean;
}

function inspectExtractionArtifacts(
    detected: DetectedProject,
    engine: EngineAdapter,
    extractDir: string,
    issues: string[],
): ArtifactInspection {
    if (!fs.existsSync(extractDir)) {
        issues.push(`추출 산출물 디렉터리가 없습니다: ${extractDir}`);
        return { entries: 0 };
    }

    let manifest: ExtractManifest | undefined;
    let entries = 0;
    const manifestPath = resolveExtractArtifactPath(extractDir, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) {
        issues.push('manifest.json이 없습니다(구버전 추출 산출물이면 patch를 사용할 수 없습니다)');
    } else {
        try {
            manifest = readExtractManifest(manifestPath);
            if (manifest.format !== engine.patchFormat) {
                issues.push(`manifest 포맷(${manifest.format})과 실제 포맷(${detected.format})이 다릅니다`);
            }
            entries = manifest.entries.length;
            if (entries === 0) issues.push('manifest entries가 비어 있습니다');
            const textFiles = new Set<string>(manifest.entries.map((entry) => entry.extractFile));
            for (const textFile of textFiles) {
                const textPath = resolveExtractArtifactPath(extractDir, textFile);
                if (!fs.existsSync(textPath)) issues.push(`추출 텍스트 파일이 없습니다: ${String(textFile)}`);
            }
        } catch (error) {
            if (error instanceof OperationError) throw error;
            throw new OperationError(
                ErrorCodes.MANIFEST_CORRUPT,
                'manifest.json 파싱에 실패했습니다',
                { manifestPath },
            );
        }
    }

    const extractedDataPath = engine.family === 'rpgmaker'
        ? path.join(detected.dataDir, '.extracteddata')
        : path.join(extractDir, '.extracteddata');
    if (!fs.existsSync(extractedDataPath)) issues.push('.extracteddata 파일이 없습니다(apply에 필요합니다)');
    return { entries, manifest };
}

function compareOutputProject(request: AgentRequest, issues: string[]): OutputComparison {
    const change = emptyChange();
    if (!request.outputPath) return { change, performed: false };

    const sourcePath = path.resolve(request.projectPath);
    const outputPath = path.resolve(request.outputPath);
    if (sourcePath === outputPath) {
        issues.push('원본 경로와 출력 경로는 같을 수 없습니다');
        return { change, performed: false };
    }
    if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).isDirectory()) {
        issues.push(`비교할 출력 디렉터리가 없습니다: ${request.outputPath}`);
        return { change, performed: false };
    }

    try {
        const diff = diffFileMaps(snapshotDirectory(sourcePath), snapshotDirectory(outputPath));
        const comparedChange = {
            filesChanged: diff.filesChanged,
            bytesChanged: diff.bytesChanged,
            textBytesChanged: diff.textBytesChanged,
            protectedFilesChanged: diff.protectedFilesChanged,
            protectedScriptDamage: diff.protectedScriptDamage,
        };
        if (comparedChange.protectedScriptDamage > 0) issues.push('보호 스크립트가 변형되었습니다');
        return { change: comparedChange, performed: true };
    } catch (error) {
        issues.push(`출력 비교에 실패했습니다: ${String(error)}`);
        return { change, performed: false };
    }
}

export async function verifyManifestProject(
    request: AgentRequest,
    detected: DetectedProject,
    result: AgentResult,
    runtime?: OperationRuntime,
): Promise<void> {
    const engine = selectEngineAdapter(detected);
    const issues: string[] = [];
    const extractDir = extractionWorkspacePath(detected);
    const { entries, manifest } = inspectExtractionArtifacts(detected, engine, extractDir, issues);
    const artifactIssueCount = issues.length;
    const validationIssueStart = issues.length;
    if (engine.family === 'rpgmaker' && manifest) {
        const validation = inspectRpgProject(detected.dataDir, manifest);
        result.validation = validation;
        issues.push(...validation.issues.map(structuralIssueMessage));
    } else if (engine.family === 'wolf' && manifest) {
        const validation = inspectWolfBinaryMappings(detected.dataDir, manifest);
        result.validation = validation;
        issues.push(...validation.issues.map(structuralIssueMessage));
    }
    const validationIssueEnd = issues.length;
    const qualityWarnings: string[] = [];
    let reviewPlan: RpgApplyPlan | undefined;
    let reviewTranslations: RpgTranslation[] = [];
    if (engine.family === 'rpgmaker' && manifest) {
        try {
            const plan = loadRpgApplyPlan(detected.dataDir);
            const planned = planRpgTranslations(plan);
            result.translationQuality = planned.quality;
            reviewPlan = plan;
            reviewTranslations = planned.translations;
            if (result.translationQuality.mechanical === 'fail') issues.push('번역 무결성 검사에 실패했습니다');
            const summary = translationQualitySummary(result.translationQuality);
            if (summary) qualityWarnings.push(summary);
        } catch (error) {
            const quality = inspectTranslations([]);
            addTranslationIssue(quality, { code: 'RPG_TRANSLATION_SOURCE_UNAVAILABLE', severity: 'error', file: 'Backup',
                reason: error instanceof OperationError ? error.code : 'E_INTERNAL' });
            quality.mechanical = 'not-run';
            result.translationQuality = quality;
            issues.push('번역 검사에 필요한 원문 또는 매핑을 확인할 수 없습니다');
        }
    }
    const { change, performed: comparisonPerformed } = compareOutputProject(request, issues);
    const blockingValidationIssues = result.validation?.issues
        .filter((issue) => issue.severity !== 'warning')
        .map(structuralIssueMessage) ?? [];
    const blockingIssues = [
        ...issues.slice(0, validationIssueStart),
        ...blockingValidationIssues,
        ...issues.slice(validationIssueEnd),
    ];
    const extractionReady = artifactIssueCount === 0 && entries > 0;
    const mappingIntegrity = result.validation
        ? (result.validation.entriesChecked > 0
            ? Math.round(result.validation.validEntries / result.validation.entriesChecked * 100)
            : 0)
        : (extractionReady ? 100 : 0);
    const ready = blockingIssues.length === 0 && extractionReady && (result.validation?.ok ?? true);
    const deep = request.options.verifyDepth === 'deep';
    const structuralCritical = result.validation?.issues
        .filter((issue) => issue.severity === 'critical')
        .map((issue) => issue.code) ?? [];
    const scores = scoreVerification({
        extractionCoverage: extractionReady ? 100 : 0,
        mappingIntegrity,
        reinsertionValidity: ready ? (deep && comparisonPerformed ? 80 : 50) : 0,
        protectedScriptIntegrity: comparisonPerformed ? (change.protectedScriptDamage === 0 ? 100 : 0) : 50,
        containerIntegrity: detected.container?.archive
            ? (detected.container.archive.integrity === 'unreadable' ? 50 : 100)
            : 100,
        critical: [
            ...(change.protectedScriptDamage > 0 ? ['protected-script-changed'] : []),
            ...structuralCritical,
        ],
    });
    result.ok = blockingIssues.length === 0 && scores.ok;
    result.warnings = [...issues, ...qualityWarnings];
    result.scores = publicScores(scores);
    result.change = change;
    result.stats = {
        entries,
        score: scores.total,
        ...(result.validation ? {
            files: result.validation.filesChecked,
            invalidEntries: result.validation.invalidEntries,
            tokenErrors: result.validation.tokenErrors,
            encodingWarnings: result.validation.encodingWarnings,
        } : {}),
    };
    if (!result.ok) {
        result.error = {
            code: ErrorCodes.VERIFY_FAILED,
            message: `검증 실패: ${blockingIssues.length}건`,
            details: blockingIssues,
        };
    }
    await publishReview(request, detected, result, reviewPlan, manifest, reviewTranslations, runtime);
    if (request.options.humanSummary === true) {
        writeHumanSummary(result, { protectedMetric: 'damage', damageAssessed: comparisonPerformed });
    }
}
