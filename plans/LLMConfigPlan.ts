/**
 * LLM Config Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for LLM configuration management.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Pattern based on refinio.api handler architecture.
 */

import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { storeUnversionedObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { ensureIdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';
import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { HashGroup, Person } from '@refinio/one.core/lib/recipes.js';
import { generateSystemPromptForModel } from '../constants/system-prompts.js';
import type { LLMRegistry } from '../services/llm-registry.js';
import type { GlobalLLMSettingsManager } from '../models/settings/GlobalLLMSettingsManager.js';

const MessageBus = createMessageBus('LLMConfigPlan');
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
  inferenceType?: 'ondevice' | 'server' | 'cloud'; // Where inference runs: ondevice (ONNX), server (Ollama), cloud (API)
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
    inferenceType?: 'ondevice' | 'server' | 'cloud'; // Where inference runs
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
  private llmRegistry?: LLMRegistry;
  private globalSettingsManager?: GlobalLLMSettingsManager;

  constructor(
    nodeOneCore: any,
    aiAssistantModel: any, // Kept for backward compatibility but unused
    llmManager: any,
    settings: any, // PropertyTreeStore from ONE.models
    ollamaValidator: {
      testOllamaConnection: (server: string, authToken?: string, serviceName?: string) => Promise<TestConnectionResponse>;
      fetchOllamaModels: (server: string, authToken?: string) => Promise<any[]>;
    },
    llmRegistry?: LLMRegistry,
    globalSettingsManager?: GlobalLLMSettingsManager
  ) {
    this.nodeOneCore = nodeOneCore;
    // Don't store aiAssistantModel - access dynamically from nodeOneCore.aiAssistantModel
    // This allows aiAssistantModel to be initialized after LLMConfigPlan is created
    this.llmManager = llmManager;
    this.settings = settings;
    this.testOllamaConnection = ollamaValidator.testOllamaConnection;
    this.fetchOllamaModels = ollamaValidator.fetchOllamaModels;
    this.llmRegistry = llmRegistry;
    this.globalSettingsManager = globalSettingsManager;
  }

  /**
   * Get the participantsHash for the application data channel
   * The 'lama' channel is now identified by participants (owner's personId)
   */
  private async getAppChannelParticipants(): Promise<SHA256Hash<HashGroup<Person>>> {
    const myId = await this.nodeOneCore.leuteModel.myMainIdentity();
    const hashGroup: HashGroup<Person> = {
      $type$: 'HashGroup',
      person: new Set([myId])
    };
    const result = await storeUnversionedObject(hashGroup);
    return result.hash;
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
      MessageBus.send('error', '[LLMConfigPlan] Test connection error:', error);
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
        MessageBus.send('alert', '[LLMConfigPlan] Connection test failed:', connectionResult.error);
        return {
          success: false,
          error: connectionResult.error || 'Connection failed',
          errorCode: connectionResult.errorCode,
        };
      }

      // Fetch models directly from the tested server
      MessageBus.send('debug', '[LLMConfigPlan] Connection successful, fetching models from:', server);
      const models = await this.fetchOllamaModels(server, request.authToken);

      MessageBus.send('debug', `[LLMConfigPlan] Fetched ${models.length} models from ${request.server}`);

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
      MessageBus.send('error', '[LLMConfigPlan] Test connection and discover models failed:', error);
      return {
        success: false,
        error: error.message || 'Failed to discover models',
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  /**
   * Configure an LLM model as active
   *
   * NEW PATTERN (registry-based):
   * - Models are discovered dynamically (Ollama, Claude, local)
   * - This method stores credentials and sets the active model
   * - No more storing LLM objects to channels
   */
  async setConfig(request: SetOllamaConfigRequest): Promise<SetOllamaConfigResponse> {
    MessageBus.send('debug', '[LLMConfigPlan.setConfig] 🟢 START - Configuring model');
    MessageBus.send('debug', '[LLMConfigPlan.setConfig] Request:', {
      modelType: request.modelType,
      server: request.server,
      modelName: request.modelName,
      setAsActive: request.setAsActive,
      hasApiKey: !!request.apiKey,
      hasAuthToken: !!request.authToken
    });

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
          MessageBus.send('debug', `[LLMConfigPlan] Stored auth token in settings (encrypted by ONE.core): ${settingsKey}`);
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
          MessageBus.send('debug', `[LLMConfigPlan] Stored API key in settings (encrypted by ONE.core): ${settingsKey}`);

          // Initialize LLMManager now that we have an API key
          // This will discover models from the provider (Claude, OpenAI, etc.)
          // Use force=true to re-discover models even if already initialized
          MessageBus.send('debug', '[LLMConfigPlan] API key stored, re-initializing LLMManager to discover cloud models...');
          await this.llmManager.init(true);
          MessageBus.send('debug', '[LLMConfigPlan] ✅ LLMManager re-initialized with cloud models');
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

      // Create LLM identity (Person) for this model if aiAssistantModel is available
      if (this.nodeOneCore.aiAssistantModel) {
        const aiManager = this.nodeOneCore.aiAssistantModel.getAIManager();
        // createLLM is idempotent and returns Profile ID
        await aiManager.createLLM(request.modelName, request.modelName, provider);
        MessageBus.send('debug', `[LLMConfigPlan] Created/verified LLM identity for ${request.modelName}`);
      }

      // Set as active model using GlobalLLMSettingsManager (new pattern)
      if (request.setAsActive) {
        if (this.globalSettingsManager) {
          await this.globalSettingsManager.setDefaultModelId(request.modelName);
          MessageBus.send('debug', `[LLMConfigPlan] Set ${request.modelName} as default via GlobalLLMSettingsManager`);
        }

        // Also update AIAssistantModel for backward compatibility
        if (this.nodeOneCore.aiAssistantModel) {
          await this.nodeOneCore.aiAssistantModel.setDefaultModel(request.modelName);
          MessageBus.send('debug', `[LLMConfigPlan] Set ${request.modelName} as default via aiAssistantModel`);
        }
      }

      // Register model in LLMRegistry if available
      if (this.llmRegistry) {
        // Determine inference type
        let inferenceType: 'ondevice' | 'server' | 'cloud' = 'server';
        if (request.inferenceType) {
          inferenceType = request.inferenceType;
        } else if (isCloudModel) {
          inferenceType = 'cloud';
        } else if (provider === 'local' || provider === 'transformers') {
          inferenceType = 'ondevice';
        } else if (provider === 'ollama' || provider === 'lmstudio') {
          inferenceType = 'server';
        }

        const now = Date.now();
        const nowStr = new Date().toISOString();

        const llmObject: any = {
          $type$: 'LLM',
          name: request.modelName,
          server: request.server || (inferenceType === 'ondevice' ? 'local' : 'http://localhost:11434'),
          filename: request.modelName,
          modelId: request.modelName,
          modelType: request.modelType,
          inferenceType: inferenceType,
          provider: provider,
          active: request.setAsActive,
          deleted: false,
          created: now,
          modified: now,
          createdAt: nowStr,
          lastUsed: nowStr,
          systemPrompt: generateSystemPromptForModel(request.modelName, request.modelName),
          capabilities: ['chat', 'completion'],
          maxTokens: 4096
        };

        // Determine source for registry
        let source: 'ollama' | 'lmstudio' | 'anthropic' | 'openai' | 'local' | 'manual' = 'manual';
        if (provider === 'ollama') source = 'ollama';
        else if (provider === 'lmstudio') source = 'lmstudio';
        else if (provider === 'anthropic' || provider === 'claude') source = 'anthropic';
        else if (provider === 'openai') source = 'openai';
        else if (provider === 'local' || provider === 'transformers') source = 'local';

        this.llmRegistry.register(llmObject, source);
        MessageBus.send('debug', `[LLMConfigPlan] Registered ${request.modelName} in LLMRegistry (source: ${source})`);
      } else {
        // LEGACY FALLBACK: Store to channel if registry not available
        MessageBus.send('debug', '[LLMConfigPlan] No registry - using legacy channel storage');
        await this.legacyStoreToChannel(request, provider, isCloudModel);
      }

      MessageBus.send('debug', '[LLMConfigPlan.setConfig] 🟢 END - Config saved successfully');
      return {
        success: true,
        configHash: request.modelName, // Return modelId as the "hash" in new pattern
      };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan.setConfig] ❌ ERROR - Failed to save config:', error);
      return {
        success: false,
        error: error.message || 'Failed to save configuration',
        errorCode: 'STORAGE_ERROR',
      };
    }
  }

  /**
   * Legacy storage to channel (for backward compatibility)
   * @deprecated Will be removed once all consumers use registry
   */
  private async legacyStoreToChannel(
    request: SetOllamaConfigRequest,
    provider: string,
    isCloudModel: boolean
  ): Promise<void> {
    // Determine inference type
    let inferenceType: 'ondevice' | 'server' | 'cloud' = 'server';
    if (request.inferenceType) {
      inferenceType = request.inferenceType;
    } else if (isCloudModel) {
      inferenceType = 'cloud';
    } else if (provider === 'local' || provider === 'transformers') {
      inferenceType = 'ondevice';
    } else if (provider === 'ollama' || provider === 'lmstudio') {
      inferenceType = 'server';
    }

    const now = Date.now();
    const llmObject: any = {
      $type$: 'LLM',
      name: request.modelName,
      server: request.server || (inferenceType === 'ondevice' ? 'local' : 'http://localhost:11434'),
      filename: request.modelName,
      modelId: request.modelName,
      modelType: request.modelType,
      inferenceType: inferenceType,
      provider: provider,
      active: request.setAsActive,
      deleted: false,
      created: now,
      modified: now,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      systemPrompt: generateSystemPromptForModel(request.modelName, request.modelName),
    };

    if (request.authType) {
      llmObject.authType = request.authType;
    }

    await storeVersionedObject(llmObject);
    const participantsHash = await this.getAppChannelParticipants();
    await this.nodeOneCore.channelManager.postToChannel(participantsHash, llmObject);
    MessageBus.send('debug', '[LLMConfigPlan] Legacy: Posted LLM config to channel');
  }

  /**
   * Retrieve current active LLM configuration
   *
   * NEW PATTERN (registry-based):
   * - Get default model ID from GlobalLLMSettingsManager
   * - Look up model details from LLMRegistry
   * - Fall back to legacy channel storage if registry not available
   */
  async getConfig(request: GetOllamaConfigRequest): Promise<GetOllamaConfigResponse> {
    MessageBus.send('debug', '[LLMConfigPlan] Retrieving config, includeInactive:', request.includeInactive);

    try {
      // NEW PATTERN: Use registry + GlobalLLMSettings
      if (this.llmRegistry && this.globalSettingsManager) {
        const defaultModelId = await this.globalSettingsManager.getDefaultModelId();
        MessageBus.send('debug', `[LLMConfigPlan] Default model from settings: ${defaultModelId}`);

        if (request.includeInactive) {
          // Return all models from registry
          const allModels = this.llmRegistry.getAll();
          if (allModels.length === 0) {
            return { success: true, config: null };
          }
          // Return first model (or could return array in future)
          const model = allModels[0];
          return {
            success: true,
            config: this.llmToConfigResponse(model, model.modelId === defaultModelId),
          };
        }

        // Return active model only
        if (!defaultModelId) {
          return { success: true, config: null };
        }

        const model = this.llmRegistry.get(defaultModelId);
        if (!model) {
          MessageBus.send('debug', `[LLMConfigPlan] Model ${defaultModelId} not in registry`);
          return { success: true, config: null };
        }

        return {
          success: true,
          config: this.llmToConfigResponse(model, true),
        };
      }

      // LEGACY FALLBACK: Use channel storage
      return await this.legacyGetConfig(request);
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Get config error:', error);
      return {
        success: false,
        error: error.message || 'Failed to retrieve configuration',
        errorCode: 'STORAGE_ERROR',
      };
    }
  }

  /**
   * Convert LLM object to config response format
   */
  private llmToConfigResponse(llm: any, isActive: boolean): GetOllamaConfigResponse['config'] {
    return {
      modelType: llm.modelType || (llm.inferenceType === 'ondevice' ? 'local' : 'remote'),
      server: llm.server || '',
      inferenceType: llm.inferenceType,
      authType: llm.authType || 'none',
      hasAuthToken: false, // Tokens stored in settings, not LLM object
      modelName: llm.name || llm.modelId,
      isActive: isActive,
      created: llm.created || Date.now(),
      lastUsed: llm.lastUsed || new Date().toISOString(),
    };
  }

  /**
   * Legacy getConfig using channel storage
   * @deprecated Will be removed once all consumers use registry
   */
  private async legacyGetConfig(request: GetOllamaConfigRequest): Promise<GetOllamaConfigResponse> {
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
      const participantsHash = await this.getAppChannelParticipants();
      const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
        participants: participantsHash,
      });

      for await (const llmObj of iterator) {
        if (llmObj && llmObj.data) {
          llmObjects.push(llmObj.data);
        }
      }
    } catch (iterError: any) {
      MessageBus.send('debug', '[LLMConfigPlan] No LLM objects found:', iterError.message);
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

    return {
      success: true,
      config: {
        modelType: config.modelType,
        server: config.server,
        inferenceType: config.inferenceType,
        authType: config.authType || 'none',
        hasAuthToken: !!config.encryptedAuthToken,
        modelName: config.name,
        isActive: config.active,
        created: config.created,
        lastUsed: config.lastUsed,
      },
    };
  }

  /**
   * Fetch models from Ollama server (active config or specified URL)
   */
  async getAvailableModels(request?: GetAvailableModelsRequest): Promise<GetAvailableModelsResponse> {
    // Handle undefined request - use empty object to fetch from active config
    const req = request || {};
    MessageBus.send('debug', '[LLMConfigPlan] Get available models:', req);

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

        // Skip Ollama fetch for on-device (transformers.js) and cloud models
        const inferenceType = configResponse.config.inferenceType;
        if (inferenceType === 'ondevice' || inferenceType === 'cloud') {
          MessageBus.send('debug', `[LLMConfigPlan] Skipping Ollama fetch for ${inferenceType} model`);
          return {
            success: true,
            models: [],
            source: 'active_config',
          };
        }

        // Also skip if server is 'local' (on-device marker)
        if (configResponse.config.server === 'local') {
          MessageBus.send('debug', '[LLMConfigPlan] Skipping Ollama fetch for local (on-device) model');
          return {
            success: true,
            models: [],
            source: 'active_config',
          };
        }

        server = configResponse.config.server;
        source = 'active_config';

        // Auth tokens are stored in SettingsModel (encrypted by ONE.core)
        // Load from settings if needed
      }

      // Fetch models from Ollama server
      const models = await this.fetchOllamaModels(server, authToken);

      return {
        success: true,
        models,
        source,
      };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Get available models error:', error);

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
    MessageBus.send('debug', '[LLMConfigPlan] Deleting config:', request.configHash);

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
        const participantsHash = await this.getAppChannelParticipants();
        const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
          participants: participantsHash,
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

      MessageBus.send('debug', '[LLMConfigPlan] Deleted config:', request.configHash);

      return {
        success: true,
        deletedHash: request.configHash,
      };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Delete config error:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete configuration',
        errorCode: 'STORAGE_ERROR',
      };
    }
  }

  /**
   * Get all LLM configurations
   *
   * NEW PATTERN: Returns models from registry
   * LEGACY FALLBACK: Returns from channel storage if registry not available
   */
  async getAllConfigs(): Promise<any[]> {
    MessageBus.send('debug', '[LLMConfigPlan] Getting all LLM configs');

    try {
      // NEW PATTERN: Use registry
      if (this.llmRegistry) {
        const allModels = this.llmRegistry.getAll();
        MessageBus.send('debug', `[LLMConfigPlan] Found ${allModels.length} LLM configs in registry`);
        return allModels;
      }

      // LEGACY FALLBACK: Use channel storage
      if (!this.nodeOneCore) {
        MessageBus.send('alert', '[LLMConfigPlan] ONE.core not initialized');
        return [];
      }

      const llmObjects: any[] = [];
      const participantsHash = await this.getAppChannelParticipants();
      const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
        participants: participantsHash,
      });

      for await (const obj of iterator) {
        if (obj && obj.data && !obj.data.deleted) {
          llmObjects.push(obj.data);
        }
      }

      MessageBus.send('debug', `[LLMConfigPlan] Found ${llmObjects.length} LLM configs in storage`);
      return llmObjects;
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Get all configs error:', error);
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
    MessageBus.send('debug', '[LLMConfigPlan] Updating system prompt for LLM:', request.llmId);

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

      const participantsHash = await this.getAppChannelParticipants();
      const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
        participants: participantsHash,
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
      await this.nodeOneCore.channelManager.postToChannel(participantsHash, llmObject);

      MessageBus.send('debug', '[LLMConfigPlan] System prompt updated successfully');

      return {
        success: true,
      };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Update system prompt error:', error);
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
    MessageBus.send('debug', '[LLMConfigPlan] Regenerating system prompt for LLM:', request.llmId);

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

      const participantsHash = await this.getAppChannelParticipants();
      const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
        participants: participantsHash,
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
      await this.nodeOneCore.channelManager.postToChannel(participantsHash, llmObject);

      MessageBus.send('debug', '[LLMConfigPlan] System prompt regenerated successfully');

      return {
        success: true,
        systemPrompt: newSystemPrompt,
      };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Regenerate system prompt error:', error);
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
    MessageBus.send('debug', '[LLMConfigPlan] Updating API key for LLM:', request.llmId);

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

      const participantsHash = await this.getAppChannelParticipants();
      const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
        participants: participantsHash,
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
        MessageBus.send('error', '[LLMConfigPlan] LLM not found with hash:', request.llmId);
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
        MessageBus.send('debug', `[LLMConfigPlan] Updated API key in settings: ${settingsKey}`);
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
      await this.nodeOneCore.channelManager.postToChannel(participantsHash, llmObject);

      MessageBus.send('debug', '[LLMConfigPlan] API key updated successfully');

      return {
        success: true,
      };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Update API key error:', error);
      return {
        success: false,
        error: error.message || 'Failed to update API key',
        errorCode: 'STORAGE_ERROR',
      };
    }
  }

  // ========== Ollama Server Management ==========

  /**
   * Get all configured Ollama servers
   */
  async getOllamaServers(): Promise<{
    success: boolean;
    servers: Array<{
      id: string;
      name: string;
      baseUrl: string;
      authType?: 'none' | 'bearer';
      enabled: boolean;
    }>;
    error?: string;
  }> {
    try {
      if (!this.globalSettingsManager) {
        return { success: false, servers: [], error: 'GlobalSettingsManager not initialized' };
      }
      const servers = await this.globalSettingsManager.getOllamaServers();
      return { success: true, servers };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Get Ollama servers error:', error);
      return { success: false, servers: [], error: error.message };
    }
  }

  /**
   * Add a new Ollama server
   */
  async addOllamaServer(params: {
    name: string;
    baseUrl: string;
    authType?: 'none' | 'bearer';
    bearerToken?: string;
    enabled?: boolean;
  }): Promise<{
    success: boolean;
    server?: {
      id: string;
      name: string;
      baseUrl: string;
      authType?: 'none' | 'bearer';
      enabled: boolean;
    };
    error?: string;
  }> {
    try {
      if (!this.globalSettingsManager) {
        return { success: false, error: 'GlobalSettingsManager not initialized' };
      }

      const server = await this.globalSettingsManager.addOllamaServer({
        name: params.name,
        baseUrl: params.baseUrl,
        authType: params.authType || 'none',
        enabled: params.enabled ?? true
      });

      // Store bearer token in settings if provided
      if (params.bearerToken && params.authType === 'bearer') {
        const settingsKey = `ollama.${server.id}.bearerToken`;
        await this.settings.setValue(settingsKey, params.bearerToken);
      }

      MessageBus.send('debug', `[LLMConfigPlan] Added Ollama server: ${server.name}`);
      return { success: true, server };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Add Ollama server error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update an existing Ollama server
   */
  async updateOllamaServer(params: {
    id: string;
    updates: {
      name?: string;
      baseUrl?: string;
      authType?: 'none' | 'bearer';
      bearerToken?: string;
      enabled?: boolean;
    };
  }): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      if (!this.globalSettingsManager) {
        return { success: false, error: 'GlobalSettingsManager not initialized' };
      }

      const { bearerToken, ...serverUpdates } = params.updates;
      const result = await this.globalSettingsManager.updateOllamaServer(params.id, serverUpdates);

      if (!result) {
        return { success: false, error: 'Server not found' };
      }

      // Update bearer token if provided
      if (bearerToken !== undefined) {
        const settingsKey = `ollama.${params.id}.bearerToken`;
        if (bearerToken) {
          await this.settings.setValue(settingsKey, bearerToken);
        } else {
          await this.settings.deleteValue(settingsKey);
        }
      }

      MessageBus.send('debug', `[LLMConfigPlan] Updated Ollama server: ${params.id}`);
      return { success: true };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Update Ollama server error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove an Ollama server
   */
  async removeOllamaServer(params: { id: string }): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      if (!this.globalSettingsManager) {
        return { success: false, error: 'GlobalSettingsManager not initialized' };
      }

      const removed = await this.globalSettingsManager.removeOllamaServer(params.id);
      if (!removed) {
        return { success: false, error: 'Server not found' };
      }

      // Clean up bearer token if stored
      const settingsKey = `ollama.${params.id}.bearerToken`;
      try {
        await this.settings.deleteValue(settingsKey);
      } catch (error: any) {
        if (!error.message?.includes('not found')) {
          MessageBus.send('error', `[LLMConfigPlan] Failed to cleanup bearer token: ${error.message}`);
        }
      }

      MessageBus.send('debug', `[LLMConfigPlan] Removed Ollama server: ${params.id}`);
      return { success: true };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Remove Ollama server error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Enable or disable an Ollama server
   */
  async setOllamaServerEnabled(params: {
    id: string;
    enabled: boolean;
  }): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      if (!this.globalSettingsManager) {
        return { success: false, error: 'GlobalSettingsManager not initialized' };
      }

      const result = await this.globalSettingsManager.setOllamaServerEnabled(params.id, params.enabled);
      if (!result) {
        return { success: false, error: 'Server not found' };
      }

      MessageBus.send('debug', `[LLMConfigPlan] Set Ollama server ${params.id} enabled: ${params.enabled}`);
      return { success: true };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Set Ollama server enabled error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test connection to an Ollama server
   * Named testOllamaServerConnection to avoid conflict with injected testOllamaConnection function
   */
  async testOllamaServerConnection(params: {
    baseUrl: string;
    bearerToken?: string;
  }): Promise<{
    success: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      const result = await this.testOllamaConnection(params.baseUrl, params.bearerToken);
      return {
        success: result.success,
        version: result.version,
        error: result.error
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Discover models from all enabled Ollama servers
   */
  async discoverAllOllamaModels(): Promise<{
    success: boolean;
    count: number;
    errors?: Array<{ serverId: string; error: string }>;
  }> {
    try {
      if (!this.globalSettingsManager) {
        return { success: false, count: 0, errors: [{ serverId: 'global', error: 'GlobalSettingsManager not initialized' }] };
      }

      const servers = await this.globalSettingsManager.getEnabledOllamaServers();
      let totalCount = 0;
      const errors: Array<{ serverId: string; error: string }> = [];

      for (const server of servers) {
        try {
          // Get bearer token from settings if auth type is bearer
          let authToken: string | undefined;
          if (server.authType === 'bearer') {
            const settingsKey = `ollama.${server.id}.bearerToken`;
            authToken = await this.settings.getValue(settingsKey);
          }

          const result = await this.testConnectionAndDiscoverModels({
            server: server.baseUrl,
            authToken
          });

          if (result.success && result.models) {
            totalCount += result.models.length;

            // Register discovered models in registry
            for (const model of result.models) {
              if (this.llmRegistry) {
                let host = server.baseUrl;
                try {
                  host = new URL(server.baseUrl).host;
                } catch {
                  // Use baseUrl as-is if not a valid URL
                }
                const llmObject: any = {
                  $type$: 'LLM',
                  name: model.name,
                  modelId: `${model.name}@${host}`,
                  server: server.baseUrl,
                  provider: 'ollama',
                  inferenceType: 'server',
                  active: false,
                  created: Date.now(),
                  modified: Date.now()
                };
                this.llmRegistry.register(llmObject, 'ollama');
              }
            }
          } else if (result.error) {
            errors.push({ serverId: server.id, error: result.error });
          }
        } catch (error: any) {
          errors.push({ serverId: server.id, error: error.message });
        }
      }

      MessageBus.send('debug', `[LLMConfigPlan] Discovered ${totalCount} models from ${servers.length} servers`);
      return {
        success: errors.length === 0 || totalCount > 0,
        count: totalCount,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error: any) {
      MessageBus.send('error', '[LLMConfigPlan] Discover all Ollama models error:', error);
      return { success: false, count: 0, errors: [{ serverId: 'global', error: error.message }] };
    }
  }
}
