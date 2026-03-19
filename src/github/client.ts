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

  for (const issue of criticalAndImportant) {
    if (!issue) continue;
    
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

  const body = formatReviewBody(criticalAndImportant, suggestionsAndNits, comments.length, failedInlineIssues.length);

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
  return { reviewId: review.id, postedInlineCount: comments.length, failedInlineIssues };
}

function formatReviewBody(
  criticalAndImportant: A11yIssue[],
  suggestionsAndNits: A11yIssue[],
  postedInlineCount: number,
  failedInlineCount: number
): string {
  const critical = criticalAndImportant.filter(i => i?.severity === 'CRITICAL');
  const important = criticalAndImportant.filter(i => i?.severity === 'IMPORTANT');
  const suggestions = suggestionsAndNits.filter(i => i?.severity === 'SUGGESTION');
  const nits = suggestionsAndNits.filter(i => i?.severity === 'NIT');

  const totalCritical = critical.length;
  const totalImportant = important.length;
  const totalSuggestions = suggestions.length;
  const totalNits = nits.length;
  const totalIssues = totalCritical + totalImportant + totalSuggestions + totalNits;

  if (totalIssues === 0) {
    return '## ♿ Accessibility Review\n\n✅ No issues found.';
  }

  const sections: string[] = ['## ♿ Accessibility Review', ''];

  // Summary line
  const parts: string[] = [];
  if (totalCritical > 0) parts.push(`🔴 ${totalCritical} critical`);
  if (totalImportant > 0) parts.push(`🟡 ${totalImportant} important`);
  if (totalSuggestions > 0) parts.push(`🟢 ${totalSuggestions} suggestion${totalSuggestions !== 1 ? 's' : ''}`);
  if (totalNits > 0) parts.push(`⚪ ${totalNits} nit${totalNits !== 1 ? 's' : ''}`);

  const inlinePosted = postedInlineCount + failedInlineCount;
  if (inlinePosted > 0) {
    sections.push(`**Found ${totalIssues} issue${totalIssues !== 1 ? 's' : ''}:** ${parts.join(', ')}`);
    if (postedInlineCount > 0) {
      sections.push(`\n*${postedInlineCount} critical/important issue${postedInlineCount !== 1 ? 's' : ''} posted as inline comments above.*`);
    }
    sections.push('');
  }

  // Failed inline issues (CRITICAL/IMPORTANT without line numbers)
  if (failedInlineCount > 0) {
    sections.push('### ⚠️ Issues Without Line Numbers');
    sections.push('');
    
    for (const issue of critical) {
      if (!issue.line || issue.line < 1) {
        sections.push(`- **${issue.file || 'Unknown'}**: ${issue.title || issue.description || 'No description'}`);
        if (issue.wcag_criterion) {
          sections.push(`  - WCAG ${issue.wcag_criterion} (Level ${issue.wcag_level || 'A'})`);
        }
      }
    }
    
    for (const issue of important) {
      if (!issue.line || issue.line < 1) {
        sections.push(`- **${issue.file || 'Unknown'}**: ${issue.title || issue.description || 'No description'}`);
        if (issue.wcag_criterion) {
          sections.push(`  - WCAG ${issue.wcag_criterion} (Level ${issue.wcag_level || 'A'})`);
        }
      }
    }
    sections.push('');
  }

  // SUGGESTION details
  if (totalSuggestions > 0) {
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

  // NIT details
  if (totalNits > 0) {
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