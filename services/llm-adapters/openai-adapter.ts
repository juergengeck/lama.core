/**
 * OpenAI LLM Adapter
 *
 * Handles communication with OpenAI API (GPT models).
 */

import type { LLM } from '../../@OneObjectInterfaces.js';
import type { LLMAdapter, AdapterCapabilities, ChatMessage, ChatOptions, ChatResult } from './types.js';
import { chatWithOpenAIHTTP } from '../openai-http.js';
import { formatForStandardAPI } from '../context-budget-manager.js';
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('OpenAIAdapter');

export class OpenAIAdapter implements LLMAdapter {
  readonly id = 'openai';
  readonly name = 'OpenAI';

  readonly capabilities: AdapterCapabilities = {
    chat: true,
    streaming: true,
    structuredOutput: true, // JSON mode
    thinking: false,
    toolCalls: true, // OpenAI has function calling
    embeddings: true
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
    return llm.provider === 'openai';
  }

  /**
   * Execute chat with OpenAI
   */
  async chat(llm: LLM, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const apiKey = options?.apiKey;
    if (!apiKey) {
      throw new Error('OpenAI API key not provided - platform layer must supply options.apiKey');
    }

    // Extract base model ID - remove private suffix and provider prefix
    const baseModelId = (llm.modelId || llm.name).replace('-private', '').replace(/^openai:/, '');

    MessageBus.send('debug', `Calling OpenAI with model ID: ${baseModelId}`);

    // Get temperature and maxTokens from LLM object or options
    const temperature = options?.temperature ?? llm.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? llm.maxTokens ?? 4096;

    // Check if we have PromptParts for optimized context
    let openaiMessages: any[];
    const promptParts = (options as any)?.promptParts;

    if (promptParts) {
      const formatted = formatForStandardAPI(promptParts);
      openaiMessages = formatted.messages;
    } else {
      // Standard message array
      openaiMessages = messages.map(m => ({
        role: m.role,
        content: m.content
      }));
    }

    // Get MCP tools if available and not explicitly disabled (OpenAI format)
    const tools = !options?.disableTools && this.mcpManager
      ? this.mcpManager.getOpenAITools?.()
      : undefined;

    const response = await chatWithOpenAIHTTP({
      apiKey,
      model: baseModelId,
      messages: openaiMessages,
      temperature,
      max_tokens: maxTokens,
      tools,
      onStream: options?.onStream,
      signal: (options as any)?.signal,
      proxyUrl: this.corsProxyUrl
    });

    return this.normalizeResponse(response);
  }

  /**
   * Normalize OpenAI response to standard ChatResult
   */
  private normalizeResponse(response: any): ChatResult {
    if (typeof response === 'string') {
      return { content: response };
    }

    if (typeof response === 'object') {
      // OpenAI returns { choices: [{ message: { content }, finish_reason }], usage }
      const choice = response.choices?.[0];
      return {
        content: choice?.message?.content || response.content || '',
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens || 0,
          completionTokens: response.usage.completion_tokens || 0,
          totalTokens: response.usage.total_tokens || 0
        } : undefined,
        finishReason: choice?.finish_reason === 'stop' ? 'stop' :
                      choice?.finish_reason === 'length' ? 'length' :
                      choice?.finish_reason === 'tool_calls' ? 'tool_calls' : undefined,
        raw: response
      };
    }

    return { content: String(response) };
  }

  /**
   * Test connection to OpenAI API
   */
  async testConnection(llm: LLM): Promise<{ success: boolean; error?: string }> {
    if (!llm.provider || llm.provider !== 'openai') {
      return { success: false, error: 'Not an OpenAI model' };
    }
    return { success: true };
  }
}
