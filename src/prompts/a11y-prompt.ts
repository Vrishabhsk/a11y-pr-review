/**
 * WCAG-focused prompt templates for accessibility review
 */

export const SYSTEM_PROMPT = `You are an expert accessibility auditor specializing in WCAG 2.1 and WCAG 2.2 compliance. Your role is to analyze code diffs and identify accessibility issues that could prevent users with disabilities from effectively using the application.

## Your Expertise

You have deep knowledge of:
- WCAG 2.1 and WCAG 2.2 Guidelines (all success criteria)
- ARIA specifications and best practices
- Screen reader behaviors (NVDA, JAWS, VoiceOver)
- Keyboard navigation patterns
- Color contrast requirements
- Focus management and focus indicators
- Semantic HTML and landmark regions
- Accessible form design
- Accessible name computation

## Key Focus Areas

When analyzing code, prioritize these critical accessibility aspects:

### 1. Perceivable (WCAG 1.x)
- **1.1.1 Non-text Content**: Images need meaningful alt text (decorative images use alt="")
- **1.3.1 Info and Relationships**: Use semantic HTML (headings, lists, landmarks)
- **1.4.3 Contrast (Minimum)**: Text must have 4.5:1 ratio, large text 3:1
- **1.4.11 Non-text Contrast**: UI components need 3:1 contrast ratio

### 2. Operable (WCAG 2.x)
- **2.1.1 Keyboard**: All functionality must be keyboard accessible
- **2.1.2 No Keyboard Trap**: Users must be able to navigate away from components
- **2.4.4 Link Purpose**: Link text must describe destination
- **2.4.7 Focus Visible**: Focus indicators must be visible

### 3. Understandable (WCAG 3.x)
- **3.1.1 Language of Page**: Page must have lang attribute
- **3.2.1 On Focus**: Focus shouldn't trigger unexpected changes
- **3.3.1 Error Identification**: Form errors must be identified and described
- **3.3.2 Labels or Instructions**: Form fields need labels

### 4. Robust (WCAG 4.x)
- **4.1.1 Parsing**: Valid HTML markup
- **4.1.2 Name, Role, Value**: Custom components must expose proper ARIA

## Output Requirements

You MUST respond with valid JSON matching the provided schema. Each issue must include:
- exact line number where the issue occurs
- WCAG criterion reference (e.g., "1.1.1")
- severity level (CRITICAL, IMPORTANT, SUGGESTION, or NIT)
- clear description of the problem
- specific code suggestion to fix it

## Severity Guidelines

- **CRITICAL**: Blocks screen readers or keyboard users entirely (missing alt on informative images, keyboard traps, unlabeled forms)
- **IMPORTANT**: WCAG Level A/AA violations that significantly impact usability (low contrast, missing focus indicators, poor link text)
- **SUGGESTION**: Recommended improvements for better accessibility (landmark regions, heading structure)
- **NIT**: Minor improvements and best practices

## Important Rules

1. Only report accessibility issues - ignore code style, bugs, or other concerns
2. Be specific about the exact line and code element with the issue
3. Provide actionable suggestions that can be applied directly
4. Don't report issues that are already fixed in the diff (only new/added lines)
5. Focus on lines marked with '+' in the diff (added/modified content)
6. Don't mark decorative images as issues if they already have alt=""
7. Consider context - a div with onClick might be acceptable if it has proper role and keyboard handling

Remember: You are analyzing ONLY the accessibility impact of the changes. Be thorough but fair.`;

const USER_PROMPT_TEMPLATE = `Analyze the following git diff for accessibility (WCAG 2.1/2.2) issues.

## Context
- Repository: {repository}
- PR Number: {pr_number}
- Files changed: {files_count}
- Primary language/framework: {framework}

## Instructions

1. Review each file's diff (lines starting with '+')
2. Identify accessibility issues introduced by the changes
3. For each issue, provide:
   - The exact file path and line number
   - The WCAG criterion being violated
   - Severity level
   - Description of the issue
   - A specific code suggestion to fix it

## Important

- Only report NEW issues introduced by this diff (lines marked with '+')
- Focus on WCAG 2.1/2.2 Level A and AA criteria
- Provide practical, actionable suggestions
- If no accessibility issues are found, return an empty issues array

Respond with valid JSON only.`;

export function buildUserPrompt(
  repository: string = 'unknown',
  prNumber: number = 0,
  filesCount: number = 0,
  framework: string = 'unknown'
): string {
  return USER_PROMPT_TEMPLATE
    .replace('{repository}', repository)
    .replace('{pr_number}', String(prNumber))
    .replace('{files_count}', String(filesCount))
    .replace('{framework}', framework);
}

export function buildJsonSchema(): object {
  return {
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              description: 'File path relative to repository root'
            },
            line: {
              type: 'integer',
              description: 'Line number in the NEW file (after changes)'
            },
            wcag_criterion: {
              type: 'string',
              description: "WCAG criterion number (e.g., '1.1.1', '2.4.7')"
            },
            wcag_level: {
              type: 'string',
              enum: ['A', 'AA', 'AAA'],
              description: 'WCAG conformance level'
            },
            severity: {
              type: 'string',
              enum: ['CRITICAL', 'IMPORTANT', 'SUGGESTION', 'NIT'],
              description: 'Severity of the issue'
            },
            title: {
              type: 'string',
              description: 'Brief title of the issue'
            },
            description: {
              type: 'string',
              description: 'Detailed description of the accessibility issue'
            },
            suggestion: {
              type: 'string',
              description: 'Specific code change to fix the issue'
            },
            element: {
              type: 'string',
              description: 'The HTML element or component affected'
            }
          },
          required: ['file', 'line', 'wcag_criterion', 'wcag_level', 'severity', 'title', 'description', 'suggestion']
        }
      },
      summary: {
        type: 'string',
        description: 'Brief summary of accessibility review findings'
      }
    },
    required: ['issues']
  };
}

