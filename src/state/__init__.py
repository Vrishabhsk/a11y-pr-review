"""State management for accessibility review."""

from .manager import StateManager, ReviewState
from .deduplication import DeduplicationManager, IssueHash

__all__ = [
    'StateManager',
    'ReviewState',
    'DeduplicationManager',
    'IssueHash',
]