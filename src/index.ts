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

interface FilePatch {
  filename: string;
  patch: string;
}

const COMMENT_IDENTIFIER = '<!-- a11y-review -->';

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

    const prNumber = context.payload.pull_request?.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const commitSha = context.sha;

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
      await postComment(octokit, owner, repo, prNumber, formatNoIssuesComment('No files changed in this PR.'));
      core.setOutput('issues-found', '0');
      return;
    }

    const relevantFiles = files.filter(f => f.patch && isAccessibilityRelevant(f.filename)) as FilePatch[];

    if (relevantFiles.length === 0) {
      core.info('No accessibility-relevant files found');
      await postComment(octokit, owner, repo, prNumber, formatNoIssuesComment('No accessibility-relevant changes found.'));
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
    
    // Debug: log raw severities
    for (const issue of issues) {
      core.debug(`Issue: ${issue.file}:${issue.line} - severity="${issue.severity}" - ${issue.title}`);
    }

    if (issues.length === 0) {
      await postComment(octokit, owner, repo, prNumber, formatNoIssuesComment(summary));
      core.setOutput('issues-found', '0');
      core.info('Review complete!');
      return;
    }

    const maxIssues = 50;
    const limitedIssues = issues.slice(0, maxIssues);

    const criticalAndImportant = limitedIssues.filter(
      i => i.severity === 'CRITICAL' || i.severity === 'IMPORTANT'
    );
    const suggestionsAndNits = limitedIssues.filter(
      i => i.severity === 'SUGGESTION' || i.severity === 'NIT'
    );

    const criticalCount = limitedIssues.filter(i => i.severity === 'CRITICAL').length;
    const importantCount = limitedIssues.filter(i => i.severity === 'IMPORTANT').length;
    const suggestionCount = limitedIssues.filter(i => i.severity === 'SUGGESTION').length;
    const nitCount = limitedIssues.filter(i => i.severity === 'NIT').length;

    core.info(`Critical: ${criticalCount}, Important: ${importantCount}, Suggestions: ${suggestionCount}, Nits: ${nitCount}`);
    core.info(`Critical+Important issues: ${criticalAndImportant.length}, Suggestion+Nit issues: ${suggestionsAndNits.length}`);

    const filePatches = new Map<string, string>();
    for (const file of relevantFiles) {
      filePatches.set(file.filename, file.patch);
    }

    if (criticalAndImportant.length > 0) {
      core.info('Creating review with inline comments for critical/important issues...');
      await createReviewWithInlineComments(
        octokit,
        owner,
        repo,
        prNumber,
        commitSha,
        criticalAndImportant,
        filePatches,
        summary
      );
    }

    if (suggestionsAndNits.length > 0) {
      core.info('Posting comment for suggestions and nits...');
      const comment = formatSuggestionComment(suggestionsAndNits, summary);
      await postComment(octokit, owner, repo, prNumber, comment, criticalAndImportant.length === 0);
    }

    if (criticalAndImportant.length === 0 && suggestionsAndNits.length === 0) {
      await postComment(octokit, owner, repo, prNumber, formatNoIssuesComment(summary));
    }

    core.setOutput('issues-found', String(limitedIssues.length));
    core.info(`Total issues found: ${limitedIssues.length}`);

    if (failOnIssues && limitedIssues.length > 0) {
      const criticalCount = limitedIssues.filter(i => i.severity === 'CRITICAL').length;
      const importantCount = limitedIssues.filter(i => i.severity === 'IMPORTANT').length;
      const suggestionCount = limitedIssues.filter(i => i.severity === 'SUGGESTION').length;
      const nitCount = limitedIssues.filter(i => i.severity === 'NIT').length;
      
      let message = `Accessibility issues found: ${limitedIssues.length} total`;
      if (criticalCount > 0) message += ` (${criticalCount} critical)`;
      if (importantCount > 0) message += ` (${importantCount} important)`;
      if (suggestionCount > 0) message += ` (${suggestionCount} suggestion)`;
      if (nitCount > 0) message += ` (${nitCount} nit)`;
      
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

async function createReviewWithInlineComments(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
  issues: A11yIssue[],
  filePatches: Map<string, string>,
  summary: string
): Promise<void> {
  const comments: Array<{
    path: string;
    line: number;
    body: string;
  }> = [];

  for (const issue of issues) {
    if (!issue.line || issue.line < 1) continue;
    if (!issue.file) continue;

    const patch = filePatches.get(issue.file);
    if (!patch) continue;

    const position = findLineInPatch(patch, issue.line);
    if (position === null) continue;

    comments.push({
      path: issue.file,
      line: position,
      body: formatInlineComment(issue),
    });
  }

  if (comments.length === 0) {
    core.info('No valid inline comments to post, falling back to PR comment');
    const comment = formatSuggestionComment(issues, summary);
    await postComment(octokit, owner, repo, prNumber, comment, true);
    return;
  }

  const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
  const importantCount = issues.filter(i => i.severity === 'IMPORTANT').length;

  let body = `## ♿ Accessibility Review\n\n`;
  body += `> ${summary}\n\n`;
  body += `Found **${issues.length}** issues requiring attention:\n\n`;
  if (criticalCount > 0) body += `- 🔴 **${criticalCount}** Critical\n`;
  if (importantCount > 0) body += `- 🟠 **${importantCount}** Important\n`;
  body += `\n---\n`;
  body += `*Please review each inline suggestion and apply fixes as needed.*`;

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: commitSha,
      event: 'COMMENT',
      body,
      comments: comments.map(c => ({
        path: c.path,
        line: c.line,
        body: c.body,
      })),
    });
    core.info(`Created review with ${comments.length} inline comments`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to create review with inline comments: ${msg}`);
    core.info('Falling back to PR comment');
    const comment = formatSuggestionComment(issues, summary);
    await postComment(octokit, owner, repo, prNumber, comment, true);
  }
}

function findLineInPatch(patch: string, targetLine: number): number | null {
  const lines = patch.split('\n');
  let currentNewLine = 0;

  const hunkHeaderRegex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  let inHunk = false;
  let hunkStartLine = 0;

  for (const line of lines) {
    const match = line.match(hunkHeaderRegex);
    if (match) {
      hunkStartLine = parseInt(match[1], 10);
      currentNewLine = hunkStartLine;
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith('+')) {
      if (currentNewLine === targetLine) {
        return currentNewLine;
      }
      currentNewLine++;
    } else if (line.startsWith('-')) {
    } else if (line.startsWith(' ')) {
      if (currentNewLine === targetLine) {
        return currentNewLine;
      }
      currentNewLine++;
    } else if (!line.startsWith('\\')) {
      if (currentNewLine === targetLine) {
        return currentNewLine;
      }
      currentNewLine++;
    }
  }

  return null;
}

function formatInlineComment(issue: A11yIssue): string {
  const emoji = issue.severity === 'CRITICAL' ? '🔴' : '🟠';
  const lines: string[] = [
    `${emoji} **${issue.title || 'Accessibility Issue'}**`,
    '',
    `**WCAG ${issue.wcag_criterion}** (Level ${issue.wcag_level})`,
    '',
    issue.description,
  ];

  if (issue.suggestion) {
    lines.push('', '**Suggested fix:**', '```suggestion', issue.suggestion, '```');
  }

  return lines.join('\n');
}

async function postComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  includeIdentifier: boolean = true
): Promise<void> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const botComment = comments.find(c =>
    c.user?.type === 'Bot' &&
    c.body?.includes(COMMENT_IDENTIFIER)
  );

  const fullBody = includeIdentifier ? `${COMMENT_IDENTIFIER}\n${body}` : body;

  if (botComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: botComment.id,
      body: fullBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: fullBody,
    });
  }
}

function formatSuggestionComment(issues: A11yIssue[], summary?: string): string {
  const sections: string[] = [];

  sections.push('## ♿ Accessibility Suggestions', '');

  if (summary) {
    sections.push(`> ${summary}`, '');
  }

  const suggestions = issues.filter(i => i.severity === 'SUGGESTION');
  const nits = issues.filter(i => i.severity === 'NIT');
  const others = issues.filter(i => i.severity !== 'SUGGESTION' && i.severity !== 'NIT');

  if (others.length > 0) {
    sections.push('### Issues', '');
    for (const issue of others) {
      sections.push(formatIssueItem(issue));
    }
  }

  if (suggestions.length > 0) {
    sections.push('### 🟡 Suggestions', '');
    for (const issue of suggestions) {
      sections.push(formatIssueItem(issue));
    }
  }

  if (nits.length > 0) {
    sections.push('### ⚪ Minor Improvements', '');
    for (const issue of nits) {
      sections.push(formatIssueItem(issue));
    }
  }

  sections.push('');
  sections.push('---');
  sections.push('*🤖 This review was automatically generated. Please verify all suggestions.*');

  return sections.join('\n');
}

function formatIssueItem(issue: A11yIssue): string {
  const lines: string[] = [];
  
  const location = issue.file + (issue.line ? `:${issue.line}` : '');
  lines.push(`- **${location}** - ${issue.title || issue.description}`);
  lines.push(`  - WCAG ${issue.wcag_criterion} (Level ${issue.wcag_level})`);
  
  if (issue.suggestion) {
    lines.push(`  - **Fix:** ${issue.suggestion}`);
  }
  
  lines.push('');
  return lines.join('\n');
}

function formatNoIssuesComment(summary?: string): string {
  const lines: string[] = [
    '## ✅ Accessibility Review',
    '',
  ];
  
  if (summary) {
    lines.push(`> ${summary}`, '');
  }
  
  lines.push('No accessibility issues were found in this PR.');
  lines.push('');
  lines.push('The changes appear to follow WCAG 2.1/2.2 guidelines.');
  lines.push('');
  lines.push('---');
  lines.push('*🤖 This review was automatically generated.*');

  return `${COMMENT_IDENTIFIER}\n${lines.join('\n')}`;
}

run();