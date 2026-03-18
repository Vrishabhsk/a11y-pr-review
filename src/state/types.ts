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
  lastAnalyzedSha: string;
  analyzedFiles: string[];
  issueHashes: string[];
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

export interface ReviewCommentInfo {
  id: number;
  path: string;
  line: number | null;
  body: string;
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