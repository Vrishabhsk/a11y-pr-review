/**
 * Severity classification for accessibility issues
 */

import { Severity } from '../types';

// Re-export Severity for convenience
export { Severity } from '../types';

export const SEVERITY_ORDER: Severity[] = [
  Severity.CRITICAL,
  Severity.IMPORTANT,
  Severity.SUGGESTION,
  Severity.NIT
];

export const SEVERITY_EMOJI: Record<Severity, string> = {
  [Severity.CRITICAL]: '🔴',
  [Severity.IMPORTANT]: '🟠',
  [Severity.SUGGESTION]: '🟡',
  [Severity.NIT]: '⚪'
};

// Critical WCAG criteria that block users
const CRITICAL_CRITERIA = new Set([
  '1.1.1',  // Non-text Content (images without alt)
  '2.1.1',  // Keyboard accessible
  '2.1.2',  // No keyboard trap
  '4.1.2',  // Name, Role, Value (ARIA)
]);

// Important WCAG criteria that significantly impact usability
const IMPORTANT_CRITERIA = new Set([
  '1.3.1',  // Info and Relationships
  '1.4.3',  // Contrast (Minimum)
  '1.4.11', // Non-text Contrast
  '2.4.4',  // Link Purpose
  '2.4.7',  // Focus Visible
  '3.2.1',  // On Focus
  '3.2.2',  // On Input
  '3.3.1',  // Error Identification
  '3.3.2',  // Labels or Instructions
  '4.1.1',  // Parsing
]);

// Critical issue types
const CRITICAL_TYPES = new Set([
  'keyboard_trap',
  'no_focus_indicator',
  'missing_alt_informative',
  'form_no_label',
  'aria_invalid_role',
  'aria_missing_required_attr',
  'screen_reader_blocker',
  'modal_no_focus_trap',
  'skip_link_broken',
]);

// Important issue types
const IMPORTANT_TYPES = new Set([
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
]);

/**
 * Classify severity based on WCAG criterion and issue type
 */
export function classifySeverity(
  wcagLevel: string,
  wcagCriterion: string,
  issueType?: string
): Severity {
  // Check for critical
  if (CRITICAL_CRITERIA.has(wcagCriterion) || (issueType && CRITICAL_TYPES.has(issueType))) {
    return Severity.CRITICAL;
  }

  // Check for important
  if (
    wcagLevel === 'AA' ||
    IMPORTANT_CRITERIA.has(wcagCriterion) ||
    (issueType && IMPORTANT_TYPES.has(issueType))
  ) {
    return Severity.IMPORTANT;
  }

  // Suggestion for AAA
  if (wcagLevel === 'AAA') {
    return Severity.SUGGESTION;
  }

  // Default to NIT for best practices
  return Severity.NIT;
}

/**
 * Check if severity meets or exceeds threshold
 */
export function severityMeetsThreshold(severity: Severity, threshold: string): boolean {
  const thresholdIndex = SEVERITY_ORDER.findIndex(s => s === threshold.toUpperCase());
  const severityIndex = SEVERITY_ORDER.indexOf(severity);

  if (thresholdIndex === -1) return true;

  return severityIndex <= thresholdIndex;
}

/**
 * Get emoji for severity level
 */
export function getSeverityEmoji(severity: Severity): string {
  return SEVERITY_EMOJI[severity] || '⚪';
}