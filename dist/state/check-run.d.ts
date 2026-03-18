import * as github from '@actions/github';
import { CheckRunState, PreviousRun } from './types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function createCheckRun(octokit: Octokit, owner: string, repo: string, headSha: string, prNumber: number): Promise<number>;
export declare function getPreviousCheckRun(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<PreviousRun | null>;
export declare function getPreviousCheckRunForPR(octokit: Octokit, owner: string, repo: string, prNumber: number, headSha: string): Promise<PreviousRun | null>;
export declare function updateCheckRun(octokit: Octokit, owner: string, repo: string, checkRunId: number, conclusion: 'success' | 'failure' | 'neutral', state: CheckRunState, summary: string): Promise<void>;
export declare function finalizeCheckRun(octokit: Octokit, owner: string, repo: string, checkRunId: number, totalIssues: number, newIssues: number, headSha: string, analyzedFiles: string[], allIssueHashes: string[]): Promise<void>;
export declare function serializeState(state: CheckRunState): string;
export declare function deserializeState(json: string): CheckRunState;
export {};
//# sourceMappingURL=check-run.d.ts.map