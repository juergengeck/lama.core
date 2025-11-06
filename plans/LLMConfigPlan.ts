/**
 * LLM Config Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for LLM configuration management.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Pattern based on refinio.api handler architecture.
 */

import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { ensureIdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { generateSystemPromptForModel } from '../constants/system-prompts.js';

// Re-export types for convenience
export interface TestConnectionRequest {
  baseUrl: string;
  authToken?: string;
}

export interface TestConnectionResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
  version?: string;
  models?: any[];
}

export interface SetOllamaConfigRequest {
  modelType: 'local' | 'remote';
  baseUrl?: string;
  authType?: 'none' | 'bearer';
  authToken?: string;
  modelName: string;
  setAsActive: boolean;
}

export interface SetOllamaConfigResponse {
  success: boolean;
  configHash?: string;
  error?: string;
  errorCode?: string;
}

export interface GetOllamaConfigRequest {
  includeInactive?: boolean;
}

export interface GetOllamaConfigResponse {
  success: boolean;
  config?: {
    modelType: string;
    baseUrl: string;
    authType: string;
    hasAuthToken: boolean;
    modelName: string;
    isActive: boolean;
    created: number;
    lastUsed: string;
  } | null;
  error?: string;
  errorCode?: string;
}

export interface GetAvailableModelsRequest {
  baseUrl?: string;
  authToken?: string;
}

export interface GetAvailableModelsResponse {
  success: boolean;
  models?: any[];
  source?: 'active_config' | 'specified_url';
  error?: string;
  errorCode?: string;
}

export interface DeleteOllamaConfigRequest {
  configHash: string;
}

export interface DeleteOllamaConfigResponse {
  success: boolean;
  deletedHash?: string;
  error?: string;
  errorCode?: string;
}

/**
 * LLMConfigPlan - Pure business logic for LLM configuration operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - nodeOneCore: Platform-specific ONE.core instance
 * - ollamaValidator: Service for testing Ollama connections
 * - configManager: Service for encryption/decryption
 */
export class LLMConfigPlan {
  private nodeOneCore: any;
  private aiAssistantModel: any;
  private testOllamaConnection: (baseUrl: string, authToken?: string) => Promise<TestConnectionResponse>;
  private fetchOllamaModels: (baseUrl: string, authToken?: string) => Promise<any[]>;
  private encryptToken: (token: string) => string;
  private decryptToken: (encrypted: string) => string;
  private computeBaseUrl: (modelType: string, baseUrl?: string) => string;
  private isEncryptionAvailable: () => boolean;

  constructor(
    nodeOneCore: any,
    aiAssistantModel: any,
    ollamaValidator: {
      testOllamaConnection: (baseUrl: string, authToken?: string) => Promise<TestConnectionResponse>;
      fetchOllamaModels: (baseUrl: string, authToken?: string) => Promise<any[]>;
    },
    configManager: {
      encryptToken: (token: string) => string;
      decryptToken: (encrypted: string) => string;
      computeBaseUrl: (modelType: string, baseUrl?: string) => string;
      isEncryptionAvailable: () => boolean;
    }
  ) {
    this.nodeOneCore = nodeOneCore;
    this.aiAssistantModel = aiAssistantModel;
    this.testOllamaConnection = ollamaValidator.testOllamaConnection;
    this.fetchOllamaModels = ollamaValidator.fetchOllamaModels;
    this.encryptToken = configManager.encryptToken;
    this.decryptToken = configManager.decryptToken;
    this.computeBaseUrl = configManager.computeBaseUrl;
    this.isEncryptionAvailable = configManager.isEncryptionAvailable;
  }

