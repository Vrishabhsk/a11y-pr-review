"""Severity classification for accessibility issues."""

from enum import IntEnum
from typing import Tuple


class Severity(IntEnum):
    """Severity levels for accessibility issues."""

    CRITICAL = 1
    IMPORTANT = 2
    SUGGESTION = 3
    NIT = 4

    def __str__(self) -> str:
        return self.name


def get_severity_order() -> Tuple[str, ...]:
    """Return severity levels in order from most to least severe."""
    return ('CRITICAL', 'IMPORTANT', 'SUGGESTION', 'NIT')


def classify_severity(wcag_level: str, wcag_criterion: str, issue_type: str) -> Severity:
    """
    Classify an accessibility issue's severity based on WCAG criteria.

    Args:
        wcag_level: WCAG conformance level (A, AA, AAA)
        wcag_criterion: WCAG criterion number (e.g., '1.1.1', '4.1.2')
        issue_type: Type of issue (e.g., 'missing_alt', 'keyboard_trap')

    Returns:
        Severity level
    """
    # CRITICAL: Screen reader blockers, keyboard traps, no alt on informative images
    critical_criteria = {
        '1.1.1',   # Non-text Content (images without alt)
        '2.1.1',   # Keyboard accessible - critical violations
        '2.1.2',   # No keyboard trap
        '4.1.2',   # Name, Role, Value (form inputs, ARIA)
    }

    critical_types = {
        'keyboard_trap',
        'no_focus_indicator',
        'missing_alt_informative',
        'form_no_label',
        'aria_invalid_role',
        'aria_missing_required_attr',
        'screen_reader_blocker',
        'modal_no_focus_trap',
        'skip_link_broken',
    }

    # IMPORTANT: Level AA violations that significantly impact usability
    important_criteria = {
        '1.3.1',   # Info and Relationships
        '1.4.3',   # Contrast (Minimum)
        '1.4.11',  # Non-text Contrast
        '2.4.4',   # Link Purpose (In Context)
        '2.4.7',   # Focus Visible
        '3.2.1',   # On Focus
        '3.2.2',   # On Input
        '3.3.1',   # Error Identification
        '3.3.2',   # Labels or Instructions
        '4.1.1',   # Parsing
    }

    important_types = {
        'low_contrast',
        'focus_not_visible',
        'link_text_vague',
        'heading_structure',
        'form_error_not_announced',
        'autocomplete_missing',
        'landmarks_missing',
        'list_markup_wrong',
        'fieldset_missing',
        'caption_missing',
    }

    # Check for critical
    if wcag_criterion in critical_criteria or issue_type in critical_types:
        return Severity.CRITICAL

    # Check for important
    if wcag_level == 'AA' or wcag_criterion in important_criteria or issue_type in important_types:
        return Severity.IMPORTANT

    # Default to SUGGESTION for AA recommendations
    if wcag_level == 'AAA':
        return Severity.SUGGESTION

    # NIT for best practices
    return Severity.NIT


def severity_meets_threshold(severity: Severity, threshold: str) -> bool:
    """
    Check if a severity level meets or exceeds the threshold.

    Args:
        severity: The issue's severity
        threshold: Minimum severity threshold (as string)

    Returns:
        True if severity meets threshold
    """
    try:
        threshold_severity = Severity[threshold.upper()]
        return severity <= threshold_severity
    except KeyError:
        # Default to showing all if threshold is invalid
        return True


def get_emoji(severity: Severity) -> str:
    """Get emoji for severity level."""
    emojis = {
        Severity.CRITICAL: '🔴',
        Severity.IMPORTANT: '🟠',
        Severity.SUGGESTION: '🟡',
        Severity.NIT: '⚪',
    }
    return emojis.get(severity, '⚪')