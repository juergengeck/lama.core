/**
 * Platform abstraction for LLM operations
 * Browser and Electron implement this differently
 */
export interface LLMPlatform {
  emitProgress(topicId: string, progress: number): void;
  emitError(topicId: string, error: Error): void;
  emitMessageUpdate(
    topicId: string,
    messageId: string,
    content: string | { thinking?: string; response: string; raw?: string },
    status: string,
    modelId?: string,
    modelName?: string
  ): void;
  emitStreamChunk?(data: { topicId: string; chunk: string; messageId?: string }): void;
  emitAnalysisUpdate?(topicId: string, updateType: 'subjects' | 'keywords' | 'both'): void;
  emitThinkingUpdate?(topicId: string, messageId: string, thinkingContent: string): void;
  emitThinkingStatus?(topicId: string, status: string): void;
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
