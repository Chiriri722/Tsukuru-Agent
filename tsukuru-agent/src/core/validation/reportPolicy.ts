import {
    StructuralIssue,
    StructuralIssueSeverity,
    StructuralValidationReport,
} from './types';

export interface IssueDefinition {
    readonly severity: StructuralIssueSeverity;
}

export const issueRegistry: Readonly<Record<string, IssueDefinition>> = Object.freeze({
    RPG_ROOT_TYPE_MISMATCH: { severity: 'error' },
    RPG_ID_INDEX_MISMATCH: { severity: 'error' },
    RPG_JSON_PARSE_ERROR: { severity: 'critical' },
    RPG_MANIFEST_DUPLICATE_ID: { severity: 'critical' },
    RPG_EXTRACT_FILE_MISSING: { severity: 'critical' },
    RPG_LINE_MAPPING_INVALID: { severity: 'critical' },
    RPG_EXTRACT_HASH_MISMATCH: { severity: 'critical' },
    RPG_SOURCE_FILE_MISSING: { severity: 'critical' },
    RPG_DATA_PATH_INVALID: { severity: 'critical' },
    RPG_SOURCE_JSON_PARSE_ERROR: { severity: 'critical' },
    RPG_LINKED_PATH: { severity: 'critical' },
    RPG_REFERENCE_MISSING: { severity: 'error' },
    RPG_MAP_FILE_MISSING: { severity: 'error' },
    RPG_REFERENCE_MISSING_BASELINE: { severity: 'warning' },
    RPG_MAP_FILE_MISSING_BASELINE: { severity: 'warning' },
    WOLF_SOURCE_MISSING: { severity: 'critical' },
    WOLF_OFFSET_INVALID: { severity: 'critical' },
    WOLF_LENGTH_PREFIX_MISMATCH: { severity: 'critical' },
    WOLF_NULL_TERMINATOR_MISSING: { severity: 'critical' },
    WOLF_SOURCE_HASH_MISMATCH: { severity: 'critical' },
    TYRANO_LINKED_PATH: { severity: 'critical' },
    TYRANO_ENCODING_UNCERTAIN: { severity: 'warning' },
    TYRANO_TJS_UNTERMINATED_STRING: { severity: 'error' },
    TYRANO_TJS_UNEXPECTED_CLOSER: { severity: 'error' },
    TYRANO_TJS_UNTERMINATED_COMMENT: { severity: 'error' },
    TYRANO_TJS_UNCLOSED_DELIMITER: { severity: 'error' },
    TYRANO_KS_UNTERMINATED_TAG: { severity: 'error' },
    TYRANO_KS_UNEXPECTED_CLOSER: { severity: 'error' },
    TYRANO_KS_UNCLOSED_BLOCK: { severity: 'error' },
});

const severityOrder: Readonly<Record<StructuralIssueSeverity, number>> = Object.freeze({
    critical: 0,
    error: 1,
    warning: 2,
});

function compareIssue(left: StructuralIssue, right: StructuralIssue): number {
    return severityOrder[left.severity] - severityOrder[right.severity]
        || (left.file ?? '').localeCompare(right.file ?? '')
        || (left.line ?? 0) - (right.line ?? 0)
        || (left.column ?? 0) - (right.column ?? 0)
        || (left.entryId ?? '').localeCompare(right.entryId ?? '')
        || left.code.localeCompare(right.code)
        || left.message.localeCompare(right.message);
}

export function finalizeValidationReport(report: StructuralValidationReport): StructuralValidationReport {
    const issues = report.issues.map((issue) => ({
        ...issue,
        severity: issueRegistry[issue.code]?.severity ?? issue.severity,
    })).sort(compareIssue);
    return { ...report, issues };
}
