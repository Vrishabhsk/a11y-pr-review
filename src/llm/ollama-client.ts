import { Ollama } from 'ollama';

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
  private ollama: Ollama;
  private model: string;

  constructor(host: string = 'http://localhost:11434', model: string = 'qwen2.5-coder:32b', apiKey?: string) {
    this.model = model;
    
    // Configure Ollama client with host and optional auth
    const config: { host: string; headers?: Record<string, string> } = {
      host: host.replace(/\/$/, ''),
    };

    // Add Authorization header if API key provided (for Ollama Cloud)
    if (apiKey) {
      config.headers = {
        Authorization: `Bearer ${apiKey}`,
      };
    }

    this.ollama = new Ollama(config);
  }

  async analyze(diffContent: string, prompt: string): Promise<AnalysisResult> {
    const fullPrompt = `${prompt}\n\n---\n\n## Code Diff:\n\n${diffContent}\n\nRespond with valid JSON only.`;

    try {
      const response = await this.ollama.chat({
        model: this.model,
        messages: [
          { role: 'user', content: fullPrompt }
        ],
        format: 'json',
        options: {
          temperature: 0.1,
          num_ctx: 32768,
        },
      });

      const content = response.message?.content || '';
      
      if (!content) {
        throw new Error('Empty response from Ollama');
      }

      return this.parseResponse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      // Provide helpful error message for auth issues
      if (message.includes('401') || message.includes('Unauthorized')) {
        throw new Error(
          `Ollama authentication failed. For Ollama Cloud, ensure:\n` +
          `  1. You have a valid API key from https://ollama.com/settings/keys\n` +
          `  2. Set the 'api-key' input or OLLAMA_API_KEY environment variable\n` +
          `  3. Use 'ollama-url: https://ollama.com'\n` +
          `Original error: ${message}`
        );
      }
      
      throw new Error(`Ollama API error: ${message}`);
    }
  }

  private parseResponse(content: string): AnalysisResult {
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