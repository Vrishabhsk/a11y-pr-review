"""Deduplication logic for accessibility issues."""

import hashlib
from typing import Dict, List, Set, Tuple, Optional
from dataclasses import dataclass


@dataclass
class IssueHash:
    """Hash representation of an accessibility issue."""
    hash: str
    file: str
    line: int
    wcag_criterion: str
    title: str

    @classmethod
    def from_issue(cls, issue: Dict) -> 'IssueHash':
        """Create hash from issue dict."""
        hash_str = DeduplicationManager.generate_hash(issue)
        return cls(
            hash=hash_str,
            file=issue['file'],
            line=issue.get('line', 0),
            wcag_criterion=issue['wcag_criterion'],
            title=issue['title']
        )


class DeduplicationManager:
    """Manages deduplication of accessibility issues."""

    # Tolerance for line number differences (same issue on nearby lines)
    LINE_TOLERANCE = 5

    def __init__(self, existing_hashes: Optional[Set[str]] = None):
        """
        Initialize the deduplication manager.

        Args:
            existing_hashes: Set of already-reported issue hashes
        """
        self.existing_hashes = existing_hashes or set()

    @staticmethod
    def generate_hash(issue: Dict) -> str:
        """
        Generate a unique hash for an issue.

        Args:
            issue: Issue dict with file, line, title, wcag_criterion

        Returns:
            MD5 hash string
        """
        # Create a string representation of the issue identity
        key_parts = [
            issue.get('file', ''),
            str(issue.get('line', 0)),
            issue.get('title', ''),
            issue.get('wcag_criterion', ''),
        ]
        key_string = '|'.join(key_parts)

        return hashlib.md5(key_string.encode()).hexdigest()

    def is_duplicate(self, issue: Dict) -> bool:
        """
        Check if an issue is a duplicate of an existing one.

        Args:
            issue: Issue dict to check

        Returns:
            True if duplicate, False if new
        """
        issue_hash = self.generate_hash(issue)
        return issue_hash in self.existing_hashes

    def filter_new_issues(self, issues: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
        """
        Filter issues into new and duplicate.

        Args:
            issues: List of issues to filter

        Returns:
            Tuple of (new_issues, duplicate_issues)
        """
        new_issues = []
        duplicate_issues = []

        for issue in issues:
            if self.is_duplicate(issue):
                duplicate_issues.append(issue)
            else:
                new_issues.append(issue)

        return new_issues, duplicate_issues

    def is_nearby_duplicate(
        self,
        issue: Dict,
        existing_issues: List[Dict]
    ) -> Optional[Dict]:
        """
        Check if an issue is a duplicate with nearby line tolerance.

        Some refactors may shift line numbers slightly while keeping
        the same issue. This catches those cases.

        Args:
            issue: Issue to check
            existing_issues: List of previously reported issues

        Returns:
            Matching issue if found nearby, None otherwise
        """
        issue_line = issue.get('line', 0)
        issue_file = issue.get('file', '')
        issue_title = issue.get('title', '')
        issue_criterion = issue.get('wcag_criterion', '')

        for existing in existing_issues:
            if existing['file'] != issue_file:
                continue

            if existing['wcag_criterion'] != issue_criterion:
                continue

            if existing['title'] != issue_title:
                continue

            # Check line tolerance
            existing_line = existing.get('line', 0)
            if abs(issue_line - existing_line) <= self.LINE_TOLERANCE:
                return existing

        return None

    def add_issues(self, issues: List[Dict]) -> None:
        """
        Add issues to the existing hashes set.

        Args:
            issues: Issues to add
        """
        for issue in issues:
            self.existing_hashes.add(self.generate_hash(issue))

    def get_hashes(self) -> Set[str]:
        """Get all existing hashes."""
        return self.existing_hashes.copy()


def deduplicate_issues(
    new_issues: List[Dict],
    existing_hashes: Set[str],
    existing_issues: Optional[List[Dict]] = None
) -> Tuple[List[Dict], List[Dict]]:
    """
    Deduplicate issues against previously reported issues.

    Args:
        new_issues: Newly detected issues
        existing_hashes: Hashes of previously reported issues
        existing_issues: Optional list of previous issues for nearby check

    Returns:
        Tuple of (unique_issues, duplicate_issues)
    """
    manager = DeduplicationManager(existing_hashes)

    unique_issues = []
    duplicate_issues = []

    for issue in new_issues:
        if manager.is_duplicate(issue):
            duplicate_issues.append(issue)
            continue

        # Check for nearby duplicates if we have existing issues
        if existing_issues:
            nearby = manager.is_nearby_duplicate(issue, existing_issues)
            if nearby:
                duplicate_issues.append(issue)
                continue

        unique_issues.append(issue)

    return unique_issues, duplicate_issues


def merge_issue_lists(
    inline_issues: List[Dict],
    comment_issues: List[Dict]
) -> List[Dict]:
    """
    Merge inline and comment issues, removing duplicates.

    Args:
        inline_issues: Issues for inline suggestions
        comment_issues: Issues for comment aggregation

    Returns:
        Merged list with duplicates removed
    """
    seen_hashes = set()
    merged = []

    # Process inline issues first (higher priority)
    for issue in inline_issues:
        hash_val = DeduplicationManager.generate_hash(issue)
        if hash_val not in seen_hashes:
            seen_hashes.add(hash_val)
            merged.append(issue)

    # Add comment issues that aren't duplicates
    for issue in comment_issues:
        hash_val = DeduplicationManager.generate_hash(issue)
        if hash_val not in seen_hashes:
            seen_hashes.add(hash_val)
            merged.append(issue)

    return merged