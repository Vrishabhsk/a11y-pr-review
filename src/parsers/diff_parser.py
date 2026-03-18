"""Unified diff parser for accessibility analysis."""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class LineChange:
    """Represents a single line change in a diff."""
    old_line: Optional[int]  # Line number in old file (None for additions)
    new_line: Optional[int]  # Line number in new file (None for deletions)
    content: str
    change_type: str  # 'add', 'delete', 'context'


@dataclass
class FileDiff:
    """Represents changes to a single file."""
    old_path: str
    new_path: str
    changes: List[LineChange] = field(default_factory=list)
    old_file_line_count: int = 0
    new_file_line_count: int = 0
    is_binary: bool = False
    is_rename: bool = False
    is_deletion: bool = False
    is_new: bool = False

    @property
    def path(self) -> str:
        """Get the current file path."""
        return self.new_path if self.new_path else self.old_path

    def get_added_lines(self) -> List[Tuple[int, str]]:
        """Get all added lines with their new line numbers."""
        return [
            (change.new_line, change.content)
            for change in self.changes
            if change.change_type == 'add' and change.new_line is not None
        ]

    def get_context_lines(self) -> List[Tuple[int, str]]:
        """Get all context lines (unchanged) with their line numbers."""
        return [
            (change.new_line, change.content)
            for change in self.changes
            if change.change_type == 'context' and change.new_line is not None
        ]


@dataclass
class ParsedDiff:
    """Represents a complete parsed diff."""
    files: List[FileDiff] = field(default_factory=list)

    @property
    def added_files(self) -> List[FileDiff]:
        """Get list of newly added files."""
        return [f for f in self.files if f.is_new]

    @property
    def modified_files(self) -> List[FileDiff]:
        """Get list of modified files."""
        return [f for f in self.files if not f.is_new and not f.is_deletion and not f.is_rename]

    @property
    def deleted_files(self) -> List[FileDiff]:
        """Get list of deleted files."""
        return [f for f in self.files if f.is_deletion]

    @property
    def renamed_files(self) -> List[FileDiff]:
        """Get list of renamed files."""
        return [f for f in self.files if f.is_rename]

    def get_file(self, path: str) -> Optional[FileDiff]:
        """Get a specific file by path."""
        for f in self.files:
            if f.path == path:
                return f
        return None

    def get_all_added_lines(self) -> Dict[str, List[Tuple[int, str]]]:
        """Get all added lines organized by file path."""
        result = {}
        for file_diff in self.files:
            added = file_diff.get_added_lines()
            if added:
                result[file_diff.path] = added
        return result


