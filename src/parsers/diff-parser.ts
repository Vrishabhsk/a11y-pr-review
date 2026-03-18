/**
 * Unified diff parser for accessibility analysis
 */

import { FileDiff, LineChange, ParsedDiff } from '../types';

const FILE_HEADER_RE = /^diff --git a\/(.*?) b\/(.*?)$/;
const BINARY_RE = /^Binary files .* and .* differ$/;
const NEW_FILE_RE = /^new file mode/;
const DELETED_FILE_RE = /^deleted file mode/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export class DiffParser {
  static parse(diffText: string): ParsedDiff {
    const parsed: ParsedDiff = { files: [] };

    if (!diffText) return parsed;

    // Split into file sections
    const fileSections = this.splitIntoFiles(diffText);

    for (const section of fileSections) {
      const fileDiff = this.parseFileSection(section);
      if (fileDiff) {
        parsed.files.push(fileDiff);
      }
    }

    return parsed;
  }

  private static splitIntoFiles(diffText: string): string[] {
    const lines = diffText.split('\n');
    const sections: string[] = [];
    let currentSection: string[] = [];

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        if (currentSection.length > 0) {
          sections.push(currentSection.join('\n'));
        }
        currentSection = [line];
      } else {
        currentSection.push(line);
      }
    }

    if (currentSection.length > 0) {
      sections.push(currentSection.join('\n'));
    }

    return sections;
  }

  private static parseFileSection(section: string): FileDiff | null {
    const lines = section.split('\n');
    if (lines.length === 0) return null;

    // Parse file header
    const headerMatch = FILE_HEADER_RE.exec(lines[0]);
    if (!headerMatch) return null;

    const oldPath = headerMatch[1];
    const newPath = headerMatch[2];

    const fileDiff: FileDiff = {
      oldPath,
      newPath,
      changes: [],
      isBinary: false,
      isRename: false,
      isDeletion: false,
      isNew: false,
    };

    // Parse section
    let i = 1;

    // Skip --- and +++ lines
    while (i < lines.length && lines[i].startsWith('---')) i++;
    while (i < lines.length && lines[i].startsWith('+++')) i++;

    while (i < lines.length) {
      const line = lines[i];

      // Check for binary
      if (BINARY_RE.test(line)) {
        fileDiff.isBinary = true;
        i++;
        continue;
      }

      // Check for new file
      if (NEW_FILE_RE.test(line)) {
        fileDiff.isNew = true;
        i++;
        continue;
      }

      // Check for deleted file
      if (DELETED_FILE_RE.test(line)) {
        fileDiff.isDeletion = true;
        i++;
        continue;
      }

      // Check for rename
      const renameFrom = RENAME_FROM_RE.exec(line);
      if (renameFrom) {
        fileDiff.isRename = true;
        fileDiff.oldPath = renameFrom[1];
        i++;
        continue;
      }

      const renameTo = RENAME_TO_RE.exec(line);
      if (renameTo) {
        fileDiff.newPath = renameTo[1];
        i++;
        continue;
      }

      // Parse hunk
      const hunkMatch = HUNK_HEADER_RE.exec(line);
      if (hunkMatch) {
        const oldStart = parseInt(hunkMatch[1], 10);
        const oldCount = parseInt(hunkMatch[2] || '1', 10);
        const newStart = parseInt(hunkMatch[3], 10);
        const newCount = parseInt(hunkMatch[4] || '1', 10);

        i++;

        // Parse hunk lines
        let oldLine = oldStart;
        let newLine = newStart;

        while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff')) {
          const hunkLine = lines[i];

          if (hunkLine.startsWith('+')) {
            fileDiff.changes.push({
              oldLine: null,
              newLine,
              content: hunkLine.slice(1),
              type: 'add',
            });
            newLine++;
          } else if (hunkLine.startsWith('-')) {
            fileDiff.changes.push({
              oldLine,
              newLine: null,
              content: hunkLine.slice(1),
              type: 'delete',
            });
            oldLine++;
          } else if (hunkLine.startsWith(' ')) {
            fileDiff.changes.push({
              oldLine,
              newLine,
              content: hunkLine.slice(1),
              type: 'context',
            });
            oldLine++;
            newLine++;
          }

          i++;
        }

        continue;
      }

      i++;
    }

    return fileDiff;
  }

  static getAddedLines(fileDiff: FileDiff): Array<[number, string]> {
    return fileDiff.changes
      .filter(c => c.type === 'add' && c.newLine !== null)
      .map(c => [c.newLine!, c.content]);
  }

  static isAccessibilityRelevant(fileDiff: FileDiff): boolean {
    const path = fileDiff.newPath.toLowerCase();

    // Frontend file extensions
    const frontendExtensions = [
      '.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte',
      '.html', '.htm', '.css', '.scss', '.sass', '.less',
      '.astro', '.php', '.erb', '.haml',
    ];

    if (frontendExtensions.some(ext => path.endsWith(ext))) {
      return true;
    }

    // Template directories
    const templateDirs = ['templates/', 'views/', 'components/', 'pages/', 'src/'];
    if (templateDirs.some(dir => path.includes(dir))) {
      return true;
    }

    // Accessibility-specific files
    const a11yPatterns = ['a11y', 'accessibility', 'aria', 'screen-reader'];
    if (a11yPatterns.some(pattern => path.includes(pattern))) {
      return true;
    }

    return false;
  }

  static filterAccessibilityFiles(fileDiffs: FileDiff[]): FileDiff[] {
    return fileDiffs.filter(f => this.isAccessibilityRelevant(f));
  }

  static buildCodeForAnalysis(
    fileDiffs: FileDiff[],
    includeContext: boolean = true
  ): string {
    const outputLines: string[] = [];

    for (const fileDiff of fileDiffs) {
      // Skip binary and deleted files
      if (fileDiff.isBinary || fileDiff.isDeletion) continue;

      outputLines.push(`=== ${fileDiff.newPath} ===`);

      for (const change of fileDiff.changes) {
        if (change.type === 'add') {
          outputLines.push(`  +${String(change.newLine).padStart(4)}: ${change.content}`);
        } else if (change.type === 'context' && includeContext) {
          outputLines.push(`   ${String(change.newLine).padStart(4)}: ${change.content}`);
        }
      }

      outputLines.push('');
    }

    return outputLines.join('\n');
  }
}