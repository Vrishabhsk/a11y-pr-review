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
export declare class GeminiClient {
    private client;
    private model;
    constructor(apiKey: string, model?: string);
    analyze(diffContent: string, prompt: string): Promise<AnalysisResult>;
}
export {};
//# sourceMappingURL=gemini-client.d.ts.map