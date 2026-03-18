import * as github from '@actions/github';
import { A11yIssue } from '../state/types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function createOrUpdateComment(octokit: Octokit, owner: string, repo: string, prNumber: number, body: string): Promise<number>;
export declare function formatIssueComment(issues: A11yIssue[], summary?: string, newIssueCount?: number): string;
export declare function formatNoIssuesComment(summary?: string): string;
export {};
//# sourceMappingURL=comments.d.ts.map