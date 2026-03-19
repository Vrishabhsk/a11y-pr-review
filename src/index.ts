import * as core from '@actions/core';
import * as github from '@actions/github';
import { analyzeFilesInBatches } from './llm/batch';
import { buildPrompt } from './prompts';
import { isAccessibilityRelevant } from './parsers/diff-parser';
import { A11yIssue, FilePatch, MAX_ISSUES } from './state/types';
import { getPRInfo, getPRFiles, createReview } from './github/client';
import { createOrUpdateComment, formatIssueComment, formatNoIssuesComment, formatDraftSkipComment } from './github/comments';

type Octokit = ReturnType<typeof github.getOctokit>;

async function run(): Promise<void> {
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
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    if (!prNumber) {
      core.setFailed('Could not determine PR number');
      return;
    }

    core.info(`Reviewing PR #${prNumber} in ${owner}/${repo}`);

    const octokit = github.getOctokit(token);

    const prInfo = await getPRInfo(octokit, owner, repo, prNumber);
    core.info(`PR is draft: ${prInfo.draft}, head SHA: ${prInfo.headSha}`);

    if (prInfo.draft) {
      core.info('Skipping draft PR');
      await createOrUpdateComment(octokit, owner, repo, prNumber, formatDraftSkipComment());
      core.setOutput('issues-found', '0');
      return;
    }

    // Get all PR files
    const allFiles = await getPRFiles(octokit, owner, repo, prNumber);
    core.info(`Fetched ${allFiles.length} files in PR`);

    // Filter to accessibility-relevant files
    const relevantFiles = allFiles.filter(
      f => f.patch && isAccessibilityRelevant(f.filename) && f.status !== 'removed'
    );
    core.info(`Found ${relevantFiles.length} accessibility-relevant files`);

    if (relevantFiles.length === 0) {
      core.info('No accessibility-relevant files found');
      await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoIssuesComment('No accessibility-relevant changes found.'));
      core.setOutput('issues-found', '0');
      return;
    }

    // Analyze files
    const prompt = buildPrompt(owner, repo, prNumber);
    const result = await analyzeFilesInBatches(
      relevantFiles,
      llmBackend,
      apiKey,
      model,
      ollamaUrl,
      prompt
    );

    const issues = result.issues.slice(0, MAX_ISSUES);
    core.info(`Found ${issues.length} issues`);

    // Separate issues by severity
    const criticalAndImportant = issues.filter(
      i => i.severity === 'CRITICAL' || i.severity === 'IMPORTANT'
    );
    const suggestionsAndNits = issues.filter(
      i => i.severity === 'SUGGESTION' || i.severity === 'NIT'
    );

    // Build file patches map
    const filePatches = new Map<string, string>();
    for (const file of relevantFiles) {
      if (file.filename && file.patch) {
        filePatches.set(file.filename, file.patch);
      }
    }

    // Post results
    if (criticalAndImportant.length > 0) {
      core.info(`Posting ${criticalAndImportant.length} CRITICAL/IMPORTANT issues as inline comments`);
      
      try {
        const reviewResult = await createReview(
          octokit,
          owner,
          repo,
          prNumber,
          prInfo.headSha,
          criticalAndImportant,
          suggestionsAndNits,
          filePatches
        );
        
        core.info(`Posted ${reviewResult.postedInlineCount} inline comments, ${reviewResult.failedInlineIssues.length} in body`);
      } catch (error) {
        core.warning(`Failed to create review: ${error instanceof Error ? error.message : String(error)}`);
        // Fallback to PR comment
        const comment = formatIssueComment(issues);
        await createOrUpdateComment(octokit, owner, repo, prNumber, comment);
      }
    } else if (issues.length > 0) {
      core.info('Posting SUGGESTION/NIT issues as PR comment');
      const comment = formatIssueComment(issues);
      await createOrUpdateComment(octokit, owner, repo, prNumber, comment);
    } else {
      core.info('No issues found');
      await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoIssuesComment());
    }

    // Set output
    core.setOutput('issues-found', String(issues.length));

    // Fail on CRITICAL/IMPORTANT
    if (criticalAndImportant.length > 0 && failOnIssues) {
      const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
      const importantCount = issues.filter(i => i.severity === 'IMPORTANT').length;
      const suggestionCount = issues.filter(i => i.severity === 'SUGGESTION').length;
      const nitCount = issues.filter(i => i.severity === 'NIT').length;

      const parts: string[] = [];
      if (criticalCount > 0) parts.push(`${criticalCount} critical`);
      if (importantCount > 0) parts.push(`${importantCount} important`);
      
      let message = `Found ${criticalAndImportant.length} blocking issue${criticalAndImportant.length !== 1 ? 's' : ''}`;
      if (parts.length > 0) {
        message += ` (${parts.join(', ')})`;
      }
      
      if (suggestionCount > 0 || nitCount > 0) {
        message += `. Plus ${suggestionCount + nitCount} non-blocking suggestion${(suggestionCount + nitCount) !== 1 ? 's' : ''}.`;
      }

      core.setFailed(message);
      return;
    }

    if (suggestionsAndNits.length > 0) {
      core.info(`✓ No blocking issues. ${suggestionsAndNits.length} suggestion${suggestionsAndNits.length !== 1 ? 's' : ''} available for review.`);
    } else if (issues.length === 0) {
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

run();