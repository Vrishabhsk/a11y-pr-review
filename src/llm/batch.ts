import { A11yIssue, MAX_ISSUES } from '../state/types';

interface AnalysisResult {
  issues: A11yIssue[];
  summary: string;
}

interface LLMClient {
  analyze(diffContent: string, prompt: string): Promise<AnalysisResult>;
}

export async function analyzeFilesInBatches(
  files: Array<{ filename: string; patch?: string }>,
  llmBackend: string,
  apiKey: string | undefined,
  model: string,
  ollamaUrl: string,
  prompt: string
): Promise<AnalysisResult> {
  const BATCH_SIZE = 20;
  const allIssues: A11yIssue[] = [];

  const batches: Array<Array<{ filename: string; patch?: string }>> = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    batches.push(files.slice(i, i + BATCH_SIZE));
  }

  const { GeminiClient } = await import('./gemini-client');
  const { OllamaClient } = await import('./ollama-client');

  const client: LLMClient = llmBackend === 'gemini'
    ? new GeminiClient(apiKey || '', model)
    : new OllamaClient(ollamaUrl, model, apiKey);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    
    console.log(`Analyzing batch ${batchNum}/${batches.length} (${batch.length} files)`);

    const diffLines: string[] = [];
    for (const file of batch) {
      if (!file.patch) continue;
      diffLines.push(`=== ${file.filename} ===`);
      for (const line of file.patch.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          diffLines.push(line.substring(1));
        }
      }
      diffLines.push('');
    }

    const diffContent = diffLines.join('\n');

    if (!diffContent.trim()) {
      console.log(`Batch ${batchNum} has no content, skipping`);
      continue;
    }

    try {
      const result = await client.analyze(diffContent, prompt);
      
      for (const issue of result.issues) {
        allIssues.push(issue);
      }

      console.log(`Batch ${batchNum}: Found ${result.issues.length} issues`);

      if (batches.length > 1 && i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.warn(`Batch ${batchNum} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    issues: allIssues.slice(0, MAX_ISSUES),
    summary: `Analyzed ${files.length} files, found ${allIssues.length} issues`,
  };
}