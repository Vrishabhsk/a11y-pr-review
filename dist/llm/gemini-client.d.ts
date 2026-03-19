import { A11yIssue } from '../state/types';
interface AnalysisResult {
    issues: A11yIssue[];
    summary: string;
}
export declare class GeminiClient {
    private client;
    private model;
    constructor(apiKey: string, model?: string);
    analyze(diffContent: string, prompt: string): Promise<AnalysisResult>;
}
export {};
//# sourceMappingURL=gemini-client.d.ts.map