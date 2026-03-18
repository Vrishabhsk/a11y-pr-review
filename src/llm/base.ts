/**
 * Abstract base class for LLM clients
 */

import { A11yIssue } from '../types';

export interface LLMClientInterface {
  analyzeDiff(
    diffContent: string,
    systemPrompt: string,
    userPrompt: string,
    jsonSchema?: object
  ): Promise<LLMClientResponse>;

  healthCheck(): Promise<boolean>;

  getModelInfo(): { backend: string; model: string };

  readonly modelName: string;
  readonly backendType: string;
}

export interface LLMClientResponse {
  content: string;
  model: string;
  issues: A11yIssue[];
  summary?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}