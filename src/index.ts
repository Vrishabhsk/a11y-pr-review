/**
 * A11y PR Review Action - Main Entry Point
 *
 * This action analyzes pull requests for accessibility issues using LLM analysis.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { GitHubClient } from './github';
import { createLLMClient } from './llm';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts/a11y-prompt';
import { Severity, severityMeetsThreshold } from './prompts/severity';
import { StateManager } from './state';
import { DiffParser } from './parsers';
import { InlineSuggestionManager } from './github/suggestions';
import { CommentManager } from './github/comments';
import { A11yIssue } from './types';

async function run(): Promise<void> {
  try {
    // Get inputs
    const llmBackend = core.getInput('llm-backend', { required: true });
    const githubToken = core.getInput('github-token', { required: true });
    const severityThreshold = core.getInput('severity-threshold') || 'SUGGESTION';
    const maxIssues = parseInt(core.getInput('max-issues') || '50', 10);
    const stateDir = process.env.STATE_DIR || '/tmp/a11y-state';

    // LLM-specific inputs
    const llmOptions: {
      apiKey?: string;
      model?: string;
      apiUrl?: string;
    } = {};

    if (llmBackend === 'gemini') {
      llmOptions.apiKey = core.getInput('gemini-api-key', { required: true });
      llmOptions.model = core.getInput('gemini-model') || 'gemini-2.0-flash';
    } else if (llmBackend === 'ollama') {
      llmOptions.apiUrl = core.getInput('ollama-api-url') || 'http://localhost:11434';
      llmOptions.model = core.getInput('ollama-model') || 'qwen2.5-coder:32b';
    }

    // Get GitHub context
    const context = github.context;
    const repository = `${context.repo.owner}/${context.repo.repo}`;

    if (context.eventName !== 'pull_request') {
      core.setFailed('This action only works on pull_request events');
      return;
    }

    const prNumber = context.payload.pull_request?.number;
    const commitSha = context.sha;

    if (!prNumber) {
      core.setFailed('Could not determine PR number');
      return;
    }

    core.info(`Starting accessibility review for ${repository}#${prNumber}`);
    core.info(`LLM Backend: ${llmBackend}`);

    // Initialize components
    const githubClient = new GitHubClient(githubToken, repository);
    const stateManager = new StateManager(stateDir);
    const llmClient = createLLMClient(llmBackend, llmOptions);
    const diffParser = new DiffParser();
    const suggestionManager = new InlineSuggestionManager(githubClient);
    const commentManager = new CommentManager(githubClient);

    // Load previous state
    const state = stateManager.load(prNumber, repository);
    core.info(`Loaded state: ${state.review_count} previous reviews`);

    // Get PR files
    const prFiles = await githubClient.getPRFiles(prNumber);
    core.info(`Found ${prFiles.length} changed files in PR`);

    // Parse diffs
    const fileDiffs: ReturnType<typeof DiffParser.parse>['files'] = [];
    for (const file of prFiles) {
      if (file.patch) {
        const parsed = DiffParser.parse(file.patch);
        fileDiffs.push(...parsed.files);
      }
    }

    // Filter to accessibility-relevant files
    const relevantFiles = DiffParser.filterAccessibilityFiles(fileDiffs);
    core.info(`Found ${relevantFiles.length} accessibility-relevant files`);

    if (relevantFiles.length === 0) {
      core.info('No accessibility-relevant changes found');

      // Create "no issues" comment
      await commentManager.createSummaryComment(prNumber, 0, 0, 0, 0, 0);

      // Set outputs
      core.setOutput('issues-found', '0');
      core.setOutput('critical-count', '0');
      core.setOutput('important-count', '0');

      return;
    }

    // Build diff content for analysis
    const diffContent = DiffParser.buildCodeForAnalysis(relevantFiles, true);

    // Detect framework
    const framework = detectFramework(prFiles);

    // Build prompts
    const userPrompt = buildUserPrompt(repository, prNumber, relevantFiles.length, framework);

    // Send to LLM
    core.info(`Analyzing with ${llmBackend}...`);
    const response = await llmClient.analyzeDiff(diffContent, SYSTEM_PROMPT, userPrompt);

    core.info(`LLM response received (${response.issues.length} issues found)`);

    // Filter by severity threshold
    const filteredIssues = response.issues.filter(issue =>
      severityMeetsThreshold(issue.severity as Severity, severityThreshold)
    );
    core.info(`${filteredIssues.length} issues meet severity threshold (${severityThreshold})`);

    // Deduplicate against previous state
    const existingHashes = new Set([
      ...stateManager.getExistingHashes(true),
      ...stateManager.getExistingHashes(false),
    ]);

    const { uniqueIssues, duplicateIssues } = stateManager
      ? (() => {
          const seen = new Set<string>();
          const unique: A11yIssue[] = [];
          const duplicate: A11yIssue[] = [];

          for (const issue of filteredIssues) {
            const hash = `${issue.file}:${issue.line}:${issue.wcag_criterion}:${issue.title}`;
            if (seen.has(hash) || existingHashes.has(hash)) {
              duplicate.push(issue);
            } else {
              seen.add(hash);
              unique.push(issue);
            }
          }

          return { uniqueIssues: unique, duplicateIssues: duplicate };
        })()
      : { uniqueIssues: filteredIssues, duplicateIssues: [] };

    core.info(`${uniqueIssues.length} new issues, ${duplicateIssues.length} duplicates`);

    // Limit issues
    const issuesToReport = uniqueIssues.slice(0, maxIssues);

    // Categorize issues
    const inlineIssues = issuesToReport.filter(
      i => i.severity === Severity.CRITICAL || i.severity === Severity.IMPORTANT
    );
    const commentIssues = issuesToReport.filter(
      i => i.severity === Severity.SUGGESTION || i.severity === Severity.NIT
    );

    core.info(`Submitting ${inlineIssues.length} inline suggestions, ${commentIssues.length} comment issues`);

    // Submit inline suggestions
    if (inlineIssues.length > 0) {
      await suggestionManager.createReviewWithSuggestions(prNumber, inlineIssues, commitSha);
      for (const issue of inlineIssues) {
        stateManager.addIssue(issue, commitSha, true);
      }
    }

    // Post aggregated comment
    if (commentIssues.length > 0) {
      await commentManager.postOrUpdateComment(prNumber, commentIssues, response.summary);
      for (const issue of commentIssues) {
        stateManager.addIssue(issue, commitSha, false);
      }
    }

    // Create summary comment
    const criticalCount = issuesToReport.filter(i => i.severity === Severity.CRITICAL).length;
    const importantCount = issuesToReport.filter(i => i.severity === Severity.IMPORTANT).length;
    const suggestionCount = issuesToReport.filter(i => i.severity === Severity.SUGGESTION).length;
    const nitCount = issuesToReport.filter(i => i.severity === Severity.NIT).length;

    await commentManager.createSummaryComment(
      prNumber,
      issuesToReport.length,
      criticalCount,
      importantCount,
      suggestionCount,
      nitCount,
      response.summary
    );

    // Update state
    stateManager.addReviewedCommit(commitSha);
    stateManager.setLastReviewSha(commitSha);
    stateManager.incrementReviewCount();
    stateManager.save();

    // Set outputs
    core.setOutput('issues-found', String(issuesToReport.length));
    core.setOutput('critical-count', String(criticalCount));
    core.setOutput('important-count', String(importantCount));

    core.info('Review complete!');
  } catch (error) {
    core.setFailed(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      core.debug(error.stack);
    }
  }
}

function detectFramework(prFiles: { path: string }[]): string {
  const extensions: Record<string, number> = {};

  for (const file of prFiles) {
    const ext = file.path.split('.').pop()?.toLowerCase() || '';
    extensions[ext] = (extensions[ext] || 0) + 1;
  }

  if (extensions['tsx'] || extensions['jsx']) return 'React';
  if (extensions['vue']) return 'Vue';
  if (extensions['svelte']) return 'Svelte';
  if (extensions['html'] || extensions['htm']) return 'HTML';
  if (extensions['php']) return 'PHP';

  return 'Unknown';
}

run();