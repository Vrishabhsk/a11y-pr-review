import * as core from '@actions/core';
import * as github from '@actions/github';
import { analyzeFilesInBatches } from './llm/batch';
import { buildPrompt } from './prompts';
import { A11yIssue, MAX_ISSUES } from './state/types';
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

    // Validate API key requirements
    if (llmBackend === 'gemini' && !apiKey) {
      core.setFailed('api-key is required for Gemini backend');
      return;
    }

    // Warn if using Ollama Cloud without API key
    if (llmBackend === 'ollama' && ollamaUrl.includes('ollama.com') && !apiKey) {
      core.warning('Using Ollama Cloud without api-key. Set OLLAMA_API_KEY env var or provide api-key input.');
    }

    // Info log when API key provided for local Ollama
    if (llmBackend === 'ollama' && !ollamaUrl.includes('ollama.com') && apiKey) {
      core.info('API key provided for local Ollama - will use for authentication if required');
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

    // Get all PR files (analyze ALL changed files)
    const allFiles = await getPRFiles(octokit, owner, repo, prNumber);
    core.info(`Fetched ${allFiles.length} files in PR`);

    // Filter out removed files (can't analyze deleted content)
    const filesToAnalyze = allFiles.filter(f => f.status !== 'removed' && f.patch);
    core.info(`Analyzing ${filesToAnalyze.length} files with changes`);

    if (filesToAnalyze.length === 0) {
      core.info('No files with changes found');
      await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoIssuesComment('No files with changes to analyze.'));
      core.setOutput('issues-found', '0');
      return;
    }

    // Analyze files
    const prompt = buildPrompt(owner, repo, prNumber);
    const result = await analyzeFilesInBatches(
      filesToAnalyze,
      llmBackend,
      apiKey,
      model,
      ollamaUrl,
      prompt
    );

    const issues = result.issues.slice(0, MAX_ISSUES);
    core.info(`Found ${issues.length} issues`);

    // Separate issues by severity
    const violations = issues.filter(i => i.severity === 'VIOLATION');
    const goodPractices = issues.filter(i => i.severity === 'GOOD_PRACTICE');

    core.info(`Violations: ${violations.length}, Good Practices: ${goodPractices.length}`);

    // Build file patches map
    const filePatches = new Map<string, string>();
    for (const file of filesToAnalyze) {
      if (file.filename && file.patch) {
        filePatches.set(file.filename, file.patch);
      }
    }

    // Post results
    if (violations.length > 0) {
      core.info(`Posting ${violations.length} VIOLATION issues as inline comments`);
      
      try {
        const reviewResult = await createReview(
          octokit,
          owner,
          repo,
          prNumber,
          prInfo.headSha,
          violations,
          goodPractices,
          filePatches
        );
        
        core.info(`Posted ${reviewResult.postedInlineCount} inline comments`);
      } catch (error) {
        core.warning(`Failed to create review: ${error instanceof Error ? error.message : String(error)}`);
        // Fallback to PR comment
        const comment = formatIssueComment(issues);
        await createOrUpdateComment(octokit, owner, repo, prNumber, comment);
      }
    } else if (issues.length > 0) {
      // Only good practices - post as comment
      core.info('Only GOOD_PRACTICE issues found, posting as PR comment');
      const comment = formatIssueComment(issues);
      await createOrUpdateComment(octokit, owner, repo, prNumber, comment);
    } else {
      core.info('No issues found');
      await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoIssuesComment());
    }

    // Set output
    core.setOutput('issues-found', String(issues.length));
    core.setOutput('violations', String(violations.length));
    core.setOutput('good-practices', String(goodPractices.length));

    // Fail only on VIOLATION issues (GOOD_PRACTICE is not mandatory)
    if (violations.length > 0 && failOnIssues) {
      core.setFailed(`Found ${violations.length} WCAG 2.2 violation${violations.length !== 1 ? 's' : ''} that must be fixed.`);
      return;
    }

    if (goodPractices.length > 0) {
      core.info(`✓ No violations. ${goodPractices.length} good practice${goodPractices.length !== 1 ? 's' : ''} available for review.`);
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