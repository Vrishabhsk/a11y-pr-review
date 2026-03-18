"""State persistence manager using GitHub Artifacts."""

import json
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Dict, List, Optional, Set, Any


@dataclass
class IssueRecord:
    """Record of a reported accessibility issue."""
    hash: str
    file: str
    line_start: int
    line_end: int
    severity: str
    wcag_criterion: str
    title: str
    description: str
    first_reported: str  # ISO timestamp
    commit_sha: str  # Commit where issue was found

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> 'IssueRecord':
        return cls(**data)


@dataclass
class ReviewState:
    """State of accessibility review for a PR."""
    pr_number: int
    repository: str
    created_at: str
    updated_at: str
    reviewed_commits: List[str] = field(default_factory=list)
    suggested_issues: List[Dict] = field(default_factory=list)
    comment_issues: List[Dict] = field(default_factory=list)
    last_review_sha: Optional[str] = None
    review_count: int = 0

    def to_dict(self) -> Dict:
        return {
            'pr_number': self.pr_number,
            'repository': self.repository,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
            'reviewed_commits': self.reviewed_commits,
            'suggested_issues': self.suggested_issues,
            'comment_issues': self.comment_issues,
            'last_review_sha': self.last_review_sha,
            'review_count': self.review_count
        }

    @classmethod
    def from_dict(cls, data: Dict) -> 'ReviewState':
        return cls(
            pr_number=data['pr_number'],
            repository=data['repository'],
            created_at=data['created_at'],
            updated_at=data['updated_at'],
            reviewed_commits=data.get('reviewed_commits', []),
            suggested_issues=data.get('suggested_issues', []),
            comment_issues=data.get('comment_issues', []),
            last_review_sha=data.get('last_review_sha'),
            review_count=data.get('review_count', 0)
        )

    @classmethod
    def create_new(cls, pr_number: int, repository: str) -> 'ReviewState':
        """Create a new empty state."""
        now = datetime.utcnow().isoformat()
        return cls(
            pr_number=pr_number,
            repository=repository,
            created_at=now,
            updated_at=now
        )


class StateManager:
    """Manages persistence of review state via GitHub Artifacts."""

    STATE_FILENAME = 'review_state.json'

    def __init__(self, state_dir: Optional[str] = None):
        """
        Initialize the state manager.

        Args:
            state_dir: Directory for state files (defaults to /tmp/a11y-state)
        """
        self.state_dir = state_dir or os.getenv('STATE_DIR', '/tmp/a11y-state')
        self._state: Optional[ReviewState] = None

    def load(self, pr_number: int, repository: str) -> ReviewState:
        """
        Load state from artifact or create new.

        Args:
            pr_number: Pull request number
            repository: Repository in owner/repo format

        Returns:
            ReviewState object
        """
        state_path = os.path.join(self.state_dir, self.STATE_FILENAME)

        if os.path.exists(state_path):
            try:
                with open(state_path, 'r') as f:
                    data = json.load(f)
                self._state = ReviewState.from_dict(data)
                return self._state
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Error loading state: {e}. Creating new state.")

        # Create new state
        self._state = ReviewState.create_new(pr_number, repository)
        return self._state

    def save(self) -> str:
        """
        Save current state to file.

        Returns:
            Path to saved state file
        """
        if self._state is None:
            raise RuntimeError("No state loaded. Call load() first.")

        # Ensure directory exists
        os.makedirs(self.state_dir, exist_ok=True)

        # Update timestamp
        self._state.updated_at = datetime.utcnow().isoformat()

        # Write state
        state_path = os.path.join(self.state_dir, self.STATE_FILENAME)
        with open(state_path, 'w') as f:
            json.dump(self._state.to_dict(), f, indent=2)

        return state_path

    def add_reviewed_commit(self, commit_sha: str):
        """Add a commit to the reviewed list."""
        if self._state is None:
            raise RuntimeError("No state loaded. Call load() first.")

        if commit_sha not in self._state.reviewed_commits:
            self._state.reviewed_commits.append(commit_sha)

    def add_issue(
        self,
        issue: Dict,
        commit_sha: str,
        is_inline: bool = False
    ):
        """
        Record a reported issue.

        Args:
            issue: Issue dict from LLM analysis
            commit_sha: Commit SHA where issue was found
            is_inline: True for inline suggestion, False for comment
        """
        if self._state is None:
            raise RuntimeError("No state loaded. Call load() first.")

        from .deduplication import DeduplicationManager
        issue_hash = DeduplicationManager.generate_hash(issue)

        record = {
            'hash': issue_hash,
            'file': issue['file'],
            'line_start': issue.get('line', 0),
            'line_end': issue.get('line', 0),
            'severity': issue['severity'],
            'wcag_criterion': issue['wcag_criterion'],
            'title': issue['title'],
            'commit_sha': commit_sha,
            'first_reported': datetime.utcnow().isoformat()
        }

        if is_inline:
            self._state.suggested_issues.append(record)
        else:
            self._state.comment_issues.append(record)

    def get_existing_hashes(self, is_inline: bool = False) -> Set[str]:
        """
        Get hashes of existing issues for deduplication.

        Args:
            is_inline: True for inline suggestions, False for comments

        Returns:
            Set of issue hashes
        """
        if self._state is None:
            raise RuntimeError("No state loaded. Call load() first.")

        issues = self._state.suggested_issues if is_inline else self._state.comment_issues
        return {issue['hash'] for issue in issues}

    def get_reviewed_commits(self) -> List[str]:
        """Get list of reviewed commit SHAs."""
        if self._state is None:
            raise RuntimeError("No state loaded. Call load() first.")

        return self._state.reviewed_commits.copy()

    def increment_review_count(self):
        """Increment the review count."""
        if self._state is None:
            raise RuntimeError("No state loaded. Call load() first.")

        self._state.review_count += 1

    def set_last_review_sha(self, sha: str):
        """Set the SHA of the last review."""
        if self._state is None:
            raise RuntimeError("No state loaded. Call load() first.")

        self._state.last_review_sha = sha

    @property
    def state(self) -> Optional[ReviewState]:
        """Get current state."""
        return self._state