import * as core from '@actions/core';
import * as github from '@actions/github';
import { CheckRunState, PreviousRun, getCheckRunName } from './types';

type Octokit = ReturnType<typeof github.getOctokit>;
const CHECK_RUN_TITLE = 'Accessibility Review';

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

export async function getPreviousCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PreviousRun | null> {
  const checkRunName = getCheckRunName(prNumber);
  
  try {
    const { data: checkRuns } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: 'refs/heads/' + await getDefaultBranch(octokit, owner, repo),
      status: 'completed',
      per_page: 100,
    });

    const matchingRun = checkRuns.check_runs.find(
      (run) => run.name === checkRunName && run.status === 'completed'
    );

    if (!matchingRun) return null;

    if (!matchingRun.output?.text) return null;

    const state = deserializeState(matchingRun.output.text);
    return {
      checkRunId: matchingRun.id,
      state,
    };
  } catch (error) {
    core.warning(`Failed to get previous check run for PR: ${error}`);
    return null;
  }
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
  totalIssues: number,
  newIssues: number,
  headSha: string,
  analyzedFiles: string[],
  allIssueHashes: string[]
): Promise<void> {
  const conclusion = totalIssues > 0 ? 'failure' : 'success';
  
  const state: CheckRunState = {
    lastAnalyzedSha: headSha,
    analyzedFiles,
    issueHashes: allIssueHashes.slice(0, 500),
  };

  const summary = totalIssues > 0
    ? `Found ${totalIssues} accessibility issue${totalIssues === 1 ? '' : 's'} (${newIssues} new)`
    : 'No accessibility issues found';

  await updateCheckRun(octokit, owner, repo, checkRunId, conclusion, state, summary);
}

export function serializeState(state: CheckRunState): string {
  return JSON.stringify(state);
}

export function deserializeState(json: string): CheckRunState {
  try {
    const parsed = JSON.parse(json);
    return {
      lastAnalyzedSha: parsed.lastAnalyzedSha || '',
      analyzedFiles: parsed.analyzedFiles || [],
      issueHashes: parsed.issueHashes || [],
    };
  } catch {
    return {
      lastAnalyzedSha: '',
      analyzedFiles: [],
      issueHashes: [],
    };
  }
}

async function getDefaultBranch(octokit: Octokit, owner: string, repo: string): Promise<string> {
  try {
    const { data: repository } = await octokit.rest.repos.get({
      owner,
      repo,
    });
    return repository.default_branch;
  } catch {
    return 'main';
  }
}