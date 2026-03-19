import * as github from '@actions/github';
import { A11yIssue, FilePatch } from '../state/types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function getPRInfo(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<{
    number: number;
    draft: boolean;
    headSha: string;
    baseSha: string;
    title?: string;
}>;
export declare function getPRFiles(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<FilePatch[]>;
export declare function createReview(octokit: Octokit, owner: string, repo: string, prNumber: number, headSha: string, violations: A11yIssue[], goodPractices: A11yIssue[], _filePatches: Map<string, string>): Promise<{
    reviewId: number;
    postedInlineCount: number;
    unpostedViolations: A11yIssue[];
}>;
export {};
//# sourceMappingURL=client.d.ts.map