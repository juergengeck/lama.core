/**
 * Message format for chat operations
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Options for local text generation
 */
export interface LocalChatOptions {
  onStream?: (chunk: string) => void;
  temperature?: number;
  maxTokens?: number;
  format?: any; // JSON schema for structured output (analytics)
  topicId?: string;
}

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

  // Local text generation support (optional - platforms implement if they support local models)
  chatWithLocal?(modelId: string, messages: ChatMessage[], options: LocalChatOptions): Promise<string>;
  isLocalModelLoaded?(modelId: string): boolean;
  loadLocalModel?(modelId: string, onProgress?: (progress: number) => void): Promise<void>;
  unloadLocalModel?(modelId: string): Promise<void>;
  getAvailableLocalModels?(): Promise<Array<{ id: string; name: string; size: number; installed: boolean }>>;
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
