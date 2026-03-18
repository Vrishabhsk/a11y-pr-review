import * as github from '@actions/github';
import { A11yIssue, FilePatch, PRInfo, CommitInfo, ReviewCommentInfo } from '../state/types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function getPRInfo(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<PRInfo>;
export declare function getPRFiles(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<FilePatch[]>;
export declare function getCommitsBetween(octokit: Octokit, owner: string, repo: string, baseSha: string, headSha: string): Promise<CommitInfo[]>;
export declare function getFilesChangedBetween(octokit: Octokit, owner: string, repo: string, baseSha: string, headSha: string): Promise<Set<string>>;
export declare function getFileContent(octokit: Octokit, owner: string, repo: string, path: string, ref: string): Promise<string>;
export declare function getReviewComments(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<ReviewCommentInfo[]>;
export declare function createReview(octokit: Octokit, owner: string, repo: string, prNumber: number, headSha: string, issues: A11yIssue[], filePatches: Map<string, string>): Promise<number>;
export {};
//# sourceMappingURL=client.d.ts.map