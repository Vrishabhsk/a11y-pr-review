/**
 * Gemini API client implementation
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { LLMClientInterface, LLMClientResponse } from './base';
import { A11yIssue } from '../types';

export class GeminiClient implements LLMClientInterface {
  private apiKey: string;
  private model: string;
  private genAI: GoogleGenerativeAI;
  private genModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;

  constructor(apiKey: string, model: string = 'gemini-2.0-flash') {
    this.apiKey = apiKey;
    this.model = model;
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  get modelName(): string {
    return this.model;
  }

  get backendType(): string {
    return 'gemini';
  }

  private getSchema(): object {
    return {
      type: SchemaType.OBJECT,
      properties: {
        issues: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              file: { type: SchemaType.STRING, description: 'File path relative to repository root' },
              line: { type: SchemaType.INTEGER, description: 'Line number in the NEW file' },
              wcag_criterion: { type: SchemaType.STRING, description: "WCAG criterion number" },
              wcag_level: { type: SchemaType.STRING, description: 'WCAG conformance level (A, AA, AAA)' },
              severity: { type: SchemaType.STRING, description: 'Severity level' },
              title: { type: SchemaType.STRING, description: 'Brief title of the issue' },
              description: { type: SchemaType.STRING, description: 'Detailed description' },
              suggestion: { type: SchemaType.STRING, description: 'Specific code change to fix' },
              element: { type: SchemaType.STRING, description: 'The HTML element affected' },
            },
            required: ['file', 'line', 'wcag_criterion', 'wcag_level', 'severity', 'title', 'description', 'suggestion'],
          },
        },
        summary: { type: SchemaType.STRING, description: 'Brief summary of findings' },
      },
      required: ['issues'],
    };
  }

  async analyzeDiff(
    diffContent: string,
    systemPrompt: string,
    userPrompt: string,
    _jsonSchema?: object
  ): Promise<LLMClientResponse> {
    // Initialize model with schema
    this.genModel = this.genAI.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: 0.1,
        topP: 0.95,
        responseMimeType: 'application/json',
        responseSchema: this.getSchema(),
      },
    });

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}\n\n## Diff to Analyze:\n\n${diffContent}`;

    try {
      const result = await this.genModel.generateContent(fullPrompt);
      const response = result.response;
      const text = response.text();

      // Parse the JSON response
      let issues: A11yIssue[] = [];
      let summary: string | undefined;

      try {
        const parsed = JSON.parse(text);
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
        console.warn('Failed to parse LLM response as JSON:', parseError);
      }

      // Extract usage if available
      const usage = result.response.usageMetadata ? {
        promptTokens: result.response.usageMetadata.promptTokenCount || 0,
        completionTokens: result.response.usageMetadata.candidatesTokenCount || 0,
        totalTokens: result.response.usageMetadata.totalTokenCount || 0,
      } : undefined;

      return {
        content: text,
        model: this.model,
        issues,
        summary,
        usage,
      };
    } catch (error) {
      throw new Error(`Gemini API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.model });
      await model.generateContent('test');
      return true;
    } catch {
      return false;
    }
  }

  getModelInfo(): { backend: string; model: string } {
    return {
      backend: 'gemini',
      model: this.model,
    };
  }
}