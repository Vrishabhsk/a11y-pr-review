import * as core from '@actions/core';
import * as github from '@actions/github';
import { GeminiClient } from './llm/gemini-client';
import { OllamaClient } from './llm/ollama-client';
import { buildPrompt } from './prompts';
import { isAccessibilityRelevant, formatDiffForAnalysis } from './parsers/diff-parser';
import { 
  A11yIssue, 
  CheckRunState, 
  hashIssue,
  getCheckRunName,
  FilePatch 
} from './state/types';
import { 
  createCheckRun, 
  getPreviousCheckRunForPR,
  finalizeCheckRun
} from './state/check-run';
import { 
  getPRFiles, 
  getPRHeadSha, 
  getReviewComments, 
  createReview 
} from './github/client';
import { createOrUpdateComment, formatIssueComment, formatNoIssuesComment } from './github/comments';

type Octokit = ReturnType<typeof github.getOctokit>;

async function run(): Promise<void> {
  let octokit: Octokit;
  let owner: string;
  let repo: string;
  let prNumber: number;
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

    prNumber = context.payload.pull_request?.number as number;
    owner = context.repo.owner;
    repo = context.repo.repo;

    if (!prNumber) {
      core.setFailed('Could not determine PR number');
      return;
    }

    core.info(`Reviewing PR #${prNumber} in ${owner}/${repo}`);

    octokit = github.getOctokit(token);

    const headSha = await getPRHeadSha(octokit, owner, repo, prNumber);
    core.info(`PR head SHA: ${headSha}`);

    if (!checkRunId) {
      checkRunId = await createCheckRun(octokit, owner, repo, headSha, prNumber);
    }

    core.info('Fetching previous check run state...');
    const previousRun = await getPreviousCheckRunForPR(octokit, owner, repo, prNumber, headSha);

    if (previousRun) {
      core.info(`Found previous run with ${previousRun.state.issueHashes.length} issue hashes`);
      core.info(`Last analyzed SHA: ${previousRun.state.lastAnalyzedSha}`);
    } else {
      core.info('No previous run found, this is the first analysis');
    }

    core.info('Fetching PR files...');
    const allFiles = await getPRFiles(octokit, owner, repo, prNumber);
    core.info(`Fetched ${allFiles.length} total files in PR`);

    const relevantFiles = allFiles.filter(f => f.patch && isAccessibilityRelevant(f.filename) && f.status !== 'removed');
    core.info(`Found ${relevantFiles.length} accessibility-relevant files`);

    if (relevantFiles.length === 0) {
      core.info('No accessibility-relevant files found');
      await finalizeCheckRun(octokit, owner, repo, checkRunId, 0, 0, headSha, [], []);
      await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoIssuesComment('No accessibility-relevant changes found.'));
      core.setOutput('issues-found', '0');
      return;
    }

    const diffContent = formatDiffForAnalysis(relevantFiles);

    if (!diffContent.trim()) {
      core.info('No relevant code changes found');
      await finalizeCheckRun(octokit, owner, repo, checkRunId, 0, 0, headSha, [], []);
      await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoIssuesComment('No relevant code changes found.'));
      core.setOutput('issues-found', '0');
      return;
    }

    const prompt = buildPrompt(owner, repo, prNumber);
    core.info(`Analyzing with ${llmBackend} (${model})...`);

    let issues: A11yIssue[];
    let summary: string;

    if (llmBackend === 'gemini') {
      const client = new GeminiClient(apiKey, model);
      const result = await client.analyze(diffContent, prompt);
      issues = result.issues;
      summary = result.summary;
    } else {
      const client = new OllamaClient(ollamaUrl, model);
      const result = await client.analyze(diffContent, prompt);
      issues = result.issues;
      summary = result.summary;
    }

    core.info(`LLM found ${issues.length} potential issues`);

    for (const issue of issues) {
      core.debug(`Raw issue: ${issue.file}:${issue.line} - severity="${issue.severity}" - ${issue.title}`);
    }

    const existingComments = await getReviewComments(octokit, owner, repo, prNumber);
    core.info(`Found ${existingComments.length} existing review comments`);

    const reanalyzedFiles = new Set(relevantFiles.map(f => f.filename));

    const allIssueHashes = new Set(previousRun?.state.issueHashes || []);

    for (const file of reanalyzedFiles) {
      for (const hash of [...allIssueHashes]) {
        if (hash.startsWith(file + ':')) {
          allIssueHashes.delete(hash);
        }
      }
    }

    const existingCommentHashes = new Set<string>();
    for (const comment of existingComments) {
      const match = comment.body.match(/WCAG\s+(\d+\.\d+\.\d+)/);
      if (match && comment.path) {
        const titleMatch = comment.body.match(/\*\*(.+?)\*\*/);
        const title = titleMatch ? titleMatch[1] : '';
        const hash = `${comment.path}:${match[1]}:${title}`;
        existingCommentHashes.add(hash);
      }
    }

    const newIssues: A11yIssue[] = [];
    for (const issue of issues) {
      const hash = hashIssue(issue);
      if (!allIssueHashes.has(hash) && !existingCommentHashes.has(hash)) {
        newIssues.push(issue);
        allIssueHashes.add(hash);
      }
    }

    core.info(`Found ${newIssues.length} new issues (of ${issues.length} total)`);

    const allIssues = issues;

    const criticalAndImportant = newIssues.filter(
      i => i.severity === 'CRITICAL' || i.severity === 'IMPORTANT'
    );
    const suggestionsAndNits = newIssues.filter(
      i => i.severity === 'SUGGESTION' || i.severity === 'NIT'
    );

    core.info(`New critical/important: ${criticalAndImportant.length}, new suggestions/nits: ${suggestionsAndNits.length}`);

    if (criticalAndImportant.length > 0) {
      core.info('Creating review with inline comments for new critical/important issues...');
      const filePatches = new Map<string, string>();
      for (const file of relevantFiles) {
        filePatches.set(file.filename, file.patch);
      }
      
      await createReview(
        octokit,
        owner,
        repo,
        prNumber,
        headSha,
        criticalAndImportant,
        filePatches
      );
    }

    if (suggestionsAndNits.length > 0 || criticalAndImportant.length > 0) {
      const comment = formatIssueComment(allIssues, summary, newIssues.length);
      await createOrUpdateComment(octokit, owner, repo, prNumber, comment);
    } else if (allIssues.length === 0) {
      await createOrUpdateComment(octokit, owner, repo, prNumber, formatNoIssuesComment(summary));
    }

    await finalizeCheckRun(
      octokit,
      owner,
      repo,
      checkRunId,
      allIssues.length,
      newIssues.length,
      headSha,
      relevantFiles.map(f => f.filename),
      [...allIssueHashes] as string[]
    );

    core.setOutput('issues-found', String(allIssues.length));
    core.info(`Total issues: ${allIssues.length}, New issues: ${newIssues.length}`);

    if (allIssues.length > 0 && failOnIssues) {
      const criticalCount = allIssues.filter(i => i.severity === 'CRITICAL').length;
      const importantCount = allIssues.filter(i => i.severity === 'IMPORTANT').length;
      const suggestionCount = allIssues.filter(i => i.severity === 'SUGGESTION').length;
      const nitCount = allIssues.filter(i => i.severity === 'NIT').length;

      let message = `Found ${allIssues.length} accessibility issue${allIssues.length === 1 ? '' : 's'}`;
      if (newIssues.length > 0 && newIssues.length !== allIssues.length) {
        message += ` (${newIssues.length} new)`;
      }
      message += ':';
      if (criticalCount > 0) message += ` ${criticalCount} critical`;
      if (importantCount > 0) message += ` ${importantCount} important`;
      if (suggestionCount > 0) message += ` ${suggestionCount} suggestion${suggestionCount > 1 ? 's' : ''}`;
      if (nitCount > 0) message += ` ${nitCount} nit${nitCount > 1 ? 's' : ''}`;

      core.setFailed(message);
      return;
    }

    core.info('Review complete!');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed: ${message}`);
    if (error instanceof Error && error.stack) {
      core.debug(`Stack trace: ${error.stack}`);
    }
  }
}

run();