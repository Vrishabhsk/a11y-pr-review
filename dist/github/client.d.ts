import * as github from '@actions/github';
import { A11yIssue, FilePatch, ReviewCommentInfo } from '../state/types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function getPRFiles(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<FilePatch[]>;
export declare function getPRCommits(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<Array<{
    sha: string;
    message: string;
}>>;
export declare function getPRHeadSha(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<string>;
export declare function getReviewComments(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<ReviewCommentInfo[]>;
export declare function createReview(octokit: Octokit, owner: string, repo: string, prNumber: number, headSha: string, issues: A11yIssue[], filePatches: Map<string, string>): Promise<number>;
export {};
//# sourceMappingURL=client.d.ts.map