/**
 * Ollama LLM Adapter
 *
 * Handles communication with Ollama server (local or remote).
 * Supports context caching for conversation continuation.
 */

import type { LLM } from '../../@OneObjectInterfaces.js';
import type { LLMAdapter, AdapterCapabilities, ChatMessage, ChatOptions, ChatResult } from './types.js';
import { chatWithOllama } from '../ollama.js';
import { formatForStandardAPI } from '../context-budget-manager.js';
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('OllamaAdapter');

export class OllamaAdapter implements LLMAdapter {
  readonly id = 'ollama';
  readonly name = 'Ollama';

  readonly capabilities: AdapterCapabilities = {
    chat: true,
    streaming: true,
    structuredOutput: true, // Via JSON mode
    thinking: false,
    toolCalls: false, // Ollama doesn't have native tool support
    embeddings: true
  };

  // Context cache for conversation continuation (topicId → context array)
  private contextCache: Map<string, number[]> = new Map();

  /**
   * Check if this adapter can handle the given LLM
   */
  canHandle(llm: LLM): boolean {
    return llm.provider === 'ollama' ||
           (llm.inferenceType === 'server' && !llm.provider); // Default for server-based
  }

  /**
   * Execute chat with Ollama
   */
  async chat(llm: LLM, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const modelName = llm.modelId || llm.name;
    const baseUrl = llm.server || 'http://localhost:11434';

    MessageBus.send('debug', `Ollama chat: ${modelName}, ${messages.length} msgs, ${baseUrl}`);

    // Get temperature and maxTokens from LLM object or options
    const temperature = options?.temperature ?? llm.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? llm.maxTokens ?? 4096;

    // Check if we have PromptParts for optimized context
    let ollamaMessages: any[];
    const promptParts = (options as any)?.promptParts;

    if (promptParts) {
      const formatted = formatForStandardAPI(promptParts);
      ollamaMessages = formatted.messages;
    } else {
      // Standard message array
      ollamaMessages = messages;
    }

    // Get cached context for this topic (if available)
    const cachedContext = options?.topicId ? this.contextCache.get(options.topicId) : undefined;

    try {
      const response = await chatWithOllama(
        modelName,
        ollamaMessages,
        {
          temperature,
          max_tokens: maxTokens,
          onStream: options?.onStream,
          onThinkingStream: options?.onThinkingStream,
          format: (options as any)?.format, // Structured output schema
          topicId: options?.topicId,
          context: cachedContext
        },
        baseUrl
      );

      // Extract and cache context from response (if present)
      if (options?.topicId && typeof response === 'object' && response !== null && '_hasContext' in response) {
        const contextArray = (response as any).context;
        if (contextArray && Array.isArray(contextArray)) {
          this.contextCache.set(options.topicId, contextArray);
          MessageBus.send('debug', `Cached context for topic ${options.topicId} (${contextArray.length} tokens)`);
        }
      }

      return this.normalizeResponse(response);
    } catch (error: any) {
      // If structured output was requested and failed, surface this
      if ((options as any)?.format && error.message?.includes('generated no response')) {
        throw new Error(
          `Model ${modelName} does not support structured output. ` +
          `The model failed to generate a response with JSON schema constraints.`
        );
      }
      throw error;
    }
  }

  /**
   * Normalize Ollama response to standard ChatResult
   */
  private normalizeResponse(response: any): ChatResult {
    if (typeof response === 'string') {
      return { content: response };
    }

    if (typeof response === 'object') {
      // Ollama returns { content, context, ... }
      return {
        content: response.content || response.response || response.message?.content || '',
        usage: response.eval_count ? {
          promptTokens: response.prompt_eval_count || 0,
          completionTokens: response.eval_count || 0,
          totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0)
        } : undefined,
        finishReason: response.done ? 'stop' : undefined,
        raw: response
      };
    }

    return { content: String(response) };
  }

  /**
   * Test connection to Ollama server
   */
  async testConnection(llm: LLM): Promise<{ success: boolean; error?: string }> {
    const baseUrl = llm.server || 'http://localhost:11434';

    try {
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * List available models from Ollama server
   */
  async listModels(llm: LLM): Promise<Array<{ id: string; name: string; size?: number }>> {
    const baseUrl = llm.server || 'http://localhost:11434';

    try {
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json() as any;
      return (data.models || []).map((m: any) => ({
        id: m.name,
        name: m.name,
        size: m.size
      }));
    } catch {
      return [];
    }
  }

  /**
   * Clear context cache for a topic
   */
  clearContextCache(topicId: string): void {
    this.contextCache.delete(topicId);
  }

  /**
   * Clear all context caches
   */
  clearAllContextCaches(): void {
    this.contextCache.clear();
  }
}
