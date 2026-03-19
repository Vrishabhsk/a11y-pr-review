import * as core from '@actions/core';
import * as github from '@actions/github';
import { A11yIssue, FilePatch } from '../state/types';

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

// Map file line numbers to diff position indices
function buildLineToPositionMap(patch: string): Map<number, number> {
  const lineMap = new Map<number, number>();
  const lines = patch.split('\n');
  
  let newLineNum = 0;
  let position = 0;
  let inHunk = false;

  for (const line of lines) {
    // Match hunk header: @@ -a,b +c,d @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    
    if (hunkMatch) {
      newLineNum = parseInt(hunkMatch[1], 10);
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    position++; // Position in the diff (1-indexed relative to hunk start)

    if (line.startsWith('+')) {
      // Added line - maps to this position
      lineMap.set(newLineNum, position);
      newLineNum++;
    } else if (line.startsWith('-')) {
      // Deleted line - not in new file, skip
    } else if (line.startsWith(' ')) {
      // Context line - exists in both old and new
      newLineNum++;
    } else if (!line.startsWith('\\')) {
      // Other lines (like "\ No newline at end of file")
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
  _filePatches: Map<string, string>
): Promise<{ reviewId: number; postedInlineCount: number; unpostedViolations: A11yIssue[] }> {
  // Get fresh PR file data with patches
  const { data: prFiles } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  // Build line-to-position maps for each file
  const fileLineMaps = new Map<string, Map<number, number>>();
  for (const file of prFiles) {
    if (file.patch) {
      fileLineMaps.set(file.filename, buildLineToPositionMap(file.patch));
    }
  }

  const comments: Array<{
    path: string;
    position: number;
    body: string;
  }> = [];

  const unpostedViolations: A11yIssue[] = [];

  // Create inline comments ONLY for violations
  for (const issue of violations) {
    if (!issue || !issue.line || issue.line < 1 || !issue.file) {
      unpostedViolations.push(issue);
      continue;
    }

    const lineMap = fileLineMaps.get(issue.file);
    if (!lineMap) {
      core.warning(`No patch found for ${issue.file}, skipping inline comment`);
      unpostedViolations.push(issue);
      continue;
    }

    const position = lineMap.get(issue.line);
    if (position === undefined) {
      core.warning(`Line ${issue.line} not found in diff for ${issue.file}, skipping inline comment`);
      unpostedViolations.push(issue);
      continue;
    }

    comments.push({
      path: issue.file,
      position: position,
      body: formatInlineComment(issue),
    });
  }

  core.info(`Prepared ${comments.length} inline comments, ${unpostedViolations.length} violations without position`);

  // Build review body
  const body = formatReviewBody(violations, goodPractices, unpostedViolations);

  const { data: review } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: headSha,
    event: 'COMMENT',
    body,
    comments,
  });

  core.info(`Created review with ${comments.length} inline comments`);
  return { reviewId: review.id, postedInlineCount: comments.length, unpostedViolations };
}

function formatReviewBody(
  violations: A11yIssue[],
  goodPractices: A11yIssue[],
  unpostedViolations: A11yIssue[]
): string {
  const sections: string[] = ['## ♿ Accessibility Review', ''];

  const totalViolations = violations.length;
  const totalGoodPractices = goodPractices.length;

  if (totalViolations === 0 && totalGoodPractices === 0) {
    sections.push('✅ **No issues found.**');
    sections.push('');
    sections.push('The code appears to follow WCAG 2.2 guidelines.');
  } else {
    const parts: string[] = [];
    if (totalViolations > 0) {
      parts.push(`🔴 **${totalViolations} violation${totalViolations !== 1 ? 's' : ''}**`);
    }
    if (totalGoodPractices > 0) {
      parts.push(`🟢 **${totalGoodPractices} good practice${totalGoodPractices !== 1 ? 's' : ''}**`);
    }
    
    sections.push(`**Found:** ${parts.join(' · ')}`);
    sections.push('');

    // Violations posted as inline comments
    if (violations.length > 0) {
      const postedCount = violations.length - unpostedViolations.length;
      sections.push('---');
      sections.push('');
      sections.push('### ⚠️ Violations');
      sections.push('');
      
      if (postedCount > 0) {
        sections.push(`See the **${postedCount} inline comment${postedCount !== 1 ? 's' : ''}** above for details.`);
        sections.push('');
      }

      // Violations without inline position go in body
      if (unpostedViolations.length > 0) {
        sections.push(`**${unpostedViolations.length} violation${unpostedViolations.length !== 1 ? 's' : ''} without inline comments:**`);
        sections.push('');
        for (const issue of unpostedViolations) {
          const location = (issue.file || 'Unknown') + (issue.line ? `:${issue.line}` : '');
          sections.push(`- **${location}** - ${issue.title || 'Accessibility violation'}`);
          if (issue.wcag_criterion) {
            sections.push(`  - WCAG ${issue.wcag_criterion} (Level ${issue.wcag_level || 'A'})`);
          }
        }
        sections.push('');
      }
    }

    // Good practices section
    if (goodPractices.length > 0) {
      sections.push('---');
      sections.push('');
      sections.push('### 🟢 Good Practices');
      sections.push('');
      sections.push('These accessibility improvements are **recommended** to enhance UX:');
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

  if (issue.suggestion && issue.suggestion.trim()) {
    const trimmedSuggestion = issue.suggestion.trim();
    const isCodeSuggestion = isLikelyCode(trimmedSuggestion);

    if (isCodeSuggestion) {
      lines.push('');
      lines.push('**Suggested fix:**');
      lines.push('```suggestion');
      lines.push(trimmedSuggestion);
      lines.push('```');
    } else {
      lines.push('');
      lines.push(`**Suggested fix:** ${trimmedSuggestion}`);
    }
  }

  return lines.join('\n');
}

function isLikelyCode(text: string): boolean {
  const codeIndicators = [
    '<', '>', '{', '}', '()', '=>', 'function', 'const ', 'let ', 'var ',
    'class ', 'import ', 'export ', 'return ', 'if ', 'for ', 'while ',
    '=>', '->', '===', '!==', '==', '!=', '&&', '||', ';', '=>',
    'aria-', 'data-', 'src=', 'href=', 'class=', 'id=', 'style=',
    'input', 'button', 'div', 'span', 'form', 'label', 'img', 'a ',
    'outline:', 'padding:', 'margin:', 'color:', 'background:',
  ];

  const lowerText = text.toLowerCase();
  let matchCount = 0;
  for (const indicator of codeIndicators) {
    if (lowerText.includes(indicator.toLowerCase())) {
      matchCount++;
    }
  }

  return matchCount >= 2;
}