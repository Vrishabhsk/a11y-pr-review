/**
 * Inline suggestion submission for accessibility issues
 */

import { GitHubClient } from './client';
import { A11yIssue } from '../types';
import { Severity, getSeverityEmoji } from '../prompts/severity';

export function formatSuggestionComment(issue: A11yIssue): string {
  const emoji = getSeverityEmoji(issue.severity as Severity);
  const lines = [
    `${emoji} **${issue.title}**`,
    '',
    `**WCAG ${issue.wcag_criterion}** (Level ${issue.wcag_level})`,
    `**Severity:** ${issue.severity}`,
    '',
    issue.description,
  ];

  if (issue.suggestion) {
    lines.push('', '**Suggested fix:**', '```suggestion', issue.suggestion, '```');
  }

  if (issue.element) {
    lines.push('', `_Element: \`${issue.element}\`_`);
  }

  return lines.join('\n');
}

export class InlineSuggestionManager {
  private github: GitHubClient;
  private maxCommentsPerReview = 50;

  constructor(github: GitHubClient) {
    this.github = github;
  }

  async createReviewWithSuggestions(
    prNumber: number,
    issues: A11yIssue[],
    commitId?: string
  ): Promise<void> {
    // Filter to CRITICAL and IMPORTANT only
    const criticalIssues = issues.filter(
      i => i.severity === Severity.CRITICAL || i.severity === Severity.IMPORTANT
    );

    if (criticalIssues.length === 0) {
      return;
    }

    // Format comments
    const comments = criticalIssues.slice(0, this.maxCommentsPerReview).map(issue => ({
      path: issue.file,
      position: Math.max(1, issue.line),
      body: formatSuggestionComment(issue),
    }));

    // Build review body
    const criticalCount = criticalIssues.filter(i => i.severity === Severity.CRITICAL).length;
    const importantCount = criticalIssues.filter(i => i.severity === Severity.IMPORTANT).length;

    const bodyLines = [
      '## 🔍 Accessibility Review',
      '',
      `Found **${criticalIssues.length}** accessibility issues that require attention.`,
      '',
    ];

    if (criticalCount > 0) {
      bodyLines.push(`- 🔴 **${criticalCount}** Critical issues`);
    }
    if (importantCount > 0) {
      bodyLines.push(`- 🟠 **${importantCount}** Important issues`);
    }

    bodyLines.push(
      '',
      '---',
      '*This review was automatically generated. Please review each suggestion and apply fixes as needed.*'
    );

    await this.github.createReview(
      prNumber,
      bodyLines.join('\n'),
      'COMMENT',
      comments,
      commitId
    );
  }
}