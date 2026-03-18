/**
 * Ollama API client implementation
 */

import { LLMClientInterface, LLMClientResponse } from './base';
import { A11yIssue } from '../types';

export class OllamaClient implements LLMClientInterface {
  private apiUrl: string;
  private model: string;
  private timeout: number = 300000; // 5 minutes

  constructor(apiUrl: string = 'http://localhost:11434', model: string = 'qwen2.5-coder:32b') {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.model = model;
  }

  get modelName(): string {
    return this.model;
  }

  get backendType(): string {
    return 'ollama';
  }

  private async request(endpoint: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.apiUrl}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private async ensureModelAvailable(): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/api/tags`);
      const data = await response.json() as { models?: Array<{ name: string }> };
      const models = data.models || [];
      const modelNames = models.map(m => m.name.split(':')[0]);

      if (!modelNames.includes(this.model.split(':')[0])) {
        console.log(`Model ${this.model} not found, pulling...`);
        await this.pullModel();
      }
    } catch (error) {
      throw new Error(`Failed to check/pull model: ${error}`);
    }
  }

  private async pullModel(): Promise<void> {
    await fetch(`${this.apiUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.model, stream: false }),
      signal: AbortSignal.timeout(600000), // 10 minutes for pull
    });
  }

  async analyzeDiff(
    diffContent: string,
    systemPrompt: string,
    userPrompt: string,
    _jsonSchema?: object
  ): Promise<LLMClientResponse> {
    await this.ensureModelAvailable();

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}\n\n## Diff to Analyze:\n\n${diffContent}\n\nIMPORTANT: Respond with valid JSON only. No markdown formatting.`;

    const requestData = {
      model: this.model,
      prompt: fullPrompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        top_p: 0.95,
        num_ctx: 32768,
      },
    };

    try {
      const result = await this.request('generate', requestData);
      const content = String(result.response || '');

      // Parse the JSON response
      let issues: A11yIssue[] = [];
      let summary: string | undefined;

      try {
        const parsed = JSON.parse(this.extractJson(content));
        if (Array.isArray(parsed.issues)) {
          issues = parsed.issues.map((issue: Record<string, unknown>) => ({
            file: String(issue.file),
            line: Number(issue.line),
            wcag_criterion: String(issue.wcag_criterion),
            wcag_level: (issue.wcag_level as 'A' | 'AA' | 'AAA') || 'A',
            severity: issue.severity as A11yIssue['severity'],
            title: String(issue.title),
            description: String(issue.description),
            suggestion: String(issue.suggestion),
            element: issue.element ? String(issue.element) : undefined,
          }));
        }
        summary = parsed.summary;
      } catch (parseError) {
        console.warn('Failed to parse Ollama response:', parseError);
      }

      const usage = {
        promptTokens: Number(result.prompt_eval_count || 0),
        completionTokens: Number(result.eval_count || 0),
        totalTokens: Number(result.prompt_eval_count || 0) + Number(result.eval_count || 0),
      };

      return {
        content,
        model: this.model,
        issues,
        summary,
        usage,
      };
    } catch (error) {
      throw new Error(`Ollama generation error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private extractJson(content: string): string {
    // Try to find JSON array or object
    const arrayMatch = content.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      // Wrap in object if it's just an array
      return `{"issues": ${arrayMatch[0]}}`;
    }

    const objectMatch = content.match(/\{[\s\S]*?\}/);
    if (objectMatch) {
      return objectMatch[0];
    }

    return content;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  getModelInfo(): { backend: string; model: string; apiUrl: string } {
    return {
      backend: 'ollama',
      model: this.model,
      apiUrl: this.apiUrl,
    };
  }
}