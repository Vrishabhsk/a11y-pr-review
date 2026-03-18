export interface A11yIssue {
  file: string;
  line: number | null;
  wcag_criterion: string;
  wcag_level: string;
  severity: 'CRITICAL' | 'IMPORTANT' | 'SUGGESTION' | 'NIT';
  title: string;
  description: string;
  suggestion: string;
}

export interface CheckRunState {
  version: number;
  lastAnalyzedHeadSha: string;
  prNumber: number;
  issuesByFile: Record<string, A11yIssue[]>;
}

export interface PreviousRun {
  checkRunId: number;
  state: CheckRunState;
}

export interface FilePatch {
  filename: string;
  patch: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
}

export interface PRInfo {
  number: number;
  draft: boolean;
  headSha: string;
  baseSha: string;
  title?: string;
}

export interface ReviewCommentInfo {
  id: number;
  path: string;
  line: number | null;
  body: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
}

const CHECK_RUN_NAME_PREFIX = 'Accessibility Review';

export function getCheckRunName(prNumber: number): string {
  return `${CHECK_RUN_NAME_PREFIX} (PR #${prNumber})`;
}

export function hashIssue(issue: A11yIssue): string {
  const title = issue.title || issue.description || '';
  return `${issue.file}:${issue.wcag_criterion}:${title}`;
}

export function parseIssueHash(hash: string): { file: string; wcag_criterion: string; title: string } | null {
  const parts = hash.split(':');
  if (parts.length < 3) return null;
  return {
    file: parts[0],
    wcag_criterion: parts[1],
    title: parts.slice(2).join(':'),
  };
}

export function groupIssuesByFile(issues: A11yIssue[]): Record<string, A11yIssue[]> {
  const grouped: Record<string, A11yIssue[]> = {};
  for (const issue of issues) {
    if (!grouped[issue.file]) {
      grouped[issue.file] = [];
    }
    grouped[issue.file].push(issue);
  }
  return grouped;
}

export function flattenIssues(issuesByFile: Record<string, A11yIssue[]>): A11yIssue[] {
  const allIssues: A11yIssue[] = [];
  for (const issues of Object.values(issuesByFile)) {
    allIssues.push(...issues);
  }
  return allIssues;
}

export const MAX_ISSUES = 100;
export const BATCH_SIZE = 20;