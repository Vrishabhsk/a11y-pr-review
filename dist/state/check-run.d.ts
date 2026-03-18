import * as github from '@actions/github';
import { CheckRunState, PreviousRun, A11yIssue } from './types';
type Octokit = ReturnType<typeof github.getOctokit>;
export declare function createCheckRun(octokit: Octokit, owner: string, repo: string, headSha: string, prNumber: number): Promise<number>;
export declare function getPreviousCheckRunForPR(octokit: Octokit, owner: string, repo: string, prNumber: number, headSha: string): Promise<PreviousRun | null>;
export declare function updateCheckRun(octokit: Octokit, owner: string, repo: string, checkRunId: number, conclusion: 'success' | 'failure' | 'neutral', state: CheckRunState, summary: string): Promise<void>;
export declare function finalizeCheckRun(octokit: Octokit, owner: string, repo: string, checkRunId: number, state: CheckRunState, newIssueCount: number): Promise<void>;
export declare function serializeState(state: CheckRunState): string;
export declare function deserializeState(json: string): CheckRunState;
export declare function createEmptyState(prNumber: number, headSha: string): CheckRunState;
export declare function updateStateWithNewIssues(previousState: CheckRunState, newIssuesByFile: Record<string, A11yIssue[]>, filesReanalyzed: Set<string>, newHeadSha: string): CheckRunState;
export {};
//# sourceMappingURL=check-run.d.ts.map