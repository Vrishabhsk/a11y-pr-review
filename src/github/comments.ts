import * as github from '@actions/github';
import { A11yIssue } from '../state/types';

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

export function formatIssueComment(issues: A11yIssue[], summary?: string, newIssueCount: number = 0): string {
  const sections: string[] = [];

  sections.push('## ♿ Accessibility Review', '');

  if (summary) {
    sections.push(`> ${summary}`, '');
  }

  const total = issues.length;
  const newLabel = newIssueCount > 0 ? ` (${newIssueCount} new)` : '';
  sections.push(`**Found ${total} issue${total === 1 ? '' : 's'}${newLabel}:**`, '');

  const critical = issues.filter(i => i.severity === 'CRITICAL');
  const important = issues.filter(i => i.severity === 'IMPORTANT');
  const suggestions = issues.filter(i => i.severity === 'SUGGESTION');
  const nits = issues.filter(i => i.severity === 'NIT');

  if (critical.length > 0) {
    sections.push('### 🔴 Critical Issues', '');
    for (const issue of critical) {
      sections.push(formatIssueItem(issue));
    }
  }

  if (important.length > 0) {
    sections.push('### 🟠 Important Issues', '');
    for (const issue of important) {
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

export function formatNoIssuesComment(summary?: string): string {
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

  return lines.join('\n');
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