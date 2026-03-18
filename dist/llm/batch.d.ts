import { A11yIssue, FilePatch } from '../state/types';
interface BatchResult {
    issues: A11yIssue[];
}
export declare function analyzeFilesInBatches(files: FilePatch[], llmBackend: string, apiKey: string, model: string, ollamaUrl: string, prompt: string): Promise<BatchResult>;
export {};
//# sourceMappingURL=batch.d.ts.map