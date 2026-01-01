/**
 * LLM Adapter Types
 *
 * Defines the interface for LLM adapters that handle communication
 * with different inference backends (Ollama, Anthropic, OpenAI, transformers.js, etc.)
 *
 * Pattern: Demand/Supply - adapters are registered by provider key and
 * the LLM object's properties determine which adapter is used.
 */

import type { LLM } from '../../@OneObjectInterfaces.js';

/**
 * Chat message format (standard across all adapters)
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Options for chat operations
 */
export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  topicId?: string;
  format?: any; // JSON schema for structured output
  onStream?: (chunk: string) => void;
  onThinkingStream?: (chunk: string) => void;
  disableTools?: boolean;
  apiKey?: string; // For cloud providers
}

/**
 * Result from a chat operation
 */
export interface ChatResult {
  content: string;
  thinking?: string;
  /** ISO 639-1 language code of the response (e.g., 'en', 'de', 'fr') */
  language?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
  raw?: any; // Provider-specific raw response
}

/**
 * Adapter capabilities - what the adapter can do
 */
export interface AdapterCapabilities {
  chat: boolean;
  streaming: boolean;
  structuredOutput: boolean;
  thinking: boolean; // Extended thinking support
  toolCalls: boolean;
  embeddings: boolean;
}

/**
 * LLM Adapter Interface
 *
 * Each adapter handles communication with a specific type of LLM backend.
 * Adapters are stateless - all configuration comes from the LLM object.
 */
export interface LLMAdapter {
  /**
   * Unique identifier for this adapter (e.g., 'ollama', 'anthropic', 'transformers')
   */
  readonly id: string;

  /**
   * Human-readable name
   */
  readonly name: string;

  /**
   * What this adapter can do
   */
  readonly capabilities: AdapterCapabilities;

  /**
   * Check if this adapter can handle the given LLM configuration
   * Used for adapter selection when multiple adapters could potentially handle a model
   */
  canHandle(llm: LLM): boolean;

  /**
   * Execute a chat completion
   */
  chat(llm: LLM, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;

  /**
   * Test connection to the backend (optional)
   * Returns true if the backend is reachable and the model is available
   */
  testConnection?(llm: LLM): Promise<{ success: boolean; error?: string }>;

  /**
   * Get available models from the backend (optional)
   * For server-based providers that can list models
   */
  listModels?(llm: LLM): Promise<Array<{ id: string; name: string; size?: number }>>;
}

/**
 * Registry for LLM adapters
 * Platforms register adapters, LLMManager looks them up based on LLM properties
 */
export interface LLMAdapterRegistry {
  /**
   * Register an adapter
   */
  register(adapter: LLMAdapter): void;

  /**
   * Get adapter for an LLM (based on provider/inferenceType)
   */
  getAdapter(llm: LLM): LLMAdapter | null;

  /**
   * Get all registered adapters
   */
  getAllAdapters(): LLMAdapter[];

  /**
   * Check if an adapter exists for the given provider
   */
  hasAdapter(provider: string): boolean;
}
