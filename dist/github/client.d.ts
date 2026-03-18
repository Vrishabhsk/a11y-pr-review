import * as github from '@actions/github';
import { A11yIssue, FilePatch, PRInfo } from '../state/types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function getPRInfo(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<PRInfo>;
export declare function getPRFiles(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<FilePatch[]>;
export declare function getFilesChangedBetween(octokit: Octokit, owner: string, repo: string, baseSha: string, headSha: string): Promise<Set<string>>;
export declare function createReview(octokit: Octokit, owner: string, repo: string, prNumber: number, headSha: string, criticalAndImportant: A11yIssue[], suggestionsAndNits: A11yIssue[], filePatches: Map<string, string>): Promise<{
    reviewId: number;
    postedInlineCount: number;
    failedInlineIssues: A11yIssue[];
}>;
export {};
//# sourceMappingURL=client.d.ts.map