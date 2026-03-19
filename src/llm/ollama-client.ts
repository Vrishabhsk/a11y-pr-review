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
  private apiKey: string | null;

  constructor(apiUrl: string = 'http://localhost:11434', model: string = 'qwen2.5-coder:32b', apiKey?: string) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.model = model;
    this.apiKey = apiKey || null;
  }

  async analyze(diffContent: string, prompt: string): Promise<AnalysisResult> {
    const fullPrompt = `${prompt}\n\n---\n\n## Code Diff:\n\n${diffContent}\n\nRespond with valid JSON only.`;

    // Use /api/chat for cloud (Ollama.com) or /api/generate for local
    const isCloud = this.apiUrl.includes('ollama.com');
    const endpoint = isCloud ? '/api/chat' : '/api/generate';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let body: object;
    
    if (isCloud) {
      // Cloud API uses chat format
      body = {
        model: this.model,
        messages: [
          { role: 'user', content: fullPrompt }
        ],
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1,
          num_ctx: 32768,
        },
      };
    } else {
      // Local API uses generate format
      body = {
        model: this.model,
        prompt: fullPrompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1,
          num_ctx: 32768,
        },
      };
    }

    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      const authHint = response.status === 401 
        ? ' (API key may be required - set ollama-api-key input or OLLAMA_API_KEY env var)'
        : '';
      throw new Error(`Ollama API error (${response.status}): ${text}${authHint}`);
    }

    const data = await response.json() as Record<string, unknown>;
    
    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }

    // Extract content based on API type
    let content: string;
    if (isCloud && data.message && typeof data.message === 'object') {
      const msg = data.message as Record<string, unknown>;
      content = String(msg.content || '');
    } else {
      content = String((data as { response?: string }).response || '');
    }
    
    try {
      let parsed: Record<string, unknown>;
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(content);
      }

      const issues: A11yIssue[] = ((parsed.issues as Array<Record<string, unknown>>) || []).map((issue) => {
        const rawSeverity = String(issue.severity || 'suggestion').toUpperCase();
        const severity: A11yIssue['severity'] = 
          rawSeverity === 'CRITICAL' ? 'CRITICAL' :
          rawSeverity === 'IMPORTANT' ? 'IMPORTANT' :
          rawSeverity === 'NIT' ? 'NIT' : 'SUGGESTION';
        
        return {
          file: String(issue.file || ''),
          line: issue.line ? Number(issue.line) : null,
          wcag_criterion: String(issue.wcag_criterion || ''),
          wcag_level: String(issue.wcag_level || 'A'),
          severity,
          title: String(issue.title || ''),
          description: String(issue.description || ''),
          suggestion: String(issue.suggestion || ''),
        };
      });

      return {
        issues,
        summary: String(parsed.summary || 'Accessibility review completed.'),
      };
    } catch (parseError) {
      throw new Error(`Failed to parse Ollama response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
  }
}