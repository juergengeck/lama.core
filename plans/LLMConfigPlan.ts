/**
 * LLM Config Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for LLM configuration management.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Pattern based on refinio.api handler architecture.
 */

import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { ensureIdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { generateSystemPromptForModel } from '../constants/system-prompts.js';
import { getModelProvider, modelRequiresApiKey } from '../constants/model-registry.js';

// Re-export types for convenience
export interface TestConnectionRequest {
  server: string; // Ollama server address
  authToken?: string;
  serviceName?: string; // Service name for logging (e.g., 'Ollama', 'LM Studio')
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
  server?: string; // Ollama server address (default: http://localhost:11434)
  authType?: 'none' | 'bearer';
  authToken?: string;
  modelName: string;
  setAsActive: boolean;
  apiKey?: string; // For cloud providers (Claude, OpenAI, etc.)
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
    server: string; // Ollama server address
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
  server?: string; // Ollama server address
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
 * - settings: ONE.core SettingsModel for secure API key storage (uses master key encryption)
 */
export class LLMConfigPlan {
  private nodeOneCore: any;
  private llmManager: any;
  private settings: any; // PropertyTreeStore from ONE.models
  private testOllamaConnection: (server: string, authToken?: string, serviceName?: string) => Promise<TestConnectionResponse>;
  private fetchOllamaModels: (server: string, authToken?: string) => Promise<any[]>;

  constructor(
    nodeOneCore: any,
    aiAssistantModel: any, // Kept for backward compatibility but unused
    llmManager: any,
    settings: any, // PropertyTreeStore from ONE.models
    ollamaValidator: {
      testOllamaConnection: (server: string, authToken?: string, serviceName?: string) => Promise<TestConnectionResponse>;
      fetchOllamaModels: (server: string, authToken?: string) => Promise<any[]>;
    }
  ) {
    this.nodeOneCore = nodeOneCore;
    // Don't store aiAssistantModel - access dynamically from nodeOneCore.aiAssistantModel
    // This allows aiAssistantModel to be initialized after LLMConfigPlan is created
    this.llmManager = llmManager;
    this.settings = settings;
    this.testOllamaConnection = ollamaValidator.testOllamaConnection;
    this.fetchOllamaModels = ollamaValidator.fetchOllamaModels;
  }

  /**
   * Test connection to Ollama-compatible server (Ollama, LM Studio, etc.)
   * Returns server info only - use getAllConfigs() to see stored models
   */
  async testConnection(request: TestConnectionRequest): Promise<TestConnectionResponse> {
    // Default to localhost Ollama if no server specified
    const server = request.server || 'http://localhost:11434';

    try {
      const result = await this.testOllamaConnection(server, request.authToken, request.serviceName);
      return {
        success: result.success,
        version: result.version,
        error: result.error,
        errorCode: result.errorCode,
      };
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
   * Test connection AND discover models from Ollama server
   * Returns list of models available on the Ollama server
   *
   * IMPORTANT: On HTTPS deployments, connection test will fail due to mixed content (HTTP Ollama from HTTPS page)
   */
  async testConnectionAndDiscoverModels(request: TestConnectionRequest): Promise<TestConnectionResponse> {
    // Default to localhost Ollama if no server specified
    const server = request.server || 'http://localhost:11434';

    try {
      // Test connection
      const connectionResult = await this.testOllamaConnection(server, request.authToken, request.serviceName);

      if (!connectionResult.success) {
        console.warn('[LLMConfigPlan] Connection test failed:', connectionResult.error);
        return {
          success: false,
          error: connectionResult.error || 'Connection failed',
          errorCode: connectionResult.errorCode,
        };
      }

      // Fetch models directly from the tested server
      console.log('[LLMConfigPlan] Connection successful, fetching models from:', server);
      const models = await this.fetchOllamaModels(server, request.authToken);

      console.log(`[LLMConfigPlan] Fetched ${models.length} models from ${request.server}`);

      return {
        success: true,
        version: connectionResult.version,
        models: models.map((m: any) => ({
          name: m.name || m.model,
          model: m.name || m.model,
          size: m.size,
          sizeBytes: m.size,
          digest: m.digest,
          modified_at: m.modified_at,
          details: m.details
        })),
      };
    } catch (error: any) {
      console.error('[LLMConfigPlan] Test connection and discover models failed:', error);
      return {
        success: false,
        error: error.message || 'Failed to discover models',
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  /**
   * Save Ollama configuration to ONE.core storage
   */
  async setConfig(request: SetOllamaConfigRequest): Promise<SetOllamaConfigResponse> {
    console.log('[LLMConfigPlan.setConfig] 🟢 START - Saving config');
    console.log('[LLMConfigPlan.setConfig] Request:', {
      modelType: request.modelType,
      server: request.server,
      modelName: request.modelName,
      setAsActive: request.setAsActive,
      hasApiKey: !!request.apiKey,
      hasAuthToken: !!request.authToken
    });
    console.log('[LLMConfigPlan.setConfig] setAsActive =', request.setAsActive);
    console.log('[LLMConfigPlan.setConfig] aiAssistantModel exists?', this.nodeOneCore.aiAssistantModel ? 'YES' : 'NO');

    try {
      // Check if model requires API key (cloud provider)
      const requiresApiKey = modelRequiresApiKey(request.modelName);

      // If API key is provided, treat as cloud model (don't require server)
      const isCloudModel = requiresApiKey || !!request.apiKey;

      // Validation: remote Ollama (not cloud API) requires server
      if (request.modelType === 'remote' && !request.server && !isCloudModel) {
        return {
          success: false,
          error: 'Remote Ollama requires server address',
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

      // Store auth token in settings if provided (ONE.core handles encryption via master key)
      if (request.authToken) {
        try {
          const settingsKey = `llm.${request.modelName}.authToken`;
          await this.settings.setValue(settingsKey, request.authToken);
          console.log(`[LLMConfigPlan] Stored auth token in settings (encrypted by ONE.core): ${settingsKey}`);
        } catch (error: any) {
          return {
            success: false,
            error: `Failed to store auth token: ${error.message}`,
            errorCode: 'STORAGE_ERROR',
          };
        }
      }

      // Store API key in settings if provided (ONE.core handles encryption via master key)
      if (request.apiKey) {
        try {
          const settingsKey = `llm.${request.modelName}.apiKey`;
          await this.settings.setValue(settingsKey, request.apiKey);
          console.log(`[LLMConfigPlan] Stored API key in settings (encrypted by ONE.core): ${settingsKey}`);

          // Initialize LLMManager now that we have an API key
          // This will discover models from the provider (Claude, OpenAI, etc.)
          // Use force=true to re-discover models even if already initialized
          console.log('[LLMConfigPlan] API key stored, re-initializing LLMManager to discover cloud models...');
          await this.llmManager.init(true);
          console.log('[LLMConfigPlan] ✅ LLMManager re-initialized with cloud models');
        } catch (error: any) {
          return {
            success: false,
            error: `Failed to store API key: ${error.message}`,
            errorCode: 'STORAGE_ERROR',
          };
        }
      }

      // Get provider from model registry
      const provider = getModelProvider(request.modelName);

      // Get or create the LLM Person ID
      let llmPersonId: string | undefined;
      if (this.nodeOneCore.aiAssistantModel) {
        const aiManager = this.nodeOneCore.aiAssistantModel.getAIManager();
        // createLLM is idempotent and returns Profile ID
        await aiManager.createLLM(request.modelName, request.modelName, provider);
        // Get the Person ID (now guaranteed to exist in cache)
        const personId = aiManager.getPersonId(`llm:${request.modelName}`);
        if (personId) {
          llmPersonId = String(personId);
          console.log(`[LLMConfigPlan] LLM Person ID for ${request.modelName}:`, llmPersonId.substring(0, 8));
        } else {
          console.error(`[LLMConfigPlan] Failed to get Person ID after createLLM for ${request.modelName}`);
        }
      }

      // Build LLM object
      const now = Date.now();
      const llmObject: any = {
        $type$: 'LLM',
        name: request.modelName,
        server: request.server || 'http://localhost:11434', // Mandatory (isId: true in LLMRecipe) - default to localhost for local models
        filename: request.modelName,
        modelId: request.modelName, // Required field for identification
        modelType: request.modelType,
        provider: provider, // Set provider for cloud API models
        active: request.setAsActive,
        deleted: false,
        created: now,
        modified: now,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        personId: llmPersonId, // Link to LLM Person created by AIManager
        // Auto-generate system prompt for this model
        systemPrompt: generateSystemPromptForModel(request.modelName, request.modelName),
      };

      // Add auth type if provided (tokens/keys stored in settings, not objects)
      if (request.authType) {
        llmObject.authType = request.authType;
      }
      // Note: auth tokens and API keys are stored in settings (not in LLM object)

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

      // If setting as active, set it as the default model in AIAssistantPlan
      // Access aiAssistantModel dynamically from nodeOneCore to avoid initialization order issues
      console.log('[LLMConfigPlan.setConfig] 🔍 Checking if should set as default...');
      console.log('[LLMConfigPlan.setConfig] Condition check: setAsActive=', request.setAsActive, 'aiAssistantModel exists=', !!this.nodeOneCore.aiAssistantModel);
      if (request.setAsActive && this.nodeOneCore.aiAssistantModel) {
        console.log(`[LLMConfigPlan.setConfig] 🚀 Calling aiAssistantModel.setDefaultModel(${request.modelName})...`);
        await this.nodeOneCore.aiAssistantModel.setDefaultModel(request.modelName);
        console.log(`[LLMConfigPlan.setConfig] ✅ setDefaultModel() completed`);
      } else if (request.setAsActive) {
        console.error('[LLMConfigPlan.setConfig] ❌ Cannot set default model - aiAssistantModel not yet initialized');
      } else {
        console.log('[LLMConfigPlan.setConfig] ⏭️ Skipping setDefaultModel (setAsActive=false)');
      }

      console.log('[LLMConfigPlan.setConfig] 🟢 END - Config saved successfully');
      return {
        success: true,
        configHash: hash,
      };
    } catch (error: any) {
      console.error('[LLMConfigPlan.setConfig] ❌ ERROR - Failed to save config:', error);
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

      // Build response (NEVER return decrypted token)
      return {
        success: true,
        config: {
          modelType: config.modelType,
          server: config.server, // Ollama server address
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
  async getAvailableModels(request?: GetAvailableModelsRequest): Promise<GetAvailableModelsResponse> {
    // Handle undefined request - use empty object to fetch from active config
    const req = request || {};
    console.log('[LLMConfigPlan] Get available models:', req);

    try {
      let server: string;
      let authToken: string | undefined;
      let source: 'active_config' | 'specified_url';

      if (req.server) {
        // Use specified server
        server = req.server;
        authToken = req.authToken;
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

        server = configResponse.config.server;
        source = 'active_config';

        // Auth tokens are stored in SettingsModel (encrypted by ONE.core)
        // Load from settings if needed
      }

      // Fetch models
      const models = await this.fetchOllamaModels(server, authToken);

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
      ensureIdHash(request.configHash);
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
      // API keys are now encrypted by ONE.core's SettingsModel
      // No need to check encryption availability

      // Load the LLM object by hash
      // request.llmId is the object hash (configHash) returned from setConfig
      let llmObject: any = null;

      const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
        channelId: 'lama',
      });

      for await (const obj of iterator) {
        if (obj && obj.data) {
          // Match by object hash (stored in obj.hash)
          if (obj.hash === request.llmId) {
            llmObject = obj.data;
            break;
          }
        }
      }

      if (!llmObject) {
        console.error('[LLMConfigPlan] LLM not found with hash:', request.llmId);
        return {
          success: false,
          error: 'LLM configuration not found',
          errorCode: 'NOT_FOUND',
        };
      }

      // Store API key in SettingsModel (encrypted by ONE.core)
      const settingsKey = `llm.${llmObject.modelName}.apiKey`;
      try {
        await this.settings.setValue(settingsKey, request.apiKey);
        console.log(`[LLMConfigPlan] Updated API key in settings: ${settingsKey}`);
      } catch (error: any) {
        return {
          success: false,
          error: `Failed to store API key: ${error.message}`,
          errorCode: 'STORAGE_ERROR',
        };
      }

      // Update modification timestamp
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
