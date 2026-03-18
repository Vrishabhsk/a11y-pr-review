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

  // eslint-disable-next-line no-constant-condition
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
  criticalAndImportant: A11yIssue[],
  suggestionsAndNits: A11yIssue[],
  filePatches: Map<string, string>
): Promise<{ reviewId: number; postedInlineCount: number; failedInlineIssues: A11yIssue[] }> {
  const comments: Array<{
    path: string;
    line: number;
    body: string;
  }> = [];

  const failedInlineIssues: A11yIssue[] = [];

  // Try to create inline comments for CRITICAL and IMPORTANT
  for (const issue of criticalAndImportant) {
    if (!issue) continue;
    
    // Issues without line numbers go to failed
    if (!issue.line || issue.line < 1 || !issue.file) {
      failedInlineIssues.push(issue);
      continue;
    }

    const patch = filePatches.get(issue.file);
    if (!patch) {
      failedInlineIssues.push(issue);
      continue;
    }

    const position = findLineInPatch(patch, issue.line);
    if (position === null) {
      failedInlineIssues.push(issue);
      continue;
    }

    comments.push({
      path: issue.file,
      line: position,
      body: formatInlineComment(issue),
    });
  }

  // Build review body - SUGGESTION/NIT + FAILED inline (CRITICAL/IMPORTANT fallback)
  const body = formatReviewBody(suggestionsAndNits, failedInlineIssues);

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

  core.info(`Created review with ${comments.length} inline comments, ${failedInlineIssues.length} issues in body (no line info)`);
  return { reviewId: review.id, postedInlineCount: comments.length, failedInlineIssues };
}

function formatReviewBody(suggestionsAndNits: A11yIssue[], failedInlineIssues: A11yIssue[] = []): string {
  const hasContent = suggestionsAndNits.length > 0 || failedInlineIssues.length > 0;

  if (!hasContent) {
    return '## ♿ Accessibility Review\n\n✅ No issues found.';
  }

  const sections: string[] = ['## ♿ Accessibility Review', ''];

  // Failed inline issues (CRITICAL/IMPORTANT without line numbers) - go in body as fallback
  if (failedInlineIssues.length > 0) {
    const critical = failedInlineIssues.filter(i => i?.severity === 'CRITICAL');
    const important = failedInlineIssues.filter(i => i?.severity === 'IMPORTANT');

    if (critical.length > 0) {
      sections.push('### 🔴 Critical Issues');
      sections.push('');
      for (const issue of critical) {
        if (!issue) continue;
        sections.push(`**${issue.file || 'Unknown file'}**`);
        sections.push(`- ${issue.title || issue.description || 'No description'}`);
        if (issue.wcag_criterion) {
          sections.push(`  - WCAG ${issue.wcag_criterion} (Level ${issue.wcag_level || 'A'})`);
        }
        sections.push('');
      }
    }

    if (important.length > 0) {
      sections.push('### 🟡 Important Issues');
      sections.push('');
      for (const issue of important) {
        if (!issue) continue;
        sections.push(`**${issue.file || 'Unknown file'}**`);
        sections.push(`- ${issue.title || issue.description || 'No description'}`);
        if (issue.wcag_criterion) {
          sections.push(`  - WCAG ${issue.wcag_criterion} (Level ${issue.wcag_level || 'A'})`);
        }
        sections.push('');
      }
    }
  }

  const suggestions = suggestionsAndNits.filter(i => i?.severity === 'SUGGESTION');
  const nits = suggestionsAndNits.filter(i => i?.severity === 'NIT');

  if (suggestions.length > 0) {
    sections.push('### 🟢 Suggestions');
    sections.push('');
    for (const issue of suggestions) {
      if (!issue) continue;
      const location = (issue.file || 'Unknown') + (issue.line ? `:${issue.line}` : '');
      sections.push(`**${location}**`);
      sections.push(`${issue.title || issue.description || 'No description'}`);
      if (issue.suggestion) {
        sections.push(`\`\`\`${issue.suggestion}\`\`\``);
      }
      sections.push('');
    }
  }

  if (nits.length > 0) {
    sections.push('### ⚪ Minor Issues');
    sections.push('');
    for (const issue of nits) {
      if (!issue) continue;
      const location = (issue.file || 'Unknown') + (issue.line ? `:${issue.line}` : '');
      sections.push(`- ${location}: ${issue.title || issue.description || 'No description'}`);
    }
    sections.push('');
  }

  sections.push('---');
  sections.push('*🤖 Generated by accessibility review*');

  return sections.join('\n');
}

function formatInlineComment(issue: A11yIssue): string {
  if (!issue) {
    return '🔴 **Unknown Issue**\n\nUnable to format issue details.';
  }
  
  const emoji = issue.severity === 'CRITICAL' ? '🔴' : '🟡';
  const lines: string[] = [
    `${emoji} **${issue.title || 'Accessibility Issue'}**`,
    '',
    `**WCAG ${issue.wcag_criterion || 'Unknown'}** (Level ${issue.wcag_level || 'A'})`,
    '',
    issue.description || 'No description available',
  ];

  if (issue.suggestion) {
    lines.push('', '**Fix:**', '```suggestion', issue.suggestion, '```');
  }

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