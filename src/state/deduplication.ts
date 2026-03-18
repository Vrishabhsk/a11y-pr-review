/**
 * Deduplication logic for accessibility issues
 */

import * as crypto from 'crypto';
import { A11yIssue } from '../types';

const LINE_TOLERANCE = 5;

/**
 * Generate a unique hash for an issue
 */
export function generateIssueHash(issue: A11yIssue): string {
  const keyParts = [
    issue.file,
    String(issue.line),
    issue.title,
    issue.wcag_criterion,
  ];
  const keyString = keyParts.join('|');
  return crypto.createHash('md5').update(keyString).digest('hex');
}

/**
 * Check if an issue is a duplicate
 */
export function isDuplicate(issue: A11yIssue, existingHashes: Set<string>): boolean {
  const hash = generateIssueHash(issue);
  return existingHashes.has(hash);
}

/**
 * Filter issues into new and duplicate
 */
export function filterNewIssues(
  issues: A11yIssue[],
  existingHashes: Set<string>
): { newIssues: A11yIssue[]; duplicateIssues: A11yIssue[] } {
  const newIssues: A11yIssue[] = [];
  const duplicateIssues: A11yIssue[] = [];

  for (const issue of issues) {
    if (isDuplicate(issue, existingHashes)) {
      duplicateIssues.push(issue);
    } else {
      newIssues.push(issue);
    }
  }

  return { newIssues, duplicateIssues };
}

/**
 * Check if an issue is a nearby duplicate (same file/criterion, nearby line)
 */
export function isNearbyDuplicate(
  issue: A11yIssue,
  existingIssues: A11yIssue[]
): A11yIssue | null {
  for (const existing of existingIssues) {
    if (existing.file !== issue.file) continue;
    if (existing.wcag_criterion !== issue.wcag_criterion) continue;
    if (existing.title !== issue.title) continue;

    // Check line tolerance
    if (Math.abs(existing.line - issue.line) <= LINE_TOLERANCE) {
      return existing;
    }
  }
  return null;
}

/**
 * Deduplicate issues with nearby line tolerance
 */
export function deduplicateIssues(
  newIssues: A11yIssue[],
  existingHashes: Set<string>,
  existingIssues?: A11yIssue[]
): { uniqueIssues: A11yIssue[]; duplicateIssues: A11yIssue[] } {
  const uniqueIssues: A11yIssue[] = [];
  const duplicateIssues: A11yIssue[] = [];

  for (const issue of newIssues) {
    if (isDuplicate(issue, existingHashes)) {
      duplicateIssues.push(issue);
      continue;
    }

    // Check for nearby duplicates if existing issues provided
    if (existingIssues) {
      const nearby = isNearbyDuplicate(issue, existingIssues);
      if (nearby) {
        duplicateIssues.push(issue);
        continue;
      }
    }

    uniqueIssues.push(issue);
  }

  return { uniqueIssues, duplicateIssues };
}