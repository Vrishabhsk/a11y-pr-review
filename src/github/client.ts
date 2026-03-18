import * as core from '@actions/core';
import * as github from '@actions/github';
import { A11yIssue, FilePatch, PRInfo } from '../state/types';

type Octokit = ReturnType<typeof github.getOctokit>;

export async function getPRInfo(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRInfo> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  return {
    number: pr.number,
    draft: pr.draft || false,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    title: pr.title,
  };
}

export async function getPRFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<FilePatch[]> {
  const files: FilePatch[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: perPage,
      page,
    });

    if (data.length === 0) break;

    for (const file of data) {
      files.push({
        filename: file.filename,
        patch: file.patch || '',
        status: file.status as 'added' | 'modified' | 'removed' | 'renamed',
      });
    }

    if (data.length < perPage) break;
    page++;
  }

  return files;
}

export async function getFilesChangedBetween(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string
): Promise<Set<string>> {
  const changedFiles = new Set<string>();

  try {
    const { data: comparison } = await octokit.rest.repos.compareCommits({
      owner,
      repo,
      base: baseSha,
      head: headSha,
    });

    if (comparison.files) {
      for (const file of comparison.files) {
        if (file.status !== 'removed') {
          changedFiles.add(file.filename);
        }
        if (file.previous_filename && file.status === 'renamed') {
          changedFiles.add(file.previous_filename);
        }
      }
    }
  } catch (error) {
    core.warning(`Failed to get changed files: ${error}`);
  }

  return changedFiles;
}

export async function createReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  issuesForInlineComments: A11yIssue[],
  allIssues: A11yIssue[],
  filePatches: Map<string, string>
): Promise<number> {
  const comments: Array<{
    path: string;
    line: number;
    body: string;
  }> = [];

  for (const issue of issuesForInlineComments) {
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
    core.info('No valid inline comments to post');
    return 0;
  }

  const body = formatReviewBody(allIssues);

  const { data: review } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: headSha,
    event: 'COMMENT',
    body,
    comments: comments.map(c => ({
      path: c.path,
      line: c.line,
      body: c.body,
    })),
  });

  core.info(`Created review with ${comments.length} inline comments`);
  return review.id;
}

function formatReviewBody(allIssues: A11yIssue[]): string {
  const sections: string[] = ['## ♿ Accessibility Review', ''];

  const critical = allIssues.filter(i => i.severity === 'CRITICAL');
  const important = allIssues.filter(i => i.severity === 'IMPORTANT');
  const suggestions = allIssues.filter(i => i.severity === 'SUGGESTION');
  const nits = allIssues.filter(i => i.severity === 'NIT');

  // Summary counts
  sections.push(`Found **${allIssues.length}** issue${allIssues.length === 1 ? '' : 's'}:`);
  sections.push('');
  if (critical.length > 0) sections.push(`- 🔴 **${critical.length}** Critical`);
  if (important.length > 0) sections.push(`- 🟠 **${important.length}** Important`);
  if (suggestions.length > 0) sections.push(`- 🟡 **${suggestions.length}** Suggestions`);
  if (nits.length > 0) sections.push(`- ⚪ **${nits.length}** Minor`);

  sections.push('');
  sections.push('---');
  sections.push('');

  // Detailed issues by severity
  if (critical.length > 0) {
    sections.push('### 🔴 Critical Issues', '');
    for (const issue of critical) {
      sections.push(formatIssueInBody(issue));
    }
  }

  if (important.length > 0) {
    sections.push('### 🟠 Important Issues', '');
    for (const issue of important) {
      sections.push(formatIssueInBody(issue));
    }
  }

  if (suggestions.length > 0) {
    sections.push('### 🟡 Suggestions', '');
    for (const issue of suggestions) {
      sections.push(formatIssueInBody(issue));
    }
  }

  if (nits.length > 0) {
    sections.push('### ⚪ Minor Improvements', '');
    for (const issue of nits) {
      sections.push(formatIssueInBody(issue));
    }
  }

  sections.push('---');
  sections.push('*Review each inline suggestion and apply fixes as needed. 🤖*');

  return sections.join('\n');
}

function formatIssueInBody(issue: A11yIssue): string {
  const lines: string[] = [];
  const location = issue.file + (issue.line ? `:${issue.line}` : '');
  lines.push(`**${location}** - ${issue.title || issue.description}`);
  lines.push(`- WCAG ${issue.wcag_criterion} (Level ${issue.wcag_level})`);
  if (issue.suggestion) {
    lines.push(`- **Fix:** ${issue.suggestion}`);
  }
  lines.push('');
  return lines.join('\n');
}

function findLineInPatch(patch: string, targetLine: number): number | null {
  const lines = patch.split('\n');
  let currentNewLine = 0;

  const hunkHeaderRegex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  let inHunk = false;

  for (const line of lines) {
    const match = line.match(hunkHeaderRegex);
    if (match) {
      currentNewLine = parseInt(match[1], 10);
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
      // Deleted line, don't increment
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