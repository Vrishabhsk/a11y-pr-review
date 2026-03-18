"""GitHub API client for PR operations."""

import json
import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Any

import requests


@dataclass
class PRFile:
    """Represents a file in a pull request."""
    path: str
    additions: int
    deletions: int
    changes: int
    patch: Optional[str] = None
    raw_url: Optional[str] = None

    @classmethod
    def from_api(cls, data: Dict) -> 'PRFile':
        return cls(
            path=data['filename'],
            additions=data.get('additions', 0),
            deletions=data.get('deletions', 0),
            changes=data.get('changes', 0),
            patch=data.get('patch'),
            raw_url=data.get('raw_url')
        )


@dataclass
class PRCommit:
    """Represents a commit in a pull request."""
    sha: str
    message: str
    author: str
    timestamp: str

    @classmethod
    def from_api(cls, data: Dict) -> 'PRCommit':
        return cls(
            sha=data['sha'],
            message=data.get('commit', {}).get('message', ''),
            author=data.get('commit', {}).get('author', {}).get('name', 'Unknown'),
            timestamp=data.get('commit', {}).get('author', {}).get('date', '')
        )


class GitHubClient:
    """GitHub API client for pull request operations."""

    BASE_URL = 'https://api.github.com'

    def __init__(
        self,
        token: Optional[str] = None,
        repository: Optional[str] = None
    ):
        """
        Initialize the GitHub client.

        Args:
            token: GitHub API token (can also be set via GITHUB_TOKEN env)
            repository: Repository in 'owner/repo' format (can also be via GITHUB_REPOSITORY env)
        """
        self.token = token or os.getenv('GITHUB_TOKEN')
        if not self.token:
            raise ValueError("GitHub token required. Set GITHUB_TOKEN environment variable or pass token parameter.")

        self.repository = repository or os.getenv('GITHUB_REPOSITORY')
        if not self.repository:
            raise ValueError("Repository required. Set GITHUB_REPOSITORY environment variable or pass repository parameter.")

        self._headers = {
            'Authorization': f'token {self.token}',
            'Accept': 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
        self._session = None

    def _get_session(self) -> requests.Session:
        """Get or create a requests session."""
        if self._session is None:
            self._session = requests.Session()
            self._session.headers.update(self._headers)
        return self._session

    def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Dict:
        """Make a request to the GitHub API."""
        session = self._get_session()
        url = f"{self.BASE_URL}{endpoint}"

        response = session.request(method, url, **kwargs)
        response.raise_for_status()

        if response.status_code == 204:
            return {}

        return response.json()

    def get_pr(self, pr_number: int) -> Dict:
        """Get pull request details."""
        return self._request('GET', f'/repos/{self.repository}/pulls/{pr_number}')

    def get_pr_files(self, pr_number: int) -> List[PRFile]:
        """Get list of files changed in a pull request."""
        files = []
        page = 1
        per_page = 100

        while True:
            result = self._request(
                'GET',
                f'/repos/{self.repository}/pulls/{pr_number}/files',
                params={'page': page, 'per_page': per_page}
            )

            if not result:
                break

            files.extend([PRFile.from_api(f) for f in result])

            if len(result) < per_page:
                break

            page += 1

        return files

    def get_pr_commits(self, pr_number: int) -> List[PRCommit]:
        """Get list of commits in a pull request."""
        commits = []
        page = 1
        per_page = 100

        while True:
            result = self._request(
                'GET',
                f'/repos/{self.repository}/pulls/{pr_number}/commits',
                params={'page': page, 'per_page': per_page}
            )

            if not result:
                break

            commits.extend([PRCommit.from_api(c) for c in result])

            if len(result) < per_page:
                break

            page += 1

        return commits

    def get_file_content(self, path: str, ref: str) -> Optional[str]:
        """Get content of a file at a specific ref."""
        try:
            result = self._request(
                'GET',
                f'/repos/{self.repository}/contents/{path}',
                params={'ref': ref}
            )

            import base64
            if 'content' in result:
                return base64.b64decode(result['content']).decode('utf-8')
            return None
        except requests.exceptions.HTTPError:
            return None

    def create_review(
        self,
        pr_number: int,
        body: str,
        event: str = 'COMMENT',
        comments: Optional[List[Dict]] = None,
        commit_id: Optional[str] = None
    ) -> Dict:
        """
        Create a pull request review with inline comments.

        Args:
            pr_number: Pull request number
            body: Review body text
            event: Review event type (COMMENT, APPROVE, REQUEST_CHANGES)
            comments: List of inline comments (each with path, position, body)
            commit_id: Specific commit to review (defaults to PR head)

        Returns:
            API response
        """
        # Get the PR head commit if not specified
        if not commit_id:
            pr = self.get_pr(pr_number)
            commit_id = pr['head']['sha']

        payload = {
            'body': body,
            'event': event,
            'commit_id': commit_id
        }

        if comments:
            payload['comments'] = [
                {
                    'path': c['path'],
                    'position': c.get('position', 1),
                    'body': c['body']
                }
                for c in comments
            ]

        return self._request(
            'POST',
            f'/repos/{self.repository}/pulls/{pr_number}/reviews',
            json=payload
        )

    def create_comment(
        self,
        pr_number: int,
        body: str
    ) -> Dict:
        """Create a general comment on a pull request."""
        return self._request(
            'POST',
            f'/repos/{self.repository}/issues/{pr_number}/comments',
            json={'body': body}
        )

    def get_comments(self, pr_number: int) -> List[Dict]:
        """Get all comments on a pull request."""
        return self._request(
            'GET',
            f'/repos/{self.repository}/issues/{pr_number}/comments'
        )

    def update_comment(
        self,
        comment_id: int,
        body: str
    ) -> Dict:
        """Update an existing comment."""
        return self._request(
            'PATCH',
            f'/repos/{self.repository}/issues/comments/{comment_id}',
            json={'body': body}
        )

    def find_bot_comment(
        self,
        pr_number: int,
        identifier: str
    ) -> Optional[Dict]:
        """
        Find a bot comment by identifier.

        Args:
            pr_number: Pull request number
            identifier: Unique identifier string in comment body

        Returns:
            Comment dict or None
        """
        comments = self.get_comments(pr_number)
        for comment in comments:
            if identifier in comment.get('body', ''):
                return comment
        return None

    def get_review_comments(self, pr_number: int) -> List[Dict]:
        """Get all review comments on a pull request."""
        return self._request(
            'GET',
            f'/repos/{self.repository}/pulls/{pr_number}/comments'
        )