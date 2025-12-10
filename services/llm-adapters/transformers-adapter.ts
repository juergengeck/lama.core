/**
 * Transformers.js LLM Adapter
 *
 * Handles on-device inference using transformers.js.
 * This adapter delegates to the platform layer (LLMPlatform.chatWithLocal)
 * since transformers.js runs differently on Electron vs Browser.
 *
 * The platform layer provides:
 * - Electron: ONNXTextGenerationProvider in main process
 * - Browser: Web Worker with transformers.js
 */

import type { LLM } from '../../@OneObjectInterfaces.js';
import type { LLMAdapter, AdapterCapabilities, ChatMessage, ChatOptions, ChatResult } from './types.js';
import type { LLMPlatform } from '../llm-platform.js';
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('TransformersAdapter');

export class TransformersAdapter implements LLMAdapter {
  readonly id = 'transformers';
  readonly name = 'On-Device (Transformers.js)';

  readonly capabilities: AdapterCapabilities = {
    chat: true,
    streaming: true,
    structuredOutput: false, // Limited support
    thinking: false,
    toolCalls: false,
    embeddings: true // Transformers.js supports embeddings
  };

  // Platform provides the actual inference implementation
  private platform?: LLMPlatform;

  constructor(platform?: LLMPlatform) {
    this.platform = platform;
  }

  /**
   * Set platform (can be set after construction)
   */
  setPlatform(platform: LLMPlatform): void {
    this.platform = platform;
  }

  /**
   * Check if this adapter can handle the given LLM
   */
  canHandle(llm: LLM): boolean {
    // Handle if:
    // 1. inferenceType is explicitly 'ondevice'
    // 2. provider is 'transformers' or 'local'
    return llm.inferenceType === 'ondevice' ||
           llm.provider === 'transformers' ||
           llm.provider === 'local';
  }

  /**
   * Execute chat with local transformers.js model
   */
  async chat(llm: LLM, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    if (!this.platform?.chatWithLocal) {
      throw new Error('Local model inference not supported on this platform - LLMPlatform.chatWithLocal not available');
    }

    const modelId = llm.modelId || llm.name;
    MessageBus.send('debug', `Transformers chat: ${modelId}, ${messages.length} msgs`);

    // Get temperature and maxTokens from LLM object or options
    const temperature = options?.temperature ?? llm.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? llm.maxTokens ?? 2048;

    try {
      const response = await this.platform.chatWithLocal(modelId, messages, {
        onStream: options?.onStream,
        temperature,
        maxTokens,
        format: (options as any)?.format,
        topicId: options?.topicId
      });

      return this.normalizeResponse(response);
    } catch (error: any) {
      MessageBus.send('error', `Transformers chat failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Normalize response to standard ChatResult
   */
  private normalizeResponse(response: any): ChatResult {
    if (typeof response === 'string') {
      return { content: response };
    }

    if (typeof response === 'object') {
      return {
        content: response.content || response.text || response.response || '',
        raw: response
      };
    }

    return { content: String(response) };
  }

  /**
   * Check if model is loaded
   */
  isModelLoaded(llm: LLM): boolean {
    if (!this.platform?.isLocalModelLoaded) {
      return false;
    }
    const modelId = llm.modelId || llm.name;
    return this.platform.isLocalModelLoaded(modelId);
  }

  /**
   * Pre-load a model
   */
  async loadModel(llm: LLM, onProgress?: (progress: number) => void): Promise<void> {
    if (!this.platform?.loadLocalModel) {
      throw new Error('Local model loading not supported on this platform');
    }
    const modelId = llm.modelId || llm.name;
    await this.platform.loadLocalModel(modelId, onProgress);
  }

  /**
   * Unload a model
   */
  async unloadModel(llm: LLM): Promise<void> {
    if (!this.platform?.unloadLocalModel) {
      return;
    }
    const modelId = llm.modelId || llm.name;
    await this.platform.unloadLocalModel(modelId);
  }

  /**
   * Get available local models
   */
  async listModels(_llm: LLM): Promise<Array<{ id: string; name: string; size?: number }>> {
    if (!this.platform?.getAvailableLocalModels) {
      return [];
    }
    const models = await this.platform.getAvailableLocalModels();
    return models.map(m => ({
      id: m.id,
      name: m.name,
      size: m.size
    }));
  }

  /**
   * Test if local inference is available
   */
  async testConnection(_llm: LLM): Promise<{ success: boolean; error?: string }> {
    if (!this.platform?.chatWithLocal) {
      return { success: false, error: 'Platform does not support local inference' };
    }
    return { success: true };
  }
}
