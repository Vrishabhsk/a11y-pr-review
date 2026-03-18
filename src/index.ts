import * as core from '@actions/core';
import * as github from '@actions/github';
import { analyzeFilesInBatches } from './llm/batch';
import { buildPrompt } from './prompts';
import { isAccessibilityRelevant } from './parsers/diff-parser';
import {
  A11yIssue,
  CheckRunState,
  FilePatch,
  MAX_ISSUES,
  groupIssuesByFile,
  flattenIssues,
} from './state/types';
import {
  createCheckRun,
  getPreviousCheckRunForPR,
  finalizeCheckRun,
  createEmptyState,
  updateStateWithNewIssues,
} from './state/check-run';
import {
  getPRInfo,
  getPRFiles,
  getFilesChangedBetween,
  createReview,
} from './github/client';
import {
  createOrUpdateComment,
  formatIssueComment,
  formatNoIssuesComment,
  formatDraftSkipComment,
  formatNoChangesComment,
} from './github/comments';

type Octokit = ReturnType<typeof github.getOctokit>;

async function run(): Promise<void> {
  let octokit: Octokit;
  let owner: string;
  let repo: string;
  let checkRunId: number | null = null;

  try {
    core.info('Starting accessibility review...');

    const token = core.getInput('github-token', { required: true });
    const llmBackend = core.getInput('llm-backend', { required: true }).toLowerCase();
    const apiKey = core.getInput('api-key');
    const model = core.getInput('model') || (llmBackend === 'gemini' ? 'gemini-2.0-flash' : 'qwen2.5-coder:32b');
    const ollamaUrl = core.getInput('ollama-url') || 'http://localhost:11434';
    const failOnIssues = core.getInput('fail-on-issues').toLowerCase() !== 'false';

    if (llmBackend === 'gemini' && !apiKey) {
      core.setFailed('api-key is required for Gemini backend');
      return;
    }

    const context = github.context;
    if (context.eventName !== 'pull_request' && context.eventName !== 'pull_request_target') {
      core.setFailed('This action only works on pull_request events');
      return;
    }

    const prNumber = context.payload.pull_request?.number as number;
    owner = context.repo.owner;
    repo = context.repo.repo;

    if (!prNumber) {
      core.setFailed('Could not determine PR number');
      return;
    }

    core.info(`Reviewing PR #${prNumber} in ${owner}/${repo}`);

    octokit = github.getOctokit(token);

    const prInfo = await getPRInfo(octokit, owner, repo, prNumber);
    core.info(`PR is draft: ${prInfo.draft}, head SHA: ${prInfo.headSha}`);

    if (prInfo.draft) {
      core.info('Skipping draft PR');
      await createOrUpdateComment(octokit, owner, repo, prNumber, formatDraftSkipComment());
      core.setOutput('issues-found', '0');
      return;
    }

    checkRunId = await createCheckRun(octokit, owner, repo, prInfo.headSha, prNumber);

    const previousRun = await getPreviousCheckRunForPR(octokit, owner, repo, prNumber, prInfo.headSha);

    if (previousRun) {
      core.info(`Found previous run with ${Object.keys(previousRun.state.issuesByFile).length} files analyzed`);
    } else {
      core.info('No previous run found, this is the first analysis');
    }

    const prompt = buildPrompt(owner, repo, prNumber);
    let allIssues: A11yIssue[];
    let newIssues: A11yIssue[];

    if (!previousRun) {
      core.info('First run: Analyzing all PR files');
      
      const allFiles = await getPRFiles(octokit, owner, repo, prNumber);
      core.info(`Fetched ${allFiles.length} total files in PR`);

      const relevantFiles = allFiles.filter(
        f => f.patch && isAccessibilityRelevant(f.filename) && f.status !== 'removed'
      );
      core.info(`Found ${relevantFiles.length} accessibility-relevant files`);

      if (relevantFiles.length === 0) {
        core.info('No accessibility-relevant files found');
        const state = createEmptyState(prNumber, prInfo.headSha);
        await finalizeCheckRun(octokit, owner, repo, checkRunId, state, 0);
        await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoIssuesComment('No accessibility-relevant changes found.'));
        core.setOutput('issues-found', '0');
        return;
      }

      const result = await analyzeFilesInBatches(
        relevantFiles,
        llmBackend,
        apiKey,
        model,
        ollamaUrl,
        prompt
      );

      allIssues = result.issues;
      newIssues = result.issues;

      const issuesByFile = groupIssuesByFile(allIssues.slice(0, MAX_ISSUES));
      const state: CheckRunState = {
        version: 1,
        lastAnalyzedHeadSha: prInfo.headSha,
        prNumber,
        issuesByFile,
      };

      await postResults(
        octokit,
        owner,
        repo,
        prNumber,
        prInfo.headSha,
        allIssues,
        newIssues,
        relevantFiles,
        checkRunId!,
        state
      );

    } else {
      core.info('Incremental run: Checking for new commits');

      const changedFiles = await getFilesChangedBetween(
        octokit,
        owner,
        repo,
        previousRun.state.lastAnalyzedHeadSha,
        prInfo.headSha
      );

      core.info(`Found ${changedFiles.size} files changed since last analysis`);

      if (changedFiles.size === 0) {
        core.info('No new commits since last analysis');
        const existingIssues = flattenIssues(previousRun.state.issuesByFile);
        await finalizeCheckRun(octokit, owner, repo, checkRunId, previousRun.state, 0);
        
        if (existingIssues.length > 0) {
          await createOrUpdateComment(
            octokit,
            owner,
            repo,
            prNumber,
            formatIssueComment(existingIssues, [], 'No new changes since last analysis.')
          );
        } else {
          await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoChangesComment());
        }
        
        core.setOutput('issues-found', String(existingIssues.length));
        
        if (existingIssues.length > 0 && failOnIssues) {
          core.setFailed(`Found ${existingIssues.length} accessibility issue${existingIssues.length === 1 ? '' : 's'} from previous analysis`);
        }
        return;
      }

      const allPRFiles = await getPRFiles(octokit, owner, repo, prNumber);
      const relevantChangedFiles = allPRFiles.filter(
        f => changedFiles.has(f.filename) && f.patch && isAccessibilityRelevant(f.filename) && f.status !== 'removed'
      );

      core.info(`Found ${relevantChangedFiles.length} relevant files to re-analyze`);

      if (relevantChangedFiles.length === 0) {
        core.info('No accessibility-relevant changes in new commits');
        const existingIssues = flattenIssues(previousRun.state.issuesByFile);
        const state: CheckRunState = {
          ...previousRun.state,
          lastAnalyzedHeadSha: prInfo.headSha,
        };
        
        await finalizeCheckRun(octokit, owner, repo, checkRunId, state, 0);
        
        if (existingIssues.length > 0) {
          await createOrUpdateComment(
            octokit,
            owner,
            repo,
            prNumber,
            formatIssueComment(existingIssues, [], 'No accessibility-relevant changes in recent commits.')
          );
        } else {
          await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoChangesComment());
        }
        
        core.setOutput('issues-found', String(existingIssues.length));
        
        if (existingIssues.length > 0 && failOnIssues) {
          core.setFailed(`Found ${existingIssues.length} accessibility issue${existingIssues.length === 1 ? '' : 's'} from previous analysis`);
        }
        return;
      }

      const result = await analyzeFilesInBatches(
        relevantChangedFiles,
        llmBackend,
        apiKey,
        model,
        ollamaUrl,
        prompt
      );

      newIssues = result.issues;

      const existingIssues: A11yIssue[] = [];
      for (const [file, issues] of Object.entries(previousRun.state.issuesByFile)) {
        if (!changedFiles.has(file)) {
          existingIssues.push(...(issues as A11yIssue[]));
        }
      }

      allIssues = [...existingIssues, ...newIssues].slice(0, MAX_ISSUES);

      const state = updateStateWithNewIssues(
        previousRun.state,
        groupIssuesByFile(newIssues),
        changedFiles,
        prInfo.headSha
      );

      await postResults(
        octokit,
        owner,
        repo,
        prNumber,
        prInfo.headSha,
        allIssues,
        newIssues,
        relevantChangedFiles,
        checkRunId!,
        state
      );
    }

    const totalIssues = Math.min(allIssues.length, MAX_ISSUES);
    const criticalAndImportantCount = allIssues.filter(
      i => i.severity === 'CRITICAL' || i.severity === 'IMPORTANT'
    ).length;
    const suggestionAndNitCount = totalIssues - criticalAndImportantCount;

    core.setOutput('issues-found', String(totalIssues));
    core.info(`Total issues: ${totalIssues} (${criticalAndImportantCount} critical/important, ${suggestionAndNitCount} suggestions/nits)`);

    // Only fail on CRITICAL and IMPORTANT issues, not on SUGGESTION/NIT
    if (criticalAndImportantCount > 0 && failOnIssues) {
      const criticalCount = allIssues.filter(i => i.severity === 'CRITICAL').length;
      const importantCount = allIssues.filter(i => i.severity === 'IMPORTANT').length;

      let message = `Found ${criticalAndImportantCount} blocking issue${criticalAndImportantCount === 1 ? '' : 's'}`;
      if (criticalCount > 0) message += ` (${criticalCount} critical`;
      if (importantCount > 0) message += `${criticalCount > 0 ? ', ' : '('}${importantCount} important)`;
      
      if (suggestionAndNitCount > 0) {
        message += `. Plus ${suggestionAndNitCount} suggestion${suggestionAndNitCount === 1 ? '' : 's'}.`;
      }

      core.setFailed(message);
      return;
    }

    if (suggestionAndNitCount > 0) {
      core.info(`✓ No blocking issues. ${suggestionAndNitCount} suggestion${suggestionAndNitCount === 1 ? '' : 's'} available for review.`);
    } else {
      core.info('✓ Review complete - no issues found');
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed: ${message}`);
    if (error instanceof Error && error.stack) {
      core.debug(`Stack trace: ${error.stack}`);
    }
  }
}

async function postResults(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  allIssues: A11yIssue[],
  newIssues: A11yIssue[],
  filesAnalyzed: FilePatch[],
  checkRunId: number,
  state: CheckRunState
): Promise<void> {
  const criticalAndImportant = newIssues.filter(
    i => i.severity === 'CRITICAL' || i.severity === 'IMPORTANT'
  );
  const suggestionsAndNits = newIssues.filter(
    i => i.severity === 'SUGGESTION' || i.severity === 'NIT'
  );

  const filePatches = new Map<string, string>();
  for (const file of filesAnalyzed) {
    if (file.filename && file.patch) {
      filePatches.set(file.filename, file.patch);
    }
  }

  let postedSuccessfully = false;

  if (criticalAndImportant.length > 0) {
    core.info(`Creating review with ${criticalAndImportant.length} CRITICAL/IMPORTANT issues`);
    
    try {
      const result = await createReview(
        octokit,
        owner,
        repo,
        prNumber,
        headSha,
        criticalAndImportant,
        suggestionsAndNits,
        filePatches
      );
      
      core.info(`Posted ${result.postedInlineCount} inline comments, ${result.failedInlineIssues.length} issues in body`);
      postedSuccessfully = true;
    } catch (error) {
      core.warning(`Failed to create review: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!postedSuccessfully) {
    try {
      if (allIssues.length > 0) {
        core.info('Falling back to PR comment');
        const comment = formatIssueComment(allIssues, newIssues);
        await createOrUpdateComment(octokit, owner, repo, prNumber, comment);
      } else {
        await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoIssuesComment());
      }
    } catch (error) {
      core.warning(`Failed to create PR comment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    await finalizeCheckRun(octokit, owner, repo, checkRunId, state, newIssues.length);
  } catch (error) {
    core.warning(`Failed to finalize check run: ${error instanceof Error ? error.message : String(error)}`);
  }
}

run();