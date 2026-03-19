import * as core from '@actions/core';
import * as github from '@actions/github';
import { A11yIssue, FilePatch, MAX_ISSUES } from '../state/types';
import { formatDiffForAnalysis } from '../parsers/diff-parser';

type Octokit = ReturnType<typeof github.getOctokit>;

export async function getPRInfo(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<{
  number: number;
  draft: boolean;
  headSha: string;
  baseSha: string;
  title?: string;
}> {
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

interface LinePosition {
  originalLine: number;  // Line number in the original file
  newLine: number;       // Line number in the new file (for GitHub API)
}

function parsePatchForLinePositions(patch: string): Map<number, number> {
  // Returns map of NEW file line number -> position in diff (for GitHub API)
  const lines = patch.split('\n');
  const lineMap = new Map<number, number>();
  
  let newLineNum = 0;
  let inHunk = false;
  let position = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    
    if (hunkMatch) {
      newLineNum = parseInt(hunkMatch[1], 10);
      inHunk = true;
      position++;
      continue;
    }

    if (!inHunk) continue;

    position++;  // Position for GitHub API (all lines in hunk)

    if (line.startsWith('+')) {
      // Added line - this is the new line number
      lineMap.set(newLineNum, position);
      newLineNum++;
    } else if (line.startsWith('-')) {
      // Deleted line - skip
    } else if (line.startsWith(' ')) {
      // Context line
      newLineNum++;
    } else if (!line.startsWith('\\')) {
      // Other content
      newLineNum++;
    }
  }

  return lineMap;
}

export async function createReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  violations: A11yIssue[],
  goodPractices: A11yIssue[],
  filePatches: Map<string, string>
): Promise<{ reviewId: number; postedInlineCount: number }> {
  const comments: Array<{
    path: string;
    line: number;
    body: string;
  }> = [];

  // Get PR diffs to find correct line positions
  const { data: prFiles } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  // Build line position maps for each file
  const fileLineMaps = new Map<string, Map<number, number>>();
  for (const file of prFiles) {
    if (file.patch) {
      fileLineMaps.set(file.filename, parsePatchForLinePositions(file.patch));
    }
  }

  // Create inline comments ONLY for violations
  for (const issue of violations) {
    if (!issue || !issue.line || issue.line < 1 || !issue.file) continue;

    const lineMap = fileLineMaps.get(issue.file);
    if (!lineMap) continue;

    const position = lineMap.get(issue.line);
    if (position === undefined) continue;

    comments.push({
      path: issue.file,
      line: position,
      body: formatInlineComment(issue),
    });
  }

  // Build review body with violation count and good practice details
  const body = formatReviewBody(violations, goodPractices);

  const { data: review } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: headSha,
    event: comments.length > 0 ? 'REQUEST_CHANGES' : 'COMMENT',
    body,
    comments: comments.map(c => ({
      path: c.path,
      line: c.line,
      body: c.body,
    })),
  });

  core.info(`Created review with ${comments.length} inline comments`);
  return { reviewId: review.id, postedInlineCount: comments.length };
}

function formatReviewBody(violations: A11yIssue[], goodPractices: A11yIssue[]): string {
  const sections: string[] = ['## ♿ Accessibility Review', ''];

  // Summary line
  if (violations.length === 0 && goodPractices.length === 0) {
    sections.push('✅ **No issues found.**');
    sections.push('');
    sections.push('The code appears to follow WCAG 2.2 guidelines.');
  } else {
    const parts: string[] = [];
    if (violations.length > 0) parts.push(`🔴 **${violations.length} violation${violations.length !== 1 ? 's' : ''}**`);
    if (goodPractices.length > 0) parts.push(`🟢 **${goodPractices.length} good practice${goodPractices.length !== 1 ? 's' : ''}**`);
    
    sections.push(`**Found:** ${parts.join(' · ')}`);
    sections.push('');

    if (violations.length > 0) {
      sections.push('---');
      sections.push('');
      sections.push('### ⚠️ Violations');
      sections.push('');
      sections.push('These issues **must be fixed** to meet WCAG 2.2 requirements.');
      sections.push('');
      sections.push(`See the **${violations.length} inline comment${violations.length !== 1 ? 's' : ''}** above for details.`);
      sections.push('');
    }

    if (goodPractices.length > 0) {
      sections.push('---');
      sections.push('');
      sections.push('### 🟢 Good Practices');
      sections.push('');
      sections.push('These are **recommended improvements** that enhance accessibility but are not required.');
      sections.push('');

      for (const issue of goodPractices) {
        if (!issue) continue;
        const location = (issue.file || 'Unknown') + (issue.line ? `:${issue.line}` : '');
        sections.push(`**${location}**`);
        sections.push(`> ${issue.title || 'Accessibility improvement'}`);
        if (issue.wcag_criterion) {
          sections.push(`> WCAG ${issue.wcag_criterion} (Level ${issue.wcag_level || 'A'})`);
        }
        if (issue.description) {
          sections.push(`> ${issue.description}`);
        }
        if (issue.suggestion) {
          sections.push('>');
          sections.push(`> \`\`\`${issue.suggestion}\`\`\``);
        }
        sections.push('');
      }
    }
  }

  sections.push('---');
  sections.push('*🤖 Generated by WCAG 2.2 Accessibility Review*');

  return sections.join('\n');
}

function formatInlineComment(issue: A11yIssue): string {
  const lines: string[] = [
    `🔴 **${issue.title || 'Accessibility Violation'}**`,
    '',
    `**WCAG ${issue.wcag_criterion || 'Unknown'}** (Level ${issue.wcag_level || 'A'})`,
    '',
    issue.description || 'This code does not meet WCAG 2.2 requirements.',
  ];

  if (issue.suggestion) {
    lines.push('');
    lines.push('**Suggested fix:**');
    lines.push('```suggestion');
    lines.push(issue.suggestion);
    lines.push('```');
  }

  return lines.join('\n');
}