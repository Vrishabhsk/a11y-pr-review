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
export declare const MAX_ISSUES = 100;
export declare const BATCH_SIZE = 20;
//# sourceMappingURL=types.d.ts.map