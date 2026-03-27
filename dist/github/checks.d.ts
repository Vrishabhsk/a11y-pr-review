import * as github from '@actions/github';
import { A11yIssue } from '../state/types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function createAccessibilityCheckRun(octokit: Octokit, owner: string, repo: string, headSha: string, violations: A11yIssue[], goodPractices: A11yIssue[]): Promise<{
    checkRunId: number;
    annotationCount: number;
}>;
export declare function formatCheckNoIssuesSummary(): string;
export {};
//# sourceMappingURL=checks.d.ts.map