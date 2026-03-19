import { A11yIssue } from '../state/types';
interface AnalysisResult {
    issues: A11yIssue[];
    summary: string;
}
export declare class OllamaClient {
    private ollama;
    private model;
    constructor(host?: string, model?: string, apiKey?: string);
    analyze(diffContent: string, prompt: string): Promise<AnalysisResult>;
    private parseResponse;
}
export {};
//# sourceMappingURL=ollama-client.d.ts.map