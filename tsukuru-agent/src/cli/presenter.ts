import { AgentResult } from '../core/schema';

export function serializeAgentResult(result: AgentResult): string {
    return JSON.stringify(result, null, 2) + '\n';
}

export interface HumanSummaryOptions {
    protectedMetric: 'damage' | 'integrity';
    damageAssessed?: boolean;
}

export function formatHumanSummary(result: AgentResult, options: HumanSummaryOptions): string {
    if (!result.scores || !result.engine) return '';
    const lines = [
        `[Tsukuru Agent] container=${result.container?.type ?? 'unknown'} engine=${result.engine.type} wrapper=${result.engine.wrapper ?? 'none'}`,
        `[Tsukuru Agent] score=${result.scores.total}/100 risk=${result.scores.risk}`,
    ];
    if (options.protectedMetric === 'integrity') {
        lines.push(
            `[Tsukuru Agent] extraction=${result.scores.extractionCoverage}% reinsert=${result.scores.reinsertionValidity}% protected-script-integrity=${result.scores.protectedScriptIntegrity}%`,
        );
    } else {
        const damage = options.damageAssessed
            ? `${result.change?.protectedScriptDamage ?? 0}%`
            : 'unassessed';
        lines.push(
            `[Tsukuru Agent] extraction=${result.scores.extractionCoverage}% reinsert=${result.scores.reinsertionValidity}% protected-script-damage=${damage}`,
        );
    }
    if (result.runtime) {
        lines.push(
            `[Tsukuru Agent] runtime-risk=${result.runtime.risk ?? 'unassessed'} fuse=${result.runtime.fuses?.embeddedAsarIntegrityValidation ?? 'unknown'} asar-integrity=${result.runtime.asarIntegrity?.status ?? 'unassessed'} signature=${result.runtime.signature?.status ?? 'unassessed'}`,
        );
    }
    if (result.validation) {
        const validation = result.validation;
        lines.push(
            `[Tsukuru Agent] validation=${validation.profile} files=${validation.filesChecked} entries=${validation.entriesChecked} invalid=${validation.invalidEntries} token-errors=${validation.tokenErrors} encoding-warnings=${validation.encodingWarnings}`,
        );
    }
    return lines.join('\n') + '\n';
}

export function writeHumanSummary(result: AgentResult, options: HumanSummaryOptions): void {
    const summary = formatHumanSummary(result, options);
    if (summary !== '') process.stderr.write(summary);
}
