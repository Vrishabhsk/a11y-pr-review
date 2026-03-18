import * as core from '@actions/core';
import * as github from '@actions/github';
import { GeminiClient } from './llm/gemini-client';
import { OllamaClient } from './llm/ollama-client';
import { buildPrompt } from './prompts';
import { isAccessibilityRelevant, formatDiffForAnalysis } from './parsers/diff-parser';

interface A11yIssue {
  file: string;
  line: number | null;
  wcag_criterion: string;
  wcag_level: string;
  severity: 'CRITICAL' | 'IMPORTANT' | 'SUGGESTION' | 'NIT';
  title: string;
  description: string;
  suggestion: string;
}

interface AnalysisResult {
  issues: A11yIssue[];
  summary: string;
}

async function run(): Promise<void> {
  try {
    core.info('Starting accessibility review...');

    const token = core.getInput('github-token', { required: true });
    const llmBackend = core.getInput('llm-backend', { required: true }).toLowerCase();
    const apiKey = core.getInput('api-key');
    const model = core.getInput('model') || (llmBackend === 'gemini' ? 'gemini-2.0-flash' : 'qwen2.5-coder:32b');
    const ollamaUrl = core.getInput('ollama-url') || 'http://localhost:11434';

    if (llmBackend === 'gemini' && !apiKey) {
      core.setFailed('api-key is required for Gemini backend');
      return;
    }

    const context = github.context;
    if (context.eventName !== 'pull_request' && context.eventName !== 'pull_request_target') {
      core.setFailed('This action only works on pull_request events');
      return;
    }

    const prNumber = context.payload.pull_request?.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    if (!prNumber) {
      core.setFailed('Could not determine PR number');
      return;
    }

    core.info(`Reviewing PR #${prNumber} in ${owner}/${repo}`);

    const octokit = github.getOctokit(token);

    core.info('Fetching PR files...');
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 300,
    });

    if (!files || files.length === 0) {
      core.info('No files changed in this PR');
      await postComment(octokit, owner, repo, prNumber, '✅ No files changed in this PR.');
      core.setOutput('issues-found', '0');
      return;
    }

    const relevantFiles = files.filter(f => f.patch && isAccessibilityRelevant(f.filename));

    if (relevantFiles.length === 0) {
      core.info('No accessibility-relevant files found');
      await postComment(octokit, owner, repo, prNumber, '✅ No accessibility-relevant changes found in this PR.');
      core.setOutput('issues-found', '0');
      return;
    }

    core.info(`Found ${relevantFiles.length} accessibility-relevant files`);

    const diffContent = formatDiffForAnalysis(relevantFiles);

    if (!diffContent.trim()) {
      core.info('No relevant code changes found');
      core.setOutput('issues-found', '0');
      return;
    }

    const prompt = buildPrompt(owner, repo, prNumber);

    core.info(`Analyzing with ${llmBackend} (${model})...`);

    let result: AnalysisResult;

    if (llmBackend === 'gemini') {
      const client = new GeminiClient(apiKey, model);
      result = await client.analyze(diffContent, prompt);
    } else {
      const client = new OllamaClient(ollamaUrl, model);
      result = await client.analyze(diffContent, prompt);
    }

    const issues = result.issues;
    const summary = result.summary;

    core.info(`Found ${issues.length} accessibility issues`);

    const maxIssues = 50;
    const limitedIssues = issues.slice(0, maxIssues);

    if (limitedIssues.length > 0) {
      const comment = formatReviewComment(limitedIssues, summary);
      await postComment(octokit, owner, repo, prNumber, comment);
    } else {
      const comment = formatNoIssuesComment();
      await postComment(octokit, owner, repo, prNumber, comment);
    }

    core.setOutput('issues-found', String(limitedIssues.length));
    core.info('Review complete!');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed: ${message}`);
    core.debug(`Stack trace: ${error instanceof Error ? error.stack : 'N/A'}`);
  }
}

async function postComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const botComment = comments.find(c =>
    c.user?.type === 'Bot' &&
    c.body?.includes('<!-- a11y-review -->')
  );

  if (botComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: botComment.id,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }
}

function formatReviewComment(issues: A11yIssue[], summary?: string): string {
  const sections: string[] = [
    '<!-- a11y-review -->',
    '## ♿ Accessibility Review',
    '',
    summary ? `> ${summary}` : '> Automated WCAG 2.1/2.2 accessibility analysis',
    '',
  ];

  const critical = issues.filter(i => i.severity === 'CRITICAL');
  const important = issues.filter(i => i.severity === 'IMPORTANT');
  const suggestion = issues.filter(i => i.severity === 'SUGGESTION');
  const nit = issues.filter(i => i.severity === 'NIT');

  if (critical.length > 0) {
    sections.push('### 🔴 Critical Issues');
    sections.push('');
    for (const issue of critical) {
      sections.push(formatIssue(issue));
    }
  }

  if (important.length > 0) {
    sections.push('### 🟠 Important Issues');
    sections.push('');
    for (const issue of important) {
      sections.push(formatIssue(issue));
    }
  }

  if (suggestion.length > 0) {
    sections.push('### 🟡 Suggestions');
    sections.push('');
    for (const issue of suggestion) {
      sections.push(formatIssue(issue));
    }
  }

  if (nit.length > 0) {
    sections.push('### ⚪ Minor Issues');
    sections.push('');
    for (const issue of nit) {
      sections.push(formatIssue(issue));
    }
  }

  sections.push('');
  sections.push('---');
  sections.push('*🤖 This review was automatically generated. Please verify all suggestions.*');

  return sections.join('\n');
}

function formatIssue(issue: A11yIssue): string {
  const lines: string[] = [
    `**${issue.file}${issue.line ? `:${issue.line}` : ''}**`,
    `- **WCAG ${issue.wcag_criterion}** (Level ${issue.wcag_level})`,
    `- ${issue.description}`,
  ];

  if (issue.suggestion) {
    lines.push(`- **Fix**: ${issue.suggestion}`);
  }

  lines.push('');
  return lines.join('\n');
}

function formatNoIssuesComment(): string {
  return [
    '<!-- a11y-review -->',
    '## ✅ Accessibility Review',
    '',
    'No accessibility issues were found in this PR.',
    '',
    'The changes appear to follow WCAG 2.1/2.2 guidelines.',
    '',
    '---',
    '*🤖 This review was automatically generated.*',
  ].join('\n');
}

run();