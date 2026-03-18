#!/usr/bin/env python3
"""
Main orchestrator for accessibility PR review.

This script:
1. Parses environment variables for configuration
2. Creates appropriate LLM client (Gemini or Ollama)
3. Loads previous state from artifact
4. Fetches PR files from GitHub API
5. Determines scope (full vs incremental review)
6. Builds diff and sends to LLM
7. Parses LLM response into structured issues
8. Deduplicates against previous state
9. Submits inline suggestions (CRITICAL/IMPORTANT)
10. Posts aggregated comment (SUGGESTION/NIT)
11. Saves new state to artifact
"""

import json
import os
import sys
from typing import Dict, List, Optional, Tuple

# Add src to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from llm import create_llm_client, LLMClient
from github import GitHubClient, InlineSuggestionManager, CommentManager
from prompts import SYSTEM_PROMPT, build_user_prompt, build_json_schema
from prompts.severity import Severity, severity_meets_threshold
from state import StateManager
from parsers import DiffParser


class AccessibilityReviewer:
    """Orchestrates the accessibility review process."""

    def __init__(
        self,
        llm_backend: str,
        github_token: str,
        repository: str,
        pr_number: int,
        commit_sha: str,
        severity_threshold: str = 'SUGGESTION',
        max_issues: int = 50,
        state_dir: str = '/tmp/a11y-state',
        **llm_kwargs
    ):
        """
        Initialize the reviewer.

        Args:
            llm_backend: LLM backend ('gemini' or 'ollama')
            github_token: GitHub API token
            repository: Repository in 'owner/repo' format
            pr_number: Pull request number
            commit_sha: Current commit SHA
            severity_threshold: Minimum severity to report
            max_issues: Maximum issues to report
            state_dir: Directory for state persistence
            **llm_kwargs: Additional LLM configuration
        """
        self.llm_backend = llm_backend
        self.github_token = github_token
        self.repository = repository
        self.pr_number = pr_number
        self.commit_sha = commit_sha
        self.severity_threshold = severity_threshold
        self.max_issues = max_issues

        # Initialize components
        self.github_client = GitHubClient(token=github_token, repository=repository)
        self.state_manager = StateManager(state_dir=state_dir)
        self.diff_parser = DiffParser()

        # Create LLM client
        self.llm_client: LLMClient = create_llm_client(
            backend=llm_backend,
            **llm_kwargs
        )

        # Feedback managers
        self.suggestion_manager = InlineSuggestionManager(self.github_client)
        self.comment_manager = CommentManager(self.github_client)

    def run(self) -> Dict:
        """
        Run the full accessibility review.

        Returns:
            Dict with review results
        """
        print(f"Starting accessibility review for {self.repository}#{self.pr_number}")
        print(f"LLM Backend: {self.llm_backend}, Model: {self.llm_client.model_name}")

        # Step 1: Load previous state
        state = self.state_manager.load(self.pr_number, self.repository)
        print(f"Loaded state: {state.review_count} previous reviews")

        # Step 2: Get PR files
        pr_files = self.github_client.get_pr_files(self.pr_number)
        print(f"Found {len(pr_files)} changed files in PR")

        # Step 3: Determine review scope
        is_first_review = state.review_count == 0
        previous_commits = set(state.get_reviewed_commits())

        # Filter to accessibility-relevant files
        file_diffs = []
        for pr_file in pr_files:
            if pr_file.patch:
                parsed = self.diff_parser.parse(pr_file.patch)
                if parsed.files:
                    file_diffs.extend(parsed.files)

        relevant_files = self.diff_parser.filter_accessibility_files(file_diffs)
        print(f"Found {len(relevant_files)} accessibility-relevant files")

        if not relevant_files:
            print("No accessibility-relevant changes found")
            return {'status': 'success', 'issues_found': 0}

        # Step 4: Build diff content for analysis
        diff_content = self.diff_parser.build_code_for_analysis(
            relevant_files,
            include_context=True
        )

        # Step 5: Detect framework/language
        framework = self._detect_framework(pr_files)

        # Step 6: Build prompts
        user_prompt = build_user_prompt(
            repository=self.repository,
            pr_number=self.pr_number,
            files_count=len(relevant_files),
            framework=framework
        )

        # Step 7: Send to LLM
        print(f"Analyzing with {self.llm_backend}...")
        response = self.llm_client.analyze_diff(
            diff_content=diff_content,
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            json_schema=build_json_schema()
        )

        print(f"LLM response received ({response.usage} tokens used)" if response.usage else "LLM response received")

        # Step 8: Parse issues
        all_issues = response.structured_data or []
        print(f"Found {len(all_issues)} total issues in LLM response")

        # Step 9: Filter by severity threshold
        filtered_issues = [
            issue for issue in all_issues
            if severity_meets_threshold(
                Severity[issue.get('severity', 'SUGGESTION')],
                self.severity_threshold
            )
        ]
        print(f"{len(filtered_issues)} issues meet severity threshold ({self.severity_threshold})")

        # Step 10: Deduplicate against previous state
        existing_hashes = state.get_existing_hashes(is_inline=True) | state.get_existing_hashes(is_inline=False)
        unique_issues, duplicate_issues = self._deduplicate_issues(filtered_issues, existing_hashes)
        print(f"{len(unique_issues)} new issues, {len(duplicate_issues)} duplicates")

        # Step 11: Limit issues
        issues_to_report = unique_issues[:self.max_issues]

        # Step 12: Categorize issues
        inline_issues = [
            issue for issue in issues_to_report
            if issue.get('severity') in ('CRITICAL', 'IMPORTANT')
        ]
        comment_issues = [
            issue for issue in issues_to_report
            if issue.get('severity') in ('SUGGESTION', 'NIT')
        ]

        print(f"Submitting {len(inline_issues)} inline suggestions, {len(comment_issues)} comment issues")

        # Step 13: Submit inline suggestions
        if inline_issues:
            self.suggestion_manager.create_review_with_suggestions(
                pr_number=self.pr_number,
                issues=inline_issues,
                commit_id=self.commit_sha
            )
            for issue in inline_issues:
                state.add_issue(issue, self.commit_sha, is_inline=True)

        # Step 14: Post aggregated comment
        if comment_issues:
            summary = None
            # Extract summary from LLM response
            if isinstance(response.content, str):
                import re
                summary_match = re.search(r'"summary"\s*:\s*"([^"]+)"', response.content)
                if summary_match:
                    summary = summary_match.group(1)

            self.comment_manager.post_or_update_comment(
                pr_number=self.pr_number,
                issues=comment_issues,
                summary=summary
            )
            for issue in comment_issues:
                state.add_issue(issue, self.commit_sha, is_inline=False)

        # Step 15: Create summary comment
        critical_count = sum(1 for i in issues_to_report if i.get('severity') == 'CRITICAL')
        important_count = sum(1 for i in issues_to_report if i.get('severity') == 'IMPORTANT')
        suggestion_count = sum(1 for i in issues_to_report if i.get('severity') == 'SUGGESTION')
        nit_count = sum(1 for i in issues_to_report if i.get('severity') == 'NIT')

        self.comment_manager.create_summary_comment(
            pr_number=self.pr_number,
            total_issues=len(issues_to_report),
            critical_count=critical_count,
            important_count=important_count,
            suggestion_count=suggestion_count,
            nit_count=nit_count,
            llm_summary=None
        )

        # Step 16: Update state
        state.add_reviewed_commit(self.commit_sha)
        state.set_last_review_sha(self.commit_sha)
        state.increment_review_count()
        self.state_manager.save()

        print("Review complete!")

        return {
            'status': 'success',
            'issues_found': len(issues_to_report),
            'critical': critical_count,
            'important': important_count,
            'suggestion': suggestion_count,
            'nit': nit_count,
            'duplicates_skipped': len(duplicate_issues)
        }

    def _detect_framework(self, pr_files) -> str:
        """Detect the framework/language from file extensions."""
        extensions = {}
        for pr_file in pr_files:
            ext = os.path.splitext(pr_file.path)[1].lower()
            extensions[ext] = extensions.get(ext, 0) + 1

        # Most common framework detection
        if '.tsx' in extensions or '.jsx' in extensions:
            return 'React'
        if '.vue' in extensions:
            return 'Vue'
        if '.svelte' in extensions:
            return 'Svelte'
        if '.angular' in str(extensions):
            return 'Angular'
        if '.html' in extensions:
            return 'HTML'
        if '.php' in extensions:
            return 'PHP'

        return 'Unknown'

    def _deduplicate_issues(
        self,
        issues: List[Dict],
        existing_hashes: set
    ) -> Tuple[List[Dict], List[Dict]]:
        """Deduplicate issues against existing hashes."""
        from state.deduplication import DeduplicationManager

        manager = DeduplicationManager(existing_hashes)
        return manager.filter_new_issues(issues)


