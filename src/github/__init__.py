"""GitHub API client and feedback submission."""

from .client import GitHubClient, PRFile, PRCommit
from .suggestions import InlineSuggestionManager, format_suggestion_comment
from .comments import CommentManager

__all__ = [
    'GitHubClient',
    'PRFile',
    'PRCommit',
    'InlineSuggestionManager',
    'format_suggestion_comment',
    'CommentManager',
]