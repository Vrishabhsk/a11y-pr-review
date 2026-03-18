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
    version: number;
    lastAnalyzedHeadSha: string;
    prNumber: number;
    issuesByFile: Record<string, A11yIssue[]>;
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
export interface PRInfo {
    number: number;
    draft: boolean;
    headSha: string;
    baseSha: string;
    title?: string;
}
export interface ReviewCommentInfo {
    id: number;
    path: string;
    line: number | null;
    body: string;
}
export interface CommitInfo {
    sha: string;
    message: string;
}
export declare function getCheckRunName(prNumber: number): string;
export declare function hashIssue(issue: A11yIssue): string;
export declare function parseIssueHash(hash: string): {
    file: string;
    wcag_criterion: string;
    title: string;
} | null;
export declare function groupIssuesByFile(issues: A11yIssue[]): Record<string, A11yIssue[]>;
export declare function flattenIssues(issuesByFile: Record<string, A11yIssue[]>): A11yIssue[];
export declare const MAX_ISSUES = 100;
export declare const BATCH_SIZE = 20;
//# sourceMappingURL=types.d.ts.map