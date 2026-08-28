export interface ScoreInput {
    extractionCoverage: number;
    mappingIntegrity: number;
    reinsertionValidity: number;
    protectedScriptIntegrity: number;
    containerIntegrity: number;
    critical?: string[];
}

export interface ScoreResult {
    total: number;
    extractionCoverage: number;
    mappingIntegrity: number;
    reinsertionValidity: number;
    protectedScriptIntegrity: number;
    containerIntegrity: number;
    risk: 'low' | 'medium' | 'high' | 'critical';
    ok: boolean;
    issues: string[];
    components: {
        extractionCoverage: number;
        mappingIntegrity: number;
        reinsertionValidity: number;
        protectedScriptIntegrity: number;
        containerIntegrity: number;
    };
}

export interface FileMapEntry {
    path: string;
    size: number;
    hash: string;
    protected?: boolean;
}

export interface FileDiff {
    filesChanged: number;
    bytesChanged: number;
    protectedFilesChanged: number;
    protectedBytesChanged: number;
    addedFiles: number;
    removedFiles: number;
    protectedScriptDamage: number;
    textBytesChanged: number;
}

export type StructuralIssueSeverity = 'critical' | 'error' | 'warning';

export interface StructuralIssue {
    code: string;
    severity: StructuralIssueSeverity;
    file: string | null;
    entryId?: string;
    line?: number;
    column?: number;
    message: string;
}

export interface StructuralValidationReport {
    profile: 'rpgmv' | 'wolf' | 'tyrano' | 'gdevelop';
    ok: boolean;
    filesChecked: number;
    entriesChecked: number;
    validEntries: number;
    invalidEntries: number;
    encodingCounts: {
        utf8: number;
        shiftJis: number;
        unknown: number;
    };
    encodingWarnings: number;
    tokenErrors: number;
    issues: StructuralIssue[];
}
