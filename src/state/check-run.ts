import * as core from '@actions/core';
import * as github from '@actions/github';
import { CheckRunState, PreviousRun, getCheckRunName, A11yIssue, flattenIssues } from './types';

type Octokit = ReturnType<typeof github.getOctokit>;
const CHECK_RUN_TITLE = 'Accessibility Review';
const STATE_VERSION = 1;

export async function createCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
  prNumber: number
): Promise<number> {
  const checkRunName = getCheckRunName(prNumber);
  
  const { data: checkRun } = await octokit.rest.checks.create({
    owner,
    repo,
    name: checkRunName,
    head_sha: headSha,
    status: 'in_progress',
    started_at: new Date().toISOString(),
    output: {
      title: CHECK_RUN_TITLE,
      summary: 'Accessibility review in progress...',
      text: '',
    },
  });

  core.info(`Created check run ${checkRun.id}`);
  return checkRun.id;
}

export async function getPreviousCheckRunForPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string
): Promise<PreviousRun | null> {
  const checkRunName = getCheckRunName(prNumber);
  
  try {
    const { data: checkRuns } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: headSha,
      per_page: 100,
    });

    const matchingRun = checkRuns.check_runs.find(
      (run) => run.name === checkRunName && run.status === 'completed'
    );

    if (!matchingRun) return null;

    if (!matchingRun.output?.text) return null;

    const state = deserializeState(matchingRun.output.text);
    
    if (state.version !== STATE_VERSION) {
      core.info('State version mismatch, treating as first run');
      return null;
    }

    return {
      checkRunId: matchingRun.id,
      state,
    };
  } catch (error) {
    core.warning(`Failed to get previous check run for PR: ${error}`);
    return null;
  }
}

export async function updateCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  checkRunId: number,
  conclusion: 'success' | 'failure' | 'neutral',
  state: CheckRunState,
  summary: string
): Promise<void> {
  const stateJson = serializeState(state);
  
  await octokit.rest.checks.update({
    owner,
    repo,
    check_run_id: checkRunId,
    status: 'completed',
    conclusion,
    completed_at: new Date().toISOString(),
    output: {
      title: CHECK_RUN_TITLE,
      summary,
      text: stateJson,
    },
  });

  core.info(`Updated check run ${checkRunId} with conclusion: ${conclusion}`);
}

export async function finalizeCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  checkRunId: number,
  state: CheckRunState,
  newIssueCount: number
): Promise<void> {
  const totalIssues = flattenIssues(state.issuesByFile).length;
  const conclusion = totalIssues > 0 ? 'failure' : 'success';

  const summary = totalIssues > 0
    ? `Found ${totalIssues} accessibility issue${totalIssues === 1 ? '' : 's'}${newIssueCount > 0 ? ` (${newIssueCount} new)` : ''}`
    : 'No accessibility issues found';

  await updateCheckRun(octokit, owner, repo, checkRunId, conclusion, state, summary);
}

export function serializeState(state: CheckRunState): string {
  return JSON.stringify(state);
}

export function deserializeState(json: string): CheckRunState {
  try {
    const parsed = JSON.parse(json);
    
    if (parsed.version !== STATE_VERSION) {
      return createEmptyState(0, '');
    }
    
    return {
      version: parsed.version || STATE_VERSION,
      lastAnalyzedHeadSha: parsed.lastAnalyzedHeadSha || '',
      prNumber: parsed.prNumber || 0,
      issuesByFile: parsed.issuesByFile || {},
    };
  } catch {
    return createEmptyState(0, '');
  }
}

export function createEmptyState(prNumber: number, headSha: string): CheckRunState {
  return {
    version: STATE_VERSION,
    lastAnalyzedHeadSha: headSha,
    prNumber,
    issuesByFile: {},
  };
}

export function updateStateWithNewIssues(
  previousState: CheckRunState,
  newIssuesByFile: Record<string, A11yIssue[]>,
  filesReanalyzed: Set<string>,
  newHeadSha: string
): CheckRunState {
  const newIssuesByFileCopy = { ...previousState.issuesByFile };
  
  for (const file of filesReanalyzed) {
    delete newIssuesByFileCopy[file];
  }
  
  for (const [file, issues] of Object.entries(newIssuesByFile)) {
    newIssuesByFileCopy[file] = issues;
  }
  
  return {
    version: STATE_VERSION,
    lastAnalyzedHeadSha: newHeadSha,
    prNumber: previousState.prNumber,
    issuesByFile: newIssuesByFileCopy,
  };
}