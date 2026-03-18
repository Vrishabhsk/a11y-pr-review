const ACCESSIBILITY_EXTENSIONS = [
  '.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.astro', '.php', '.erb', '.haml', '.handlebars', '.hbs'
];

const ACCESSIBILITY_PATTERNS = [
  'component', 'page', 'view', 'template', 'layout', 'screen', 'form', 'button', 'input', 'modal', 'dialog', 'menu', 'nav', 'accessibility', 'a11y', 'aria'
];

export function isAccessibilityRelevant(filename: string): boolean {
  const lower = filename.toLowerCase();
  
  if (ACCESSIBILITY_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return true;
  }
  
  if (ACCESSIBILITY_PATTERNS.some(p => lower.includes(p))) {
    return true;
  }

  if (lower.includes('test') || lower.includes('spec') || lower.includes('.test.') || lower.includes('.spec.')) {
    return false;
  }

  if (lower.includes('node_modules') || lower.includes('.min.') || lower.includes('.d.ts')) {
    return false;
  }

  return false;
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