export interface A11yIssue {
    file: string;
    line: number | null;
    wcag_criterion: string;
    wcag_level: string;
    severity: 'CRITICAL' | 'IMPORTANT' | 'SUGGESTION' | 'NIT';
    title: string;
    description: string;
    suggestion: string;
}
export interface CheckRunState {
    lastAnalyzedSha: string;
    analyzedFiles: string[];
    issueHashes: string[];
}
export interface PreviousRun {
    checkRunId: number;
    state: CheckRunState;
}
export interface FilePatch {
    filename: string;
    patch: string;
    status: 'added' | 'modified' | 'removed' | 'renamed';
}
export interface ReviewCommentInfo {
    id: number;
    path: string;
    line: number | null;
    body: string;
}
export declare function getCheckRunName(prNumber: number): string;
export declare function hashIssue(issue: A11yIssue): string;
export declare function parseIssueHash(hash: string): {
    file: string;
    wcag_criterion: string;
    title: string;
} | null;
//# sourceMappingURL=types.d.ts.map