interface A11yIssue {
  file: string;
  line: number | null;
  wcag_criterion: string;
  wcag_level: string;
  severity: 'CRITICAL' | 'IMPORTANT' | 'SUGGESTION' | 'NIT';
  title: string;
  description: string;
  suggestion: string;
}

interface AnalysisResult {
  issues: A11yIssue[];
  summary: string;
}

export class OllamaClient {
  private apiUrl: string;
  private model: string;

  constructor(apiUrl: string = 'http://localhost:11434', model: string = 'qwen2.5-coder:32b') {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.model = model;
  }

  async analyze(diffContent: string, prompt: string): Promise<AnalysisResult> {
    const fullPrompt = `${prompt}\n\n---\n\n## Code Diff:\n\n${diffContent}\n\nRespond with valid JSON only.`;

    const response = await fetch(`${this.apiUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: fullPrompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1,
          num_ctx: 32768,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${text}`);
    }

    const data = await response.json() as { response?: string; error?: string };
    
    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }

    const content = data.response || '';
    
    try {
      let parsed: Record<string, unknown>;
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(content);
      }

      const issues: A11yIssue[] = (parsed.issues as Array<Record<string, unknown>> || []).map((issue) => ({
        file: String(issue.file || ''),
        line: issue.line ? Number(issue.line) : null,
        wcag_criterion: String(issue.wcag_criterion || ''),
        wcag_level: String(issue.wcag_level || 'A'),
        severity: (issue.severity as A11yIssue['severity']) || 'SUGGESTION',
        title: String(issue.title || ''),
        description: String(issue.description || ''),
        suggestion: String(issue.suggestion || ''),
      }));

      return {
        issues,
        summary: String(parsed.summary || 'Accessibility review completed.'),
      };
    } catch (parseError) {
      throw new Error(`Failed to parse Ollama response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
  }
}