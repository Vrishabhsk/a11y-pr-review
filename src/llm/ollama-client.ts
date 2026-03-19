import { Ollama } from 'ollama';
import { A11yIssue } from '../state/types';

interface AnalysisResult {
  issues: A11yIssue[];
  summary: string;
}

export class OllamaClient {
  private ollama: Ollama;
  private model: string;

  constructor(host: string = 'http://localhost:11434', model: string = 'qwen2.5-coder:32b', apiKey?: string) {
    this.model = model;
    
    const config: { host: string; headers?: Record<string, string> } = {
      host: host.replace(/\/$/, ''),
    };

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
      // Try parsing the entire content as JSON first
      try {
        const parsed = JSON.parse(content);
        return this.extractIssues(parsed);
      } catch {
        // Content might have extra text, extract JSON object
      }

      // Find JSON object by matching brackets
      const startIndex = content.indexOf('{');
      if (startIndex === -1) {
        throw new Error('No JSON object found in response');
      }

      let depth = 0;
      let endIndex = startIndex;

      for (let i = startIndex; i < content.length; i++) {
        if (content[i] === '{') depth++;
        if (content[i] === '}') depth--;
        if (depth === 0) {
          endIndex = i + 1;
          break;
        }
      }

      const jsonStr = content.substring(startIndex, endIndex);
      const parsed = JSON.parse(jsonStr);
      return this.extractIssues(parsed);
    } catch (parseError) {
      console.error('Raw Ollama response:', content.substring(0, 500));
      throw new Error(`Failed to parse Ollama response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
  }

  private extractIssues(parsed: Record<string, unknown>): AnalysisResult {
    const issues: A11yIssue[] = ((parsed.issues as Array<Record<string, unknown>>) || []).map((issue) => {
      const rawSeverity = String(issue.severity || 'GOOD_PRACTICE').toUpperCase();
      const severity: A11yIssue['severity'] = rawSeverity === 'VIOLATION' ? 'VIOLATION' : 'GOOD_PRACTICE';
      
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
  }
}