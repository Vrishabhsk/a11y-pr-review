import * as core from '@actions/core';
import * as github from '@actions/github';
import { A11yIssue, FilePatch, PRInfo, CommitInfo, ReviewCommentInfo } from '../state/types';

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

export async function getCommitsBetween(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string
): Promise<CommitInfo[]> {
  const commits: CommitInfo[] = [];
  
  try {
    const { data: comparison } = await octokit.rest.repos.compareCommits({
      owner,
      repo,
      base: baseSha,
      head: headSha,
    });

    if (comparison.commits) {
      for (const commit of comparison.commits) {
        commits.push({
          sha: commit.sha,
          message: commit.commit.message,
        });
      }
    }
  } catch (error) {
    core.warning(`Failed to compare commits: ${error}`);
  }

  return commits;
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

export async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if ('content' in data && data.type === 'file') {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
  } catch (error) {
    core.warning(`Failed to get file content for ${path}: ${error}`);
  }

  return '';
}

export async function getReviewComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<ReviewCommentInfo[]> {
  const comments: ReviewCommentInfo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
      per_page: perPage,
      page,
    });

    if (data.length === 0) break;

    for (const comment of data) {
      comments.push({
        id: comment.id,
        path: comment.path,
        line: comment.line || comment.original_line || null,
        body: comment.body,
      });
    }

    if (data.length < perPage) break;
    page++;
  }

  return comments;
}

export async function createReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  issues: A11yIssue[],
  filePatches: Map<string, string>
): Promise<number> {
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
    core.info('No valid inline comments to post');
    return 0;
  }

  const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
  const importantCount = issues.filter(i => i.severity === 'IMPORTANT').length;

  let body = `## ♿ Accessibility Review\n\n`;
  body += `Found **${issues.length}** issues requiring attention:\n\n`;
  if (criticalCount > 0) body += `- 🔴 **${criticalCount}** Critical\n`;
  if (importantCount > 0) body += `- 🟠 **${importantCount}** Important\n`;
  body += `\n---\n`;
  body += `*Please review each inline suggestion and apply fixes as needed.*`;

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