// WCAG criterion descriptions for reference
export const WCAG_CRITERIA: Record<string, [string, string, string]> = {
  '1.1.1': ['A', 'Non-text Content', 'All non-text content has text alternatives'],
  '1.2.1': ['A', 'Audio-only and Video-only', 'Alternatives for audio/video'],
  '1.2.2': ['A', 'Captions (Prerecorded)', 'Captions for videos'],
  '1.2.3': ['A', 'Audio Description', 'Audio descriptions for videos'],
  '1.2.4': ['AA', 'Captions (Live)', 'Live captions'],
  '1.2.5': ['AA', 'Audio Description', 'Audio descriptions'],
  '1.3.1': ['A', 'Info and Relationships', 'Semantic structure'],
  '1.3.2': ['A', 'Meaningful Sequence', 'Logical reading order'],
  '1.3.3': ['A', 'Sensory Characteristics', "Don't rely only on shape/color"],
  '1.3.4': ['AA', 'Orientation', 'Works in portrait/landscape'],
  '1.3.5': ['AA', 'Identify Input Purpose', 'Autocomplete attributes'],
  '1.4.1': ['A', 'Use of Color', "Don't convey info with color alone"],
  '1.4.2': ['A', 'Audio Control', "Don't auto-play audio"],
  '1.4.3': ['AA', 'Contrast (Minimum)', '4.5:1 for text, 3:1 for large'],
  '1.4.4': ['AA', 'Resize Text', 'Text scales to 200%'],
  '1.4.5': ['AA', 'Images of Text', 'Use real text'],
  '1.4.10': ['AA', 'Reflow', 'Content reflows at 320px'],
  '1.4.11': ['AA', 'Non-text Contrast', '3:1 for UI components'],
  '1.4.12': ['AA', 'Text Spacing', 'Adjustable spacing'],
  '1.4.13': ['AA', 'Content on Hover/Focus', 'Dismissable content'],
  '2.1.1': ['A', 'Keyboard', 'All functionality keyboard accessible'],
  '2.1.2': ['A', 'No Keyboard Trap', 'No keyboard traps'],
  '2.1.4': ['AA', 'Character Key Shortcuts', 'No single-key shortcuts'],
  '2.2.1': ['A', 'Timing Adjustable', 'Time limits adjustable'],
  '2.2.2': ['A', 'Pause, Stop, Hide', 'Moving content can be paused'],
  '2.3.1': ['A', 'Three Flashes', 'No more than 3 flashes/second'],
  '2.4.1': ['A', 'Bypass Blocks', 'Skip navigation links'],
  '2.4.2': ['A', 'Page Titled', 'Descriptive page titles'],
  '2.4.3': ['A', 'Focus Order', 'Logical tab order'],
  '2.4.4': ['A', 'Link Purpose', 'Link text describes destination'],
  '2.4.5': ['AA', 'Multiple Ways', 'Multiple navigation methods'],
  '2.4.6': ['AA', 'Headings and Labels', 'Descriptive headings'],
  '2.4.7': ['AA', 'Focus Visible', 'Visible focus indicator'],
  '2.4.11': ['AA', 'Focus Not Obscured', 'Focused element visible'],
  '2.5.1': ['A', 'Pointer Gestures', 'Single pointer alternatives'],
  '2.5.2': ['A', 'Pointer Cancellation', 'Abort actions'],
  '2.5.3': ['A', 'Label in Name', 'Visible label in accessible name'],
  '2.5.4': ['AA', 'Motion Actuation', 'Alternatives to motion'],
  '2.5.7': ['AA', 'Dragging', 'Alternatives to dragging'],
  '2.5.8': ['AA', 'Target Size', 'Target size minimum 24x24'],
  '3.1.1': ['A', 'Language of Page', 'Page lang attribute'],
  '3.1.2': ['AA', 'Language of Parts', 'Language changes marked'],
  '3.2.1': ['A', 'On Focus', 'No unexpected changes on focus'],
  '3.2.2': ['A', 'On Input', 'No unexpected changes on input'],
  '3.2.3': ['AA', 'Consistent Navigation', 'Consistent nav'],
  '3.2.4': ['AA', 'Consistent Identification', 'Consistent naming'],
  '3.3.1': ['A', 'Error Identification', 'Identify input errors'],
  '3.3.2': ['A', 'Labels or Instructions', 'Form field labels'],
  '3.3.3': ['AA', 'Error Suggestion', 'Suggest corrections'],
  '3.3.7': ['AA', 'Redundant Entry', "Don't re-request info"],
  '3.3.8': ['AA', 'Accessible Authentication', 'No memory puzzles'],
  '4.1.1': ['A', 'Parsing', 'Valid HTML'],
  '4.1.2': ['A', 'Name, Role, Value', 'ARIA for custom components'],
  '4.1.3': ['AA', 'Status Messages', 'Status announced'],
};