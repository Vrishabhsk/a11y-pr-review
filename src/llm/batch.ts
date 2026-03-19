import * as core from '@actions/core';
import { GeminiClient } from './gemini-client';
import { OllamaClient } from './ollama-client';
import { A11yIssue, FilePatch, BATCH_SIZE } from '../state/types';
import { formatDiffForAnalysis } from '../parsers/diff-parser';

interface LLMClient {
  analyze(diffContent: string, prompt: string): Promise<{ issues: A11yIssue[]; summary: string }>;
}

interface BatchResult {
  issues: A11yIssue[];
}

export async function analyzeFilesInBatches(
  files: FilePatch[],
  llmBackend: string,
  apiKey: string | undefined,
  model: string,
  ollamaUrl: string,
  prompt: string
): Promise<BatchResult> {
  const allIssues: A11yIssue[] = [];

  const batches: FilePatch[][] = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    batches.push(files.slice(i, i + BATCH_SIZE));
  }

  core.info(`Analyzing ${files.length} files in ${batches.length} batch(es)`);

  const client: LLMClient = llmBackend === 'gemini'
    ? new GeminiClient(apiKey || '', model)
    : new OllamaClient(ollamaUrl, model, apiKey);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    
    core.info(`Analyzing batch ${batchNum}/${batches.length} (${batch.length} files)`);

    const diffContent = formatDiffForAnalysis(batch);

    if (!diffContent.trim()) {
      core.info(`Batch ${batchNum} has no relevant content, skipping`);
      continue;
    }

    try {
      const result = await client.analyze(diffContent, prompt);
      
      for (const issue of result.issues) {
        allIssues.push(issue);
      }

      core.info(`Batch ${batchNum}: Found ${result.issues.length} issues`);

      if (batches.length > 1 && i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      core.warning(`Batch ${batchNum} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    issues: allIssues,
  };
}