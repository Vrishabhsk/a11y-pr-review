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
    // First try to find check run on current head SHA
    const checkRuns = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: headSha,
      per_page: 100,
    });

    let matchingRun = checkRuns.data.check_runs
      .filter(run => run.name === checkRunName && run.status === 'completed')
      .sort((a, b) => new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime())[0];

    // If not found on current SHA, we need to look at the PR's commit history
    if (!matchingRun) {
      core.info('No check run found on current SHA, searching in PR history...');
      
      // List commits in the PR
      const { data: commits } = await octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      // Search for check runs on previous commits (starting from most recent)
      // Don't reverse - we want to start from the newest commit
      for (const commit of commits) {
        // Skip the current head SHA (we already checked it above)
        if (commit.sha === headSha) continue;
        try {
          const refCheckRuns = await octokit.rest.checks.listForRef({
            owner,
            repo,
            ref: commit.sha,
            per_page: 100,
          });

          const run = refCheckRuns.data.check_runs
            .filter(r => r.name === checkRunName && r.status === 'completed')
            .sort((a, b) => new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime())[0];

          if (run) {
            matchingRun = run;
            core.info(`Found previous check run on commit ${commit.sha}`);
            break;
          }
        } catch {
          // Continue to next commit if this one fails
        }
      }
    }

    if (!matchingRun) {
      core.info('No previous check run found');
      return null;
    }

    if (!matchingRun.output?.text) {
      core.info('Previous check run has no state');
      return null;
    }

    const state = deserializeState(matchingRun.output.text);
    
    if (state.version !== STATE_VERSION) {
      core.info('State version mismatch, treating as first run');
      return null;
    }

    core.info(`Found previous check run ${matchingRun.id} with SHA ${state.lastAnalyzedHeadSha}`);

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
  
  // Remove issues for files that were re-analyzed
  for (const file of filesReanalyzed) {
    delete newIssuesByFileCopy[file];
  }
  
  // Add new/updated issues
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