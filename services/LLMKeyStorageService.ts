/**
 * LLM Key Storage Service (AI Functionality)
 *
 * Extracted from OneCoreHandler - AI-specific secure storage.
 * Provides secure storage and retrieval for LLM API keys using LLM objects.
 */

import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';

/**
 * LLMKeyStorageService - Secure storage for LLM API keys
 */
export class LLMKeyStorageService {
  private channelManager: ChannelManager;

  constructor(channelManager: ChannelManager) {
    this.channelManager = channelManager;
  }

  /**
   * Store LLM API key securely
   *
   * NOTE: This method requires LLMConfigHandler dependency.
   * The platform adapter should inject the llmConfigHandler instance.
   *
   * @param key - Storage key (e.g., 'claude_api_key')
   * @param value - API key value
   * @param llmConfigHandler - LLMConfigHandler instance for storing config
   */
  async secureStore(
    key: string,
    value: any,
    llmConfigHandler: any
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    console.log(`[LLMKeyStorageService] Secure store: ${key}`);

    try {
      if (key === 'claude_api_key') {
        if (!llmConfigHandler) {
          throw new Error('LLM config handler not provided');
        }

        console.log('[LLMKeyStorageService] Storing Claude API key via LLMConfigHandler...');
        const result = await llmConfigHandler.setConfig({
          modelType: 'remote',
          baseUrl: 'https://api.anthropic.com',
          authType: 'bearer',
          authToken: value,
          modelName: 'claude',
          setAsActive: true
        });

        console.log('[LLMKeyStorageService] LLMConfigHandler result:', result);

        if (!result.success) {
          throw new Error('error' in result ? result.error : 'Failed to store API key');
        }

        return {
          success: true,
          data: { stored: true, configHash: result.configHash }
        };
      }

      throw new Error(`Unsupported secure storage key: ${key}`);

    } catch (error) {
      console.error('[LLMKeyStorageService] secureStore error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Retrieve LLM API key from secure storage
   *
   * NOTE: This method requires decryptToken function dependency.
   * The platform adapter should inject the decryptToken function.
   *
   * @param key - Storage key (e.g., 'claude_api_key')
   * @param decryptToken - Function to decrypt the stored token
   */
  async secureRetrieve(
    key: string,
    decryptToken: (encrypted: string) => string
  ): Promise<{ success: boolean; value?: any; error?: string }> {
    console.log(`[LLMKeyStorageService] Secure retrieve: ${key}`);

    try {
      if (key === 'claude_api_key') {
        if (!decryptToken) {
          throw new Error('Decrypt token function not provided');
        }

        const iterator = this.channelManager.objectIteratorWithType('LLM', {
          channelId: 'lama'
        });

        for await (const llmObj of iterator) {
          if (llmObj?.data?.name === 'claude' && llmObj.data.active && !llmObj.data.deleted) {
            const encrypted = (llmObj.data as any).encryptedAuthToken;
            if (encrypted) {
              const apiKey = decryptToken(encrypted);
              return { success: true, value: apiKey };
            }
          }
        }

        throw new Error('API key not found');
      }

      throw new Error(`Unsupported secure storage key: ${key}`);

    } catch (error) {
      console.error('[LLMKeyStorageService] secureRetrieve error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
}
