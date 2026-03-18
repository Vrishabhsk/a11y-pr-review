// Analyze ALL files - no filtering based on file type
// Accessibility issues can exist in any file type, not just frontend code
export function isAccessibilityRelevant(_filename: string): boolean {
  return true;
}

export function formatDiffForAnalysis(files: Array<{ filename: string; patch?: string }>): string {
  const lines: string[] = [];

  for (const file of files) {
    if (!file.patch) continue;

    lines.push(`=== ${file.filename} ===`);
    
    const patchLines = file.patch.split('\n');
    for (const line of patchLines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const code = line.substring(1);
        lines.push(code);
      }
    }
    
    lines.push('');
  }

  return lines.join('\n');
}