  /**
   * Test connection to Ollama server
   */
  async testConnection(request: TestConnectionRequest): Promise<TestConnectionResponse> {
    console.log('[LLMConfigPlan] Testing connection to:', request.baseUrl);

    try {
      const result = await this.testOllamaConnection(request.baseUrl, request.authToken);
      return result;
    } catch (error: any) {
      console.error('[LLMConfigPlan] Test connection error:', error);
      return {
        success: false,
        error: error.message || 'Connection test failed',
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  /**
   * Save Ollama configuration to ONE.core storage
   */
  async setConfig(request: SetOllamaConfigRequest): Promise<SetOllamaConfigResponse> {
    console.log('[LLMConfigPlan] Saving config:', {
      modelType: request.modelType,
      baseUrl: request.baseUrl,
      modelName: request.modelName,
    });

    try {
      // Validation: remote type requires baseUrl
      if (request.modelType === 'remote' && !request.baseUrl) {
        return {
          success: false,
          error: 'Remote Ollama requires baseUrl',
          errorCode: 'VALIDATION_FAILED',
        };
      }

      // Validation: bearer auth requires token
      if (request.authType === 'bearer' && !request.authToken) {
        return {
          success: false,
          error: 'Bearer authentication requires authToken',
          errorCode: 'VALIDATION_FAILED',
        };
      }

      // Validate model name is not empty
      if (!request.modelName || request.modelName.trim() === '') {
        return {
          success: false,
          error: 'Model name is required',
          errorCode: 'VALIDATION_FAILED',
        };
      }

      // Check encryption availability if auth token provided
      if (request.authToken && !this.isEncryptionAvailable()) {
        return {
          success: false,
          error: 'Token encryption not available on this system',
          errorCode: 'ENCRYPTION_ERROR',
        };
      }

      // Encrypt auth token if provided
      let encryptedAuthToken: string | undefined;
      if (request.authToken) {
        try {
          encryptedAuthToken = this.encryptToken(request.authToken);
        } catch (error: any) {
          return {
            success: false,
            error: `Token encryption failed: ${error.message}`,
            errorCode: 'ENCRYPTION_ERROR',
          };
        }
      }

      // Build LLM object
      const now = Date.now();
      const llmObject: any = {
        $type$: 'LLM',
        name: request.modelName,
        filename: request.modelName,
        modelType: request.modelType,
        active: request.setAsActive,
        deleted: false,
        created: now,
        modified: now,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        // Auto-generate system prompt for this model
        systemPrompt: generateSystemPromptForModel(request.modelName, request.modelName),
      };

      // Add network fields if provided
      if (request.baseUrl) {
        llmObject.baseUrl = request.baseUrl;
      }
      if (request.authType) {
        llmObject.authType = request.authType;
      }
      if (encryptedAuthToken) {
        llmObject.encryptedAuthToken = encryptedAuthToken;
      }

      // Store in ONE.core
      if (!this.nodeOneCore || !this.nodeOneCore.channelManager) {
        return {
          success: false,
          error: 'ONE.core not initialized',
          errorCode: 'STORAGE_ERROR',
        };
      }

      const result = await storeVersionedObject(llmObject);
      const hash = typeof result === 'string' ? result : result.idHash;
      console.log('[LLMConfigPlan] Stored LLM config with hash:', hash);

      // Post to channel so it can be retrieved later
      await this.nodeOneCore.channelManager.postToChannel('lama', llmObject);
      console.log('[LLMConfigPlan] Posted LLM config to lama channel');

      // If setting as active, set it as the default model in AIAssistantModel
      if (request.setAsActive && this.aiAssistantModel) {
        console.log(`[LLMConfigPlan] Setting ${request.modelName} as default model`);
        await this.aiAssistantModel.setDefaultModel(request.modelName);
        console.log(`[LLMConfigPlan] Successfully set ${request.modelName} as default model`);
        // TODO: Implement deactivation of other configs
        // This would require iterating through existing LLM objects and setting active=false
      }

      return {
        success: true,
        configHash: hash,
      };
    } catch (error: any) {
      console.error('[LLMConfigPlan] Set config error:', error);
      return {
        success: false,
        error: error.message || 'Failed to save configuration',
        errorCode: 'STORAGE_ERROR',
      };
    }
  }

  /**
   * Retrieve current active Ollama configuration
   */
  async getConfig(request: GetOllamaConfigRequest): Promise<GetOllamaConfigResponse> {
    console.log('[LLMConfigPlan] Retrieving config, includeInactive:', request.includeInactive);

    try {
      if (!this.nodeOneCore || !this.nodeOneCore.channelManager) {
        return {
          success: false,
          error: 'ONE.core not initialized',
          errorCode: 'STORAGE_ERROR',
        };
      }

      // Query LLM objects from storage
      const llmObjects: any[] = [];
      try {
        const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
          channelId: 'lama',
        });

        for await (const llmObj of iterator) {
          if (llmObj && llmObj.data) {
            llmObjects.push(llmObj.data);
          }
        }
      } catch (iterError: any) {
        console.log('[LLMConfigPlan] No LLM objects found:', iterError.message);
      }

      // Filter for active config (or all if includeInactive)
      const filtered = request.includeInactive
        ? llmObjects.filter((obj) => !obj.deleted)
        : llmObjects.filter((obj) => obj.active && !obj.deleted);

      if (filtered.length === 0) {
        return {
          success: true,
          config: null,
        };
      }

      // Return the first active config (or most recent if multiple)
      const config = filtered.sort((a, b) => b.modified - a.modified)[0];

      // Compute effective baseUrl
      const baseUrl = this.computeBaseUrl(config.modelType, config.baseUrl);

      // Build response (NEVER return decrypted token)
      return {
        success: true,
        config: {
          modelType: config.modelType,
          baseUrl,
          authType: config.authType || 'none',
          hasAuthToken: !!config.encryptedAuthToken,
          modelName: config.name,
          isActive: config.active,
          created: config.created,
          lastUsed: config.lastUsed,
        },
      };
    } catch (error: any) {
      console.error('[LLMConfigPlan] Get config error:', error);
      return {
        success: false,
        error: error.message || 'Failed to retrieve configuration',
        errorCode: 'STORAGE_ERROR',
      };
    }
  }

  /**
   * Fetch models from Ollama server (active config or specified URL)
   */
  async getAvailableModels(request: GetAvailableModelsRequest): Promise<GetAvailableModelsResponse> {
    console.log('[LLMConfigPlan] Get available models:', request);

    try {
      let baseUrl: string;
      let authToken: string | undefined;
      let source: 'active_config' | 'specified_url';

      if (request.baseUrl) {
        // Use specified URL
        baseUrl = request.baseUrl;
        authToken = request.authToken;
        source = 'specified_url';
      } else {
        // Use active config
        const configResponse = await this.getConfig({});

        if (!configResponse.success || !configResponse.config) {
          return {
            success: false,
            error: 'No active Ollama configuration found',
            errorCode: 'NO_CONFIG',
          };
        }

        baseUrl = configResponse.config.baseUrl;
        source = 'active_config';

        // Decrypt auth token if present
        if (configResponse.config.hasAuthToken) {
          // Need to load the actual object to get encrypted token
          const llmObjects: any[] = [];
          const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
            channelId: 'lama',
          });

          for await (const llmObj of iterator) {
            if (llmObj && llmObj.data && llmObj.data.active && !llmObj.data.deleted) {
              llmObjects.push(llmObj.data);
              break;
            }
          }

          if (llmObjects[0]?.encryptedAuthToken) {
            try {
              authToken = this.decryptToken(llmObjects[0].encryptedAuthToken);
            } catch (error: any) {
              console.error('[LLMConfigPlan] Token decryption failed:', error);
            }
          }
        }
      }

      // Fetch models
      const models = await this.fetchOllamaModels(baseUrl, authToken);

      return {
        success: true,
        models,
        source,
      };
    } catch (error: any) {
      console.error('[LLMConfigPlan] Get available models error:', error);

      // Determine error code based on error message
      let errorCode: any = 'NETWORK_ERROR';
      if (error.message.includes('Authentication')) {
        errorCode = 'AUTH_FAILED';
      } else if (error.message.includes('no models')) {
        errorCode = 'NO_MODELS';
      }

      return {
        success: false,
        error: error.message || 'Failed to fetch models',
        errorCode,
      };
    }
  }

  /**
   * Soft-delete an Ollama configuration
   */
  async deleteConfig(request: DeleteOllamaConfigRequest): Promise<DeleteOllamaConfigResponse> {
    console.log('[LLMConfigPlan] Deleting config:', request.configHash);

    try {
      if (!this.nodeOneCore) {
        return {
          success: false,
          error: 'ONE.core not initialized',
          errorCode: 'STORAGE_ERROR',
        };
      }

      // Load the config object by iterating through LLM objects
      const hash = ensureIdHash(request.configHash);
      let llmObject: any = null;

      try {
        const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
          channelId: 'lama',
        });

        for await (const obj of iterator) {
          if (obj && obj.data) {
            llmObject = obj.data;
            break; // Just take the first one for now
          }
        }

        if (!llmObject) {
          return {
            success: false,
            error: 'Configuration not found',
            errorCode: 'NOT_FOUND',
          };
        }
      } catch (error: any) {
        return {
          success: false,
          error: 'Configuration not found',
          errorCode: 'NOT_FOUND',
        };
      }

      // Soft delete: set deleted flag
      llmObject.deleted = true;
      llmObject.active = false; // Also deactivate
      llmObject.modified = Date.now();

      // Update in storage
      await storeVersionedObject(llmObject);

      console.log('[LLMConfigPlan] Deleted config:', request.configHash);

      return {
        success: true,
        deletedHash: request.configHash,
      };
    } catch (error: any) {
      console.error('[LLMConfigPlan] Delete config error:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete configuration',
        errorCode: 'STORAGE_ERROR',
      };
    }
  }

  /**
   * Get all LLM configurations
   */
  async getAllConfigs(): Promise<any[]> {
    console.log('[LLMConfigPlan] Getting all LLM configs');

    try {
      if (!this.nodeOneCore) {
        console.warn('[LLMConfigPlan] ONE.core not initialized');
        return [];
      }

      const llmObjects: any[] = [];
      const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
        channelId: 'lama',
      });

      for await (const obj of iterator) {
        if (obj && obj.data && !obj.data.deleted) {
          llmObjects.push(obj.data);
        }
      }

      console.log(`[LLMConfigPlan] Found ${llmObjects.length} LLM configurations`);
      return llmObjects;
    } catch (error: any) {
      console.error('[LLMConfigPlan] Get all configs error:', error);
      return [];
    }
  }

  /**
   * Update system prompt for an LLM
   */
  async updateSystemPrompt(request: {
    llmId: string;
    systemPrompt: string;
  }): Promise<{
    success: boolean;
    error?: string;
    errorCode?: string;
  }> {
    console.log('[LLMConfigPlan] Updating system prompt for LLM:', request.llmId);

    try {
      if (!this.nodeOneCore) {
        return {
          success: false,
          error: 'ONE.core not initialized',
          errorCode: 'STORAGE_ERROR',
        };
      }

      // Load the LLM object
      const llmIdHash = ensureIdHash(request.llmId);
      let llmObject: any = null;

      const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
        channelId: 'lama',
      });

      for await (const obj of iterator) {
        if (obj && obj.data && obj.data.id === llmIdHash) {
          llmObject = obj.data;
          break;
        }
      }

      if (!llmObject) {
        return {
          success: false,
          error: 'LLM configuration not found',
          errorCode: 'NOT_FOUND',
        };
      }

      // Update the system prompt
      llmObject.systemPrompt = request.systemPrompt;
      llmObject.modified = Date.now();

      // Store updated object
      await storeVersionedObject(llmObject);
      await this.nodeOneCore.channelManager.postToChannel('lama', llmObject);

      console.log('[LLMConfigPlan] System prompt updated successfully');

      return {
        success: true,
      };
    } catch (error: any) {
      console.error('[LLMConfigPlan] Update system prompt error:', error);
      return {
        success: false,
        error: error.message || 'Failed to update system prompt',
        errorCode: 'STORAGE_ERROR',
      };
    }
  }

  /**
   * Regenerate system prompt for an LLM using the default template
   */
  async regenerateSystemPrompt(request: { llmId: string }): Promise<{
    success: boolean;
    systemPrompt?: string;
    error?: string;
    errorCode?: string;
  }> {
    console.log('[LLMConfigPlan] Regenerating system prompt for LLM:', request.llmId);

    try {
      if (!this.nodeOneCore) {
        return {
          success: false,
          error: 'ONE.core not initialized',
          errorCode: 'STORAGE_ERROR',
        };
      }

      // Load the LLM object
      const llmIdHash = ensureIdHash(request.llmId);
      let llmObject: any = null;

      const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
        channelId: 'lama',
      });

      for await (const obj of iterator) {
        if (obj && obj.data && obj.data.id === llmIdHash) {
          llmObject = obj.data;
          break;
        }
      }

      if (!llmObject) {
        return {
          success: false,
          error: 'LLM configuration not found',
          errorCode: 'NOT_FOUND',
        };
      }

      // Generate fresh system prompt using the same logic as new LLM creation
      const newSystemPrompt = generateSystemPromptForModel(
        llmObject.modelId,
        llmObject.modelName || llmObject.modelId
      );

      // Update the LLM object
      llmObject.systemPrompt = newSystemPrompt;
      llmObject.modified = Date.now();

      // Store updated object
      await storeVersionedObject(llmObject);
      await this.nodeOneCore.channelManager.postToChannel('lama', llmObject);

      console.log('[LLMConfigPlan] System prompt regenerated successfully');

      return {
        success: true,
        systemPrompt: newSystemPrompt,
      };
    } catch (error: any) {
      console.error('[LLMConfigPlan] Regenerate system prompt error:', error);
      return {
        success: false,
        error: error.message || 'Failed to regenerate system prompt',
        errorCode: 'STORAGE_ERROR',
      };
    }
  }

  /**
   * Update API key for an LLM
   */
  async updateApiKey(request: {
    llmId: string;
    apiKey: string;
  }): Promise<{
    success: boolean;
    error?: string;
    errorCode?: string;
  }> {
    console.log('[LLMConfigPlan] Updating API key for LLM:', request.llmId);

    try {
      if (!this.nodeOneCore) {
        return {
          success: false,
          error: 'ONE.core not initialized',
          errorCode: 'STORAGE_ERROR',
        };
      }

      // Check encryption availability
      if (!this.isEncryptionAvailable()) {
        return {
          success: false,
          error: 'API key encryption not available on this system',
          errorCode: 'ENCRYPTION_ERROR',
        };
      }

      // Load the LLM object
      const llmIdHash = ensureIdHash(request.llmId);
      let llmObject: any = null;

      const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
        channelId: 'lama',
      });

      for await (const obj of iterator) {
        if (obj && obj.data && obj.data.id === llmIdHash) {
          llmObject = obj.data;
          break;
        }
      }

      if (!llmObject) {
        return {
          success: false,
          error: 'LLM configuration not found',
          errorCode: 'NOT_FOUND',
        };
      }

      // Encrypt API key
      let encryptedApiKey: string;
      try {
        encryptedApiKey = this.encryptToken(request.apiKey);
      } catch (error: any) {
        return {
          success: false,
          error: `API key encryption failed: ${error.message}`,
          errorCode: 'ENCRYPTION_ERROR',
        };
      }

      // Update the API key
      llmObject.encryptedApiKey = encryptedApiKey;
      llmObject.modified = Date.now();

      // Store updated object
      await storeVersionedObject(llmObject);
      await this.nodeOneCore.channelManager.postToChannel('lama', llmObject);

      console.log('[LLMConfigPlan] API key updated successfully');

      return {
        success: true,
      };
    } catch (error: any) {
      console.error('[LLMConfigPlan] Update API key error:', error);
      return {
        success: false,
        error: error.message || 'Failed to update API key',
        errorCode: 'STORAGE_ERROR',
      };
    }
  }
}
