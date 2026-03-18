"""Inline code suggestion submission."""

from typing import Dict, List, Optional

from .client import GitHubClient
from ..prompts.severity import Severity, get_emoji


def format_suggestion_comment(issue: Dict) -> str:
    """
    Format an accessibility issue as a GitHub review comment with suggestion.

    Args:
        issue: Issue dict with file, line, severity, title, description, suggestion, etc.

    Returns:
        Formatted comment string
    """
    severity = issue.get('severity', 'SUGGESTION')
    emoji = get_emoji(Severity[severity])

    wcag_criterion = issue.get('wcag_criterion', '')
    wcag_level = issue.get('wcag_level', '')

    lines = [
        f"{emoji} **{issue.get('title', 'Accessibility Issue')}**",
        "",
        f"**WCAG {wcag_criterion}** (Level {wcag_level})",
        f"**Severity:** {severity}",
        "",
        issue.get('description', 'No description provided.')
    ]

    # Add suggestion if available
    if issue.get('suggestion'):
        lines.extend([
            "",
            "**Suggested fix:**",
            "```suggestion",
            issue['suggestion'],
            "```"
        ])

    # Add element context if available
    if issue.get('element'):
        lines.extend([
            "",
            f"_Element: `{issue['element']}`_"
        ])

    return '\n'.join(lines)


class InlineSuggestionManager:
    """Manage inline code suggestions for accessibility issues."""

    # Maximum comments per review (GitHub limit is lower, we stay safe)
    MAX_COMMENTS_PER_REVIEW = 50

    def __init__(self, github_client: GitHubClient):
        """
        Initialize the suggestion manager.

        Args:
            github_client: GitHub API client
        """
        self.github_client = github_client

    def create_review_with_suggestions(
        self,
        pr_number: int,
        issues: List[Dict],
        commit_id: Optional[str] = None
    ) -> Dict:
        """
        Create a PR review with inline suggestions for CRITICAL and IMPORTANT issues.

        Args:
            pr_number: Pull request number
            issues: List of accessibility issues
            commit_id: Specific commit SHA (defaults to PR head)

        Returns:
            API response
        """
        # Filter to CRITICAL and IMPORTANT only
        critical_issues = [
            issue for issue in issues
            if issue.get('severity') in ('CRITICAL', 'IMPORTANT')
        ]

        if not critical_issues:
            # No critical issues, return empty response
            return {}

        # Format comments
        comments = []
        for issue in critical_issues[:self.MAX_COMMENTS_PER_REVIEW]:
            comment = {
                'path': issue['file'],
                'position': self._calculate_position(issue),
                'body': format_suggestion_comment(issue)
            }
            comments.append(comment)

        # Determine review event
        event = 'COMMENT'
        body = self._build_review_body(critical_issues)

        return self.github_client.create_review(
            pr_number=pr_number,
            body=body,
            event=event,
            comments=comments,
            commit_id=commit_id
        )

    def _calculate_position(self, issue: Dict) -> int:
        """
        Calculate the position for inline comment.

        Note: GitHub uses position in diff, not line number in file.
        This is simplified - in practice, we need to calculate position from diff.

        Args:
            issue: Issue dict with line number

        Returns:
            Position in diff
        """
        # For now, use line number as position
        # In a full implementation, this would need to calculate from diff context
        line = issue.get('line', 1)
        return max(1, line)

    def _build_review_body(self, issues: List[Dict]) -> str:
        """Build the review body text."""
        critical_count = sum(1 for i in issues if i.get('severity') == 'CRITICAL')
        important_count = sum(1 for i in issues if i.get('severity') == 'IMPORTANT')

        lines = [
            "## 🔍 Accessibility Review",
            "",
            f"Found **{len(issues)}** accessibility issues that require attention.",
            ""
        ]

        if critical_count > 0:
            lines.append(f"- 🔴 **{critical_count}** Critical issues")
        if important_count > 0:
            lines.append(f"- 🟠 **{important_count}** Important issues")

        lines.extend([
            "",
            "---",
            "*This review was automatically generated. Please review each suggestion and apply fixes as needed.*"
        ])

        return '\n'.join(lines)