class DiffParser:
    """Parser for unified diff format."""

    # Regex patterns for diff parsing
    FILE_HEADER_RE = re.compile(r'^diff --git a/(.*?) b/(.*?)$')
    BINARY_RE = re.compile(r'^Binary files .* and .* differ$')
    NEW_FILE_RE = re.compile(r'^new file mode')
    DELETED_FILE_RE = re.compile(r'^deleted file mode')
    RENAME_FROM_RE = re.compile(r'^rename from (.+)$')
    RENAME_TO_RE = re.compile(r'^rename to (.+)$')
    HUNK_HEADER_RE = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')

    @classmethod
    def parse(cls, diff_text: str) -> ParsedDiff:
        """
        Parse a unified diff string.

        Args:
            diff_text: The unified diff text

        Returns:
            ParsedDiff object with all file changes
        """
        parsed = ParsedDiff()

        if not diff_text:
            return parsed

        # Split into file sections
        file_sections = cls._split_into_files(diff_text)

        for section in file_sections:
            file_diff = cls._parse_file_section(section)
            if file_diff:
                parsed.files.append(file_diff)

        return parsed

    @classmethod
    def _split_into_files(cls, diff_text: str) -> List[str]:
        """Split diff text into individual file sections."""
        lines = diff_text.split('\n')
        sections = []
        current_section = []

        for line in lines:
            if line.startswith('diff --git'):
                if current_section:
                    sections.append('\n'.join(current_section))
                current_section = [line]
            else:
                current_section.append(line)

        if current_section:
            sections.append('\n'.join(current_section))

        return sections

    @classmethod
    def _parse_file_section(cls, section: str) -> Optional[FileDiff]:
        """Parse a single file section from the diff."""
        lines = section.split('\n')
        if not lines:
            return None

        # Parse file header
        header_match = cls.FILE_HEADER_RE.match(lines[0])
        if not header_match:
            return None

        old_path = header_match.group(1)
        new_path = header_match.group(2)

        file_diff = FileDiff(old_path=old_path, new_path=new_path)

        # Check for special file states
        i = 1
        while i < len(lines) and lines[i].startswith('---'):
            i += 1

        while i < len(lines) and lines[i].startswith('+++'):
            i += 1

        while i < len(lines):
            line = lines[i]

            # Check for binary
            if cls.BINARY_RE.match(line):
                file_diff.is_binary = True
                i += 1
                continue

            # Check for new file
            if cls.NEW_FILE_RE.match(line):
                file_diff.is_new = True
                i += 1
                continue

            # Check for deleted file
            if cls.DELETED_FILE_RE.match(line):
                file_diff.is_deletion = True
                i += 1
                continue

            # Check for rename
            rename_from = cls.RENAME_FROM_RE.match(line)
            if rename_from:
                file_diff.is_rename = True
                file_diff.old_path = rename_from.group(1)
                i += 1
                continue

            rename_to = cls.RENAME_TO_RE.match(line)
            if rename_to:
                file_diff.new_path = rename_to.group(1)
                i += 1
                continue

            # Parse hunk
            hunk_match = cls.HUNK_HEADER_RE.match(line)
            if hunk_match:
                old_start = int(hunk_match.group(1))
                old_count = int(hunk_match.group(2) or 1)
                new_start = int(hunk_match.group(3))
                new_count = int(hunk_match.group(4) or 1)

                # Parse hunk lines
                i += 1
                old_line = old_start
                new_line = new_start

                while i < len(lines) and not lines[i].startswith('@@') and not lines[i].startswith('diff'):
                    hunk_line = lines[i]

                    if hunk_line.startswith('+'):
                        file_diff.changes.append(LineChange(
                            old_line=None,
                            new_line=new_line,
                            content=hunk_line[1:],
                            change_type='add'
                        ))
                        new_line += 1
                    elif hunk_line.startswith('-'):
                        file_diff.changes.append(LineChange(
                            old_line=old_line,
                            new_line=None,
                            content=hunk_line[1:],
                            change_type='delete'
                        ))
                        old_line += 1
                    elif hunk_line.startswith(' '):
                        file_diff.changes.append(LineChange(
                            old_line=old_line,
                            new_line=new_line,
                            content=hunk_line[1:],
                            change_type='context'
                        ))
                        old_line += 1
                        new_line += 1

                    i += 1

                continue

            i += 1

        return file_diff

    @classmethod
    def build_code_for_analysis(
        cls,
        file_diffs: List[FileDiff],
        include_context: bool = True,
        context_lines: int = 3
    ) -> str:
        """
        Build a code representation for LLM analysis.

        Args:
            file_diffs: List of file diffs to include
            include_context: Whether to include context lines
            context_lines: Number of context lines to include

        Returns:
            Formatted string with code for analysis
        """
        output_lines = []

        for file_diff in file_diffs:
            # Skip binary and deleted files
            if file_diff.is_binary or file_diff.is_deletion:
                continue

            output_lines.append(f"=== {file_diff.path} ===")

            # Track current line number
            current_line = 0

            for change in file_diff.changes:
                if change.change_type == 'add':
                    # Show added lines with line number
                    current_line = change.new_line
                    output_lines.append(f"  +{current_line:4d}: {change.content}")
                elif change.change_type == 'context' and include_context:
                    # Show context lines
                    current_line = change.new_line
                    output_lines.append(f"   {current_line:4d}: {change.content}")

            output_lines.append("")

        return '\n'.join(output_lines)

    @classmethod
    def is_accessibility_relevant(cls, file_diff: FileDiff) -> bool:
        """
        Check if a file is likely to contain accessibility-relevant code.

        Args:
            file_diff: File diff to check

        Returns:
            True if file is accessibility-relevant
        """
        path = file_diff.path.lower()

        # Frontend files
        frontend_extensions = (
            '.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte',
            '.html', '.htm', '.css', '.scss', '.sass', '.less',
            '.astro', '.php', '.erb', '.haml'
        )

        # Check extension
        if any(path.endswith(ext) for ext in frontend_extensions):
            return True

        # Check for template directories
        template_dirs = ('templates/', 'views/', 'components/', 'pages/', 'src/')
        if any(dir_name in path for dir_name in template_dirs):
            return True

        # Check for accessibility-specific files
        a11y_patterns = ('a11y', 'accessibility', 'aria', 'screen-reader')
        if any(pattern in path for pattern in a11y_patterns):
            return True

        return False

    @classmethod
    def filter_accessibility_files(
        cls,
        file_diffs: List[FileDiff]
    ) -> List[FileDiff]:
        """
        Filter file diffs to only include accessibility-relevant files.

        Args:
            file_diffs: List of all file diffs

        Returns:
            List of accessibility-relevant file diffs
        """
        return [f for f in file_diffs if cls.is_accessibility_relevant(f)]