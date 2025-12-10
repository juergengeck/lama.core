/**
 * Anthropic LLM Adapter
 *
 * Handles communication with Claude models via Anthropic API.
 * Supports prompt caching and extended thinking.
 */

import type { LLM } from '../../@OneObjectInterfaces.js';
import type { LLMAdapter, AdapterCapabilities, ChatMessage, ChatOptions, ChatResult } from './types.js';
import { chatWithAnthropicHTTP } from '../anthropic-http.js';
import { formatForAnthropicWithCaching } from '../context-budget-manager.js';
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('AnthropicAdapter');

export class AnthropicAdapter implements LLMAdapter {
  readonly id = 'anthropic';
  readonly name = 'Anthropic Claude';

  readonly capabilities: AdapterCapabilities = {
    chat: true,
    streaming: true,
    structuredOutput: true,
    thinking: true, // Extended thinking support
    toolCalls: true,
    embeddings: false
  };

  // Optional: MCP manager for tool support
  private mcpManager?: any;
  // Optional: CORS proxy URL for browser
  private corsProxyUrl?: string;

  constructor(options?: { mcpManager?: any; corsProxyUrl?: string }) {
    this.mcpManager = options?.mcpManager;
    this.corsProxyUrl = options?.corsProxyUrl;
  }

  /**
   * Check if this adapter can handle the given LLM
   */
  canHandle(llm: LLM): boolean {
    return llm.provider === 'anthropic' || llm.inferenceType === 'cloud' && llm.provider === 'anthropic';
  }

  /**
   * Execute chat with Claude
   */
  async chat(llm: LLM, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const apiKey = options?.apiKey;
    if (!apiKey) {
      throw new Error('Claude API key not provided - platform layer must supply options.apiKey');
    }

    // Extract base model ID - remove private suffix and provider prefix
    const baseModelId = (llm.modelId || llm.name).replace('-private', '').replace(/^claude:/, '');

    MessageBus.send('debug', `Calling Claude with model ID: ${baseModelId}`);

    // Get temperature and maxTokens from LLM object or options
    const temperature = options?.temperature ?? llm.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? llm.maxTokens ?? 4096;

    // Get MCP tools if available and not explicitly disabled
    const tools = !options?.disableTools && this.mcpManager
      ? this.mcpManager.getClaudeTools?.()
      : undefined;

    // Check if we have PromptParts for caching support (passed via options)
    const promptParts = (options as any)?.promptParts;

    let response: any;

    if (promptParts) {
      // New path: Use PromptParts with caching
      const formatted = formatForAnthropicWithCaching(promptParts);

      response = await chatWithAnthropicHTTP({
        apiKey,
        model: baseModelId,
        messages: formatted.messages,
        system: formatted.system, // Array with cache_control
        temperature,
        max_tokens: maxTokens,
        tools,
        onStream: options?.onStream,
        signal: (options as any)?.signal,
        proxyUrl: this.corsProxyUrl
      });
    } else {
      // Legacy path: Standard message array
      const anthropicMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const systemMessage = messages.find(m => m.role === 'system')?.content;

      response = await chatWithAnthropicHTTP({
        apiKey,
        model: baseModelId,
        messages: anthropicMessages,
        system: systemMessage,
        temperature,
        max_tokens: maxTokens,
        tools,
        onStream: options?.onStream,
        signal: (options as any)?.signal,
        proxyUrl: this.corsProxyUrl
      });
    }

    // Normalize response to ChatResult
    return this.normalizeResponse(response);
  }

  /**
   * Normalize Anthropic response to standard ChatResult
   */
  private normalizeResponse(response: any): ChatResult {
    // Handle different response formats
    if (typeof response === 'string') {
      return { content: response };
    }

    if (typeof response === 'object') {
      return {
        content: response.content || response.text || '',
        thinking: response.thinking,
        usage: response.usage ? {
          promptTokens: response.usage.input_tokens || 0,
          completionTokens: response.usage.output_tokens || 0,
          totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)
        } : undefined,
        finishReason: response.stop_reason === 'end_turn' ? 'stop' : response.stop_reason,
        raw: response
      };
    }

    return { content: String(response) };
  }

  /**
   * Test connection to Anthropic API
   */
  async testConnection(llm: LLM): Promise<{ success: boolean; error?: string }> {
    // Could make a minimal API call to verify key
    // For now, just check if we have required config
    if (!llm.provider || llm.provider !== 'anthropic') {
      return { success: false, error: 'Not an Anthropic model' };
    }
    return { success: true };
  }
}
