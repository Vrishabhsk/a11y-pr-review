import * as github from '@actions/github';
import { A11yIssue, groupIssuesByFile, MAX_ISSUES } from '../state/types';

type Octokit = ReturnType<typeof github.getOctokit>;

const COMMENT_IDENTIFIER = '<!-- a11y-review -->';

export async function createOrUpdateComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<number> {
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

  const fullBody = `${COMMENT_IDENTIFIER}\n${body}`;

  if (botComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: botComment.id,
      body: fullBody,
    });
    return botComment.id;
  } else {
    const { data: newComment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: fullBody,
    });
    return newComment.id;
  }
}

export function formatIssueComment(
  allIssues: A11yIssue[],
  newIssues: A11yIssue[],
  summary?: string
): string {
  const sections: string[] = [];

  const total = Math.min(allIssues.length, MAX_ISSUES);
  const newCount = newIssues.length;

  sections.push('## ♿ Accessibility Review', '');

  if (summary) {
    sections.push(`> ${summary}`, '');
  }

  const newLabel = newCount > 0 ? ` (${newCount} new since last analysis)` : '';
  sections.push(`**Found ${total} issue${total === 1 ? '' : 's'}${newLabel}:**`, '');

  const persistedFiles = new Set<string>();
  for (const issue of allIssues) {
    if (!newIssues.includes(issue)) {
      persistedFiles.add(issue.file);
    }
  }

  const newFiles = new Set<string>();
  for (const issue of newIssues) {
    newFiles.add(issue.file);
  }

  const critical = allIssues.filter(i => i.severity === 'CRITICAL').slice(0, MAX_ISSUES);
  const important = allIssues.filter(i => i.severity === 'IMPORTANT').slice(0, MAX_ISSUES);
  const suggestions = allIssues.filter(i => i.severity === 'SUGGESTION').slice(0, MAX_ISSUES);
  const nits = allIssues.filter(i => i.severity === 'NIT').slice(0, MAX_ISSUES);

  if (critical.length > 0) {
    sections.push('### 🔴 Critical Issues', '');
    for (const issue of critical) {
      sections.push(formatIssueItem(issue, newIssues));
    }
  }

  if (important.length > 0) {
    sections.push('### 🟠 Important Issues', '');
    for (const issue of important) {
      sections.push(formatIssueItem(issue, newIssues));
    }
  }

  if (suggestions.length > 0) {
    sections.push('### 🟡 Suggestions', '');
    for (const issue of suggestions) {
      sections.push(formatIssueItem(issue, newIssues));
    }
  }

  if (nits.length > 0) {
    sections.push('### ⚪ Minor Improvements', '');
    for (const issue of nits) {
      sections.push(formatIssueItem(issue, newIssues));
    }
  }

  sections.push('');
  sections.push('---');
  sections.push('*🤖 This review was automatically generated. Please verify all suggestions.*');

  return sections.join('\n');
}

function formatIssueItem(issue: A11yIssue, newIssues: A11yIssue[]): string {
  const lines: string[] = [];
  const isNew = newIssues.includes(issue);
  const newBadge = isNew ? ' ⚡ **NEW**' : '';

  const location = issue.file + (issue.line ? `:${issue.line}` : '');
  lines.push(`- **${location}**${newBadge} - ${issue.title || issue.description}`);
  lines.push(`  - WCAG ${issue.wcag_criterion} (Level ${issue.wcag_level})`);

  if (issue.suggestion) {
    lines.push(`  - **Fix:** ${issue.suggestion}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function formatNoIssuesComment(summary?: string): string {
  const lines: string[] = [
    '## ✅ Accessibility Review',
    '',
  ];

  if (summary) {
    lines.push(`> ${summary}`, '');
  }

  lines.push('No accessibility issues were found.');
  lines.push('');
  lines.push('The changes appear to follow WCAG 2.1/2.2 guidelines.');
  lines.push('');
  lines.push('---');
  lines.push('*🤖 This review was automatically generated.*');

  return lines.join('\n');
}

export function formatDraftSkipComment(): string {
  return [
    '## ♿ Accessibility Review',
    '',
    '⏸️ **Skipped** - This PR is a draft.',
    '',
    'Accessibility analysis will run when the PR is marked as ready for review.',
    '',
    '---',
    '*🤖 This review was automatically generated.*',
  ].join('\n');
}

export function formatNoChangesComment(): string {
  return [
    '## ♿ Accessibility Review',
    '',
    'No new accessibility-relevant changes since last analysis.',
    '',
    '---',
    '*🤖 This review was automatically generated.*',
  ].join('\n');
}