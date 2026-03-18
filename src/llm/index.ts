export { LLMClientInterface, LLMClientResponse } from './base';
export { GeminiClient } from './gemini-client';
export { OllamaClient } from './ollama-client';

import { LLMClientInterface } from './base';
import { GeminiClient } from './gemini-client';
import { OllamaClient } from './ollama-client';

export function createLLMClient(backend: string, options: {
  apiKey?: string;
  model?: string;
  apiUrl?: string;
}): LLMClientInterface {
  const normalizedBackend = backend.toLowerCase().trim();

  if (normalizedBackend === 'gemini') {
    if (!options.apiKey) {
      throw new Error('Gemini API key is required. Set the gemini-api-key input.');
    }
    return new GeminiClient(options.apiKey, options.model || 'gemini-2.0-flash');
  }

  if (normalizedBackend === 'ollama') {
    return new OllamaClient(options.apiUrl || 'http://localhost:11434', options.model || 'qwen2.5-coder:32b');
  }

  throw new Error(`Unsupported LLM backend: ${backend}. Use 'gemini' or 'ollama'.`);
}