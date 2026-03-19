import { A11yIssue } from '../state/types';
interface AnalysisResult {
    issues: A11yIssue[];
    summary: string;
}
export declare function analyzeFilesInBatches(files: Array<{
    filename: string;
    patch?: string;
}>, llmBackend: string, apiKey: string | undefined, model: string, ollamaUrl: string, prompt: string): Promise<AnalysisResult>;
export {};
//# sourceMappingURL=batch.d.ts.map