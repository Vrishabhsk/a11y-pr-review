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
export declare class OllamaClient {
    private apiUrl;
    private model;
    constructor(apiUrl?: string, model?: string);
    analyze(diffContent: string, prompt: string): Promise<AnalysisResult>;
}
export {};
//# sourceMappingURL=ollama-client.d.ts.map