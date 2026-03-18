/**
 * GitHub API client using @actions/github
 */

import * as github from '@actions/github';
import * as core from '@actions/core';
import { PRFile, PRCommit } from '../types';

export class GitHubClient {
  private octokit: ReturnType<typeof github.getOctokit>;
  private owner: string;
  private repo: string;

  constructor(token: string, repository?: string) {
    this.octokit = github.getOctokit(token);

    if (repository) {
      const parts = repository.split('/');
      this.owner = parts[0];
      this.repo = parts[1];
    } else {
      // Use GitHub context
      const context = github.context;
      this.owner = context.repo.owner;
      this.repo = context.repo.repo;
    }
  }

  async getPR(prNumber: number): Promise<Record<string, unknown>> {
    const { data } = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });
    return data as unknown as Record<string, unknown>;
  }

  async getPRFiles(prNumber: number): Promise<PRFile[]> {
    const files: PRFile[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const { data } = await this.octokit.rest.pulls.listFiles({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: perPage,
        page,
      });

      if (data.length === 0) break;

      files.push(...data.map(f => ({
        path: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch || undefined,
        raw_url: f.raw_url,
      })));

      if (data.length < perPage) break;
      page++;
    }

    return files;
  }

  async getPRCommits(prNumber: number): Promise<PRCommit[]> {
    const commits: PRCommit[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const { data } = await this.octokit.rest.pulls.listCommits({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: perPage,
        page,
      });

      if (data.length === 0) break;

      commits.push(...data.map(c => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.commit.author?.name || 'Unknown',
        timestamp: c.commit.author?.date || '',
      })));

      if (data.length < perPage) break;
      page++;
    }

    return commits;
  }

  async createReview(
    prNumber: number,
    body: string,
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' = 'COMMENT',
    comments: Array<{ path: string; position: number; body: string }> = [],
    commitId?: string
  ): Promise<void> {
    // Get the PR head commit if not specified
    if (!commitId) {
      const pr = await this.getPR(prNumber);
      const prData = pr as { head?: { sha?: string } };
      commitId = prData.head?.sha;
    }

    await this.octokit.rest.pulls.createReview({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      body,
      event,
      commit_id: commitId,
      comments: comments.map(c => ({
        path: c.path,
        position: c.position,
        body: c.body,
      })),
    });
  }

  async createComment(prNumber: number, body: string): Promise<number> {
    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      body,
    });
    return data.id;
  }

  async findBotComment(prNumber: number, identifier: string): Promise<{ id: number; body: string } | null> {
    const { data } = await this.octokit.rest.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
    });

    const botComment = data.find(c => c.body?.includes(identifier));
    if (botComment) {
      return { id: botComment.id, body: botComment.body || '' };
    }
    return null;
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    await this.octokit.rest.issues.updateComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      body,
    });
  }

  async getReviewComments(prNumber: number): Promise<Array<{ id: number; path: string; body: string }>> {
    const { data } = await this.octokit.rest.pulls.listReviewComments({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return data.map(c => ({
      id: c.id,
      path: c.path,
      body: c.body,
    }));
  }
}