import { AgentResult } from '../../core/schema';
import { TranslationQualityReport, translationQualitySummary } from '../../core/translationLint';
import { WarningCodes } from '../../core/types';

export function attachTranslationQuality(result: AgentResult, quality: TranslationQualityReport | undefined): void {
    if (!quality) return;
    result.translationQuality = quality;
    const message = translationQualitySummary(quality);
    if (message) {
        result.warnings.push(message);
        result.warningDetails?.push({ code: WarningCodes.TRANSLATION_REVIEW, message,
            details: { language: quality.language, context: quality.context, issueCount: quality.issueCount } });
    }
}
