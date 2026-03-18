/**
 * State persistence manager for deduplication
 */

import * as fs from 'fs';
import * as path from 'path';
import { ReviewState, IssueRecord, A11yIssue } from '../types';
import { generateIssueHash } from './deduplication';

const STATE_FILENAME = 'review_state.json';

export class StateManager {
  private stateDir: string;
  private state: ReviewState | null = null;

  constructor(stateDir: string = '/tmp/a11y-state') {
    this.stateDir = stateDir;
  }

  load(prNumber: number, repository: string): ReviewState {
    const statePath = path.join(this.stateDir, STATE_FILENAME);

    if (fs.existsSync(statePath)) {
      try {
        const content = fs.readFileSync(statePath, 'utf-8');
        const data = JSON.parse(content);
        this.state = {
          pr_number: data.pr_number,
          repository: data.repository,
          created_at: data.created_at,
          updated_at: data.updated_at,
          reviewed_commits: data.reviewed_commits || [],
          suggested_issues: data.suggested_issues || [],
          comment_issues: data.comment_issues || [],
          last_review_sha: data.last_review_sha,
          review_count: data.review_count || 0,
        };
        return this.state;
      } catch (error) {
        console.warn('Failed to load state, creating new:', error);
      }
    }

    // Create new state
    const now = new Date().toISOString();
    this.state = {
      pr_number: prNumber,
      repository,
      created_at: now,
      updated_at: now,
      reviewed_commits: [],
      suggested_issues: [],
      comment_issues: [],
      review_count: 0,
    };
    return this.state;
  }

  save(): string {
    if (!this.state) {
      throw new Error('No state loaded. Call load() first.');
    }

    // Ensure directory exists
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }

    // Update timestamp
    this.state.updated_at = new Date().toISOString();

    // Write state
    const statePath = path.join(this.stateDir, STATE_FILENAME);
    fs.writeFileSync(statePath, JSON.stringify(this.state, null, 2));

    return statePath;
  }

  addReviewedCommit(commitSha: string): void {
    if (!this.state) {
      throw new Error('No state loaded. Call load() first.');
    }
    if (!this.state.reviewed_commits.includes(commitSha)) {
      this.state.reviewed_commits.push(commitSha);
    }
  }

  addIssue(issue: A11yIssue, commitSha: string, isInline: boolean): void {
    if (!this.state) {
      throw new Error('No state loaded. Call load() first.');
    }

    const record: IssueRecord = {
      hash: generateIssueHash(issue),
      file: issue.file,
      line_start: issue.line,
      line_end: issue.line,
      severity: issue.severity,
      wcag_criterion: issue.wcag_criterion,
      title: issue.title,
      commit_sha: commitSha,
      first_reported: new Date().toISOString(),
    };

    if (isInline) {
      this.state.suggested_issues.push(record);
    } else {
      this.state.comment_issues.push(record);
    }
  }

  getExistingHashes(isInline: boolean): Set<string> {
    if (!this.state) {
      throw new Error('No state loaded. Call load() first.');
    }

    const issues = isInline ? this.state.suggested_issues : this.state.comment_issues;
    return new Set(issues.map(i => i.hash));
  }

  getReviewedCommits(): string[] {
    if (!this.state) {
      throw new Error('No state loaded. Call load() first.');
    }
    return [...this.state.reviewed_commits];
  }

  incrementReviewCount(): void {
    if (!this.state) {
      throw new Error('No state loaded. Call load() first.');
    }
    this.state.review_count++;
  }

  setLastReviewSha(sha: string): void {
    if (!this.state) {
      throw new Error('No state loaded. Call load() first.');
    }
    this.state.last_review_sha = sha;
  }

  get state_(): ReviewState | null {
    return this.state;
  }
}