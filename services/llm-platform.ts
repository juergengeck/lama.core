/**
 * Platform abstraction for LLM operations
 * Browser and Electron implement this differently
 */
export interface LLMPlatform {
  emitProgress(data: any): void;
  emitError(error: Error): void;
  emitMessageUpdate(data: any): void;
  emitStreamChunk?(data: { topicId: string; chunk: string; messageId?: string }): void;
}

/**
 * Ollama URL validator - platform-specific validation logic
 */
export interface OllamaValidator {
  validateUrl(url: string): Promise<{ valid: boolean; error?: string }>;
}

/**
 * LLM config manager - platform-specific base URL computation
 */
export interface LLMConfigManager {
  computeBaseUrl(provider: string, config: any): string;
}
