/**
 * Core type definitions for the A11y PR Review action
 */

export enum Severity {
  CRITICAL = 'CRITICAL',
  IMPORTANT = 'IMPORTANT',
  SUGGESTION = 'SUGGESTION',
  NIT = 'NIT'
}

export interface A11yIssue {
  file: string;
  line: number;
  wcag_criterion: string;
  wcag_level: 'A' | 'AA' | 'AAA';
  severity: Severity;
  title: string;
  description: string;
  suggestion: string;
  element?: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  issues: A11yIssue[];
  summary?: string;
}

export interface PRFile {
  path: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  raw_url?: string;
}

export interface PRCommit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface ReviewState {
  pr_number: number;
  repository: string;
  created_at: string;
  updated_at: string;
  reviewed_commits: string[];
  suggested_issues: IssueRecord[];
  comment_issues: IssueRecord[];
  last_review_sha?: string;
  review_count: number;
}

export interface IssueRecord {
  hash: string;
  file: string;
  line_start: number;
  line_end: number;
  severity: string;
  wcag_criterion: string;
  title: string;
  commit_sha: string;
  first_reported: string;
}

export interface LineChange {
  oldLine: number | null;
  newLine: number | null;
  content: string;
  type: 'add' | 'delete' | 'context';
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  changes: LineChange[];
  isBinary: boolean;
  isRename: boolean;
  isDeletion: boolean;
  isNew: boolean;
}

export interface ParsedDiff {
  files: FileDiff[];
}