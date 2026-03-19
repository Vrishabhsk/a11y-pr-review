import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { A11yIssue } from '../state/types';
import { getSystemPrompt } from '../prompts';

interface AnalysisResult {
  issues: A11yIssue[];
  summary: string;
}

export class GeminiClient {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-2.0-flash') {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async analyze(diffContent: string, prompt: string): Promise<AnalysisResult> {
    const schema = {
      type: SchemaType.OBJECT,
      properties: {
        issues: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              file: { type: SchemaType.STRING },
              line: { type: SchemaType.INTEGER, nullable: true },
              wcag_criterion: { type: SchemaType.STRING },
              wcag_level: { type: SchemaType.STRING },
              severity: { type: SchemaType.STRING },
              title: { type: SchemaType.STRING },
              description: { type: SchemaType.STRING },
              suggestion: { type: SchemaType.STRING },
            },
            required: ['file', 'wcag_criterion', 'wcag_level', 'severity', 'description', 'suggestion'],
          },
        },
        summary: { type: SchemaType.STRING },
      },
      required: ['issues', 'summary'],
    };

    const systemInstruction = getSystemPrompt();
    const fullUserPrompt = `${prompt}\n\n---\n\n## Code Diff:\n\n${diffContent}`;

    const genModel = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });

    try {
      const result = await genModel.generateContent(fullUserPrompt);
      const text = result.response.text();
      
      const parsed = JSON.parse(text);
      
      const issues: A11yIssue[] = (parsed.issues || []).map((issue: Record<string, unknown>) => {
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
    } catch (error) {
      throw new Error(`Gemini API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}