def main():
    """Main entry point."""
    # Parse environment variables
    llm_backend = os.getenv('LLM_BACKEND', 'gemini')
    github_token = os.getenv('GITHUB_TOKEN')
    repository = os.getenv('GITHUB_REPOSITORY')
    pr_number_str = os.getenv('GITHUB_PR_NUMBER')
    commit_sha = os.getenv('GITHUB_SHA')
    severity_threshold = os.getenv('SEVERITY_THRESHOLD', 'SUGGESTION')
    max_issues = int(os.getenv('MAX_ISSUES', '50'))
    state_dir = os.getenv('STATE_DIR', '/tmp/a11y-state')

    # LLM-specific config
    llm_kwargs = {}
    if llm_backend == 'gemini':
        llm_kwargs['api_key'] = os.getenv('GEMINI_API_KEY')
        llm_kwargs['model'] = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')
    elif llm_backend == 'ollama':
        llm_kwargs['api_url'] = os.getenv('OLLAMA_API_URL', 'http://localhost:11434')
        llm_kwargs['model'] = os.getenv('OLLAMA_MODEL', 'qwen2.5-coder:32b')

    # Validate required inputs
    if not github_token:
        print("ERROR: GITHUB_TOKEN is required")
        sys.exit(1)
    if not repository:
        print("ERROR: GITHUB_REPOSITORY is required")
        sys.exit(1)
    if not pr_number_str:
        print("ERROR: GITHUB_PR_NUMBER is required")
        sys.exit(1)
    if not commit_sha:
        print("ERROR: GITHUB_SHA is required")
        sys.exit(1)

    try:
        pr_number = int(pr_number_str)
    except ValueError:
        print(f"ERROR: Invalid PR number: {pr_number_str}")
        sys.exit(1)

    # Run the review
    try:
        reviewer = AccessibilityReviewer(
            llm_backend=llm_backend,
            github_token=github_token,
            repository=repository,
            pr_number=pr_number,
            commit_sha=commit_sha,
            severity_threshold=severity_threshold,
            max_issues=max_issues,
            state_dir=state_dir,
            **llm_kwargs
        )

        result = reviewer.run()

        # Output results for GitHub Actions
        print(f"::set-output name=issues-found::{result.get('issues_found', 0)}")
        print(f"::set-output name=critical-count::{result.get('critical', 0)}")
        print(f"::set-output name=important-count::{result.get('important', 0)}")

        sys.exit(0)

    except Exception as e:
        print(f"ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()