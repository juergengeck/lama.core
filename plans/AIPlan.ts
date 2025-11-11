/**
 * AI Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for AI operations.
 * Can be used from both Electron IPC and Web Worker contexts.
 */

import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';

// Request/Response types
export interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  modelId?: string;
  stream?: boolean;
  topicId?: string;
}

export interface ChatResponse {
  success: boolean;
  data?: {
    response: string;
    modelId: string;
    streamed?: boolean;
  };
  error?: string;
}

export interface GetModelsRequest {
  // No parameters
}

export interface GetModelsResponse {
  success: boolean;
  data?: {
    models: Array<{
      id: string;
      name: string;
      provider: string;
      isLoaded: boolean;
      isDefault: boolean;
    }>;
    defaultModelId: string | null;
  };
  error?: string;
}

export interface SetDefaultModelRequest {
  modelId: string;
}

export interface SetDefaultModelResponse {
  success: boolean;
  modelId?: string;
  modelName?: string;
  error?: string;
}

export interface SetApiKeyRequest {
  provider: string;
  apiKey: string;
}

export interface SetApiKeyResponse {
  success: boolean;
  data?: { provider: string };
  error?: string;
}

export interface GetToolsRequest {
  // No parameters
}

export interface GetToolsResponse {
  success: boolean;
  data?: {
    tools: any[];
    count: number;
  };
  error?: string;
}

export interface ExecuteToolRequest {
  toolName: string;
  parameters: any;
}

export interface ExecuteToolResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface InitializeLLMRequest {
  // No parameters
}

export interface InitializeLLMResponse {
  success: boolean;
  data?: {
    initialized: boolean;
    modelCount: number;
    toolCount: number;
  };
  error?: string;
}

export interface DebugToolsRequest {
  // No parameters
}

export interface DebugToolsResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface GetOrCreateContactRequest {
  modelId: string;
}

export interface GetOrCreateContactResponse {
  success: boolean;
  data?: {
    personId: string;
    modelId: string;
  };
  error?: string;
}

export interface TestApiKeyRequest {
  provider: string;
  apiKey: string;
}

export interface TestApiKeyResponse {
  success: boolean;
  data?: { valid: boolean };
  error?: string;
}

export interface GetDefaultModelRequest {
  // No parameters
}

export interface GetDefaultModelResponse {
  success: boolean;
  model?: string;
  error?: string;
}

export interface EnsureDefaultChatsRequest {
  // No parameters
}

export interface EnsureDefaultChatsResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface DiscoverClaudeModelsRequest {
  apiKey?: string;
}

export interface DiscoverClaudeModelsResponse {
  success: boolean;
  data?: {
    models: any[];
    count: number;
  };
  error?: string;
}

/**
 * AIPlan - Pure business logic for AI operations
 */
export class AIPlan {
  private llmManager: any = null;
  private aiAssistantModel: any = null;
  private topicModel: TopicModel | null = null;
  private nodeOneCore: any = null;
  private stateManager: any = null;

  constructor(
    llmManager?: any,
    aiAssistantModel?: any,
    topicModel?: TopicModel,
    nodeOneCore?: any,
    stateManager?: any
  ) {
    this.llmManager = llmManager || null;
    this.aiAssistantModel = aiAssistantModel || null;
    this.topicModel = topicModel || null;
    this.nodeOneCore = nodeOneCore || null;
    this.stateManager = stateManager || null;
  }

  /**
   * Set models after initialization
   */
  setModels(
    llmManager: any,
    aiAssistantModel: any,
    topicModel: TopicModel,
    nodeOneCore?: any,
    stateManager?: any
  ): void {
    this.llmManager = llmManager;
    this.aiAssistantModel = aiAssistantModel;
    this.topicModel = topicModel;
    if (nodeOneCore) this.nodeOneCore = nodeOneCore;
    if (stateManager) this.stateManager = stateManager;
  }

  /**
   * Send messages to AI and get response (with streaming support)
   */
  async chat(
    request: ChatRequest,
    eventSender?: { send: (channel: string, data: any) => void }
  ): Promise<ChatResponse> {
    console.log('[AIPlan] Chat request with', request.messages?.length || 0, 'messages, streaming:', request.stream, 'topicId:', request.topicId);

    try {
      // Ensure LLM manager is initialized
      if (!this.llmManager) {
        return { success: false, error: 'LLM Manager not initialized' };
      }

      if (!(this.llmManager as any).isInitialized) {
        await (this.llmManager as any).init();
      }

      if (request.stream && eventSender) {
        // Streaming mode - send chunks via event sender with analysis
        let fullResponse = '';
        const result: any = await (this.llmManager as any).chatWithAnalysis(request.messages, request.modelId, {
          onStream: (chunk: string) => {
            fullResponse += chunk;
            // Send streaming chunk
            eventSender.send('ai:stream-chunk', {
              chunk,
              partial: fullResponse
            });
          }
        });

        // Process analysis in background if available
        if (result.analysis && this.nodeOneCore?.topicAnalysisModel && request.topicId) {
          // Use setTimeout for browser compatibility (setImmediate is Node.js only)
          setTimeout(async () => {
            try {
              console.log('[AIPlan] Processing analysis in background for topic:', request.topicId);

              // Process all subjects from analysis
              if (result.analysis.subjects && Array.isArray(result.analysis.subjects)) {
                for (const subject of result.analysis.subjects) {
                  if (subject.isNew) {
                    // Extract keyword terms from keyword objects
                    const keywordTerms = subject.keywords?.map((kw: any) => kw.term || kw) || [];

                    // Create subject -> returns subject with idHash
                    // Subject ID is the alphabetically sorted keyword combination for exact identity matching
                    const subjectId = [...keywordTerms].sort().join('+');
                    const createdSubject = await this.nodeOneCore.topicAnalysisModel.createSubject(
                      request.topicId,
                      keywordTerms,
                      subjectId,
                      subject.description,
                      0.8
                    );

                    console.log(`[AIPlan] Created subject: ${subjectId} with ID hash: ${createdSubject.idHash}`);

                    // Store each keyword with reference to this subject
                    for (const keyword of (subject.keywords || [])) {
                      const term = keyword.term || keyword;
                      await this.nodeOneCore.topicAnalysisModel.addKeywordToSubject(
                        request.topicId,
                        term,
                        createdSubject.idHash
                      );
                    }

                    console.log(`[AIPlan] Stored ${subject.keywords?.length || 0} keywords for subject: ${subject.name}`);
                  }
                }
              }
            } catch (error) {
              console.error('[AIPlan] Error processing analysis:', error);
            }
          });
        }

        // Send final complete message
        if (eventSender) {
          eventSender.send('ai:stream-complete', {
            response: result.response,
            modelId: request.modelId || (this.llmManager as any).defaultModelId
          });
        }

        return {
          success: true,
          data: {
            response: result.response,
            modelId: request.modelId || (this.llmManager as any).defaultModelId,
            streamed: true
          }
        };
      } else {
        // Non-streaming mode - wait for full response with analysis
        const chatResult: any = await (this.llmManager as any).chatWithAnalysis(request.messages, request.modelId);
        const response = chatResult.response;
        const responseStr = String(response || '');
        console.log('[AIPlan] Got response:', responseStr.substring(0, 100) + '...');

        // Process analysis in background if available
        if (chatResult.analysis && this.nodeOneCore?.topicAnalysisModel && request.topicId) {
          // Use setTimeout for browser compatibility (setImmediate is Node.js only)
          setTimeout(async () => {
            try {
              console.log('[AIPlan] Processing analysis in background for topic:', request.topicId);

              // Process all subjects from analysis
              if (chatResult.analysis.subjects && Array.isArray(chatResult.analysis.subjects)) {
                for (const subject of chatResult.analysis.subjects) {
                  if (subject.isNew) {
                    // Extract keyword terms from keyword objects
                    const keywordTerms = subject.keywords?.map((kw: any) => kw.term || kw) || [];

                    // Create subject -> returns subject with idHash
                    // Subject ID is the alphabetically sorted keyword combination for exact identity matching
                    const subjectId = [...keywordTerms].sort().join('+');
                    const createdSubject = await this.nodeOneCore.topicAnalysisModel.createSubject(
                      request.topicId,
                      keywordTerms,
                      subjectId,
                      subject.description,
                      0.8
                    );

                    console.log(`[AIPlan] Created subject: ${subjectId} with ID hash: ${createdSubject.idHash}`);

                    // Store each keyword with reference to this subject
                    for (const keyword of (subject.keywords || [])) {
                      const term = keyword.term || keyword;
                      await this.nodeOneCore.topicAnalysisModel.addKeywordToSubject(
                        request.topicId,
                        term,
                        createdSubject.idHash
                      );
                    }

                    console.log(`[AIPlan] Stored ${subject.keywords?.length || 0} keywords for subject: ${subject.name}`);
                  }
                }
              }
            } catch (error) {
              console.error('[AIPlan] Error processing analysis:', error);
            }
          });
        }

        return {
          success: true,
          data: {
            response,
            modelId: request.modelId || (this.llmManager as any).defaultModelId
          }
        };
      }
    } catch (error) {
      console.error('[AIPlan] Chat error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get available AI models
   */
  async getModels(request: GetModelsRequest): Promise<GetModelsResponse> {
    console.log('[AIPlan] Get models request');

    try {
      if (!this.llmManager) {
        return {
          success: false,
          error: 'LLM Manager not initialized',
          data: { models: [], defaultModelId: null }
        };
      }

      if (!(this.llmManager as any).isInitialized) {
        await (this.llmManager as any).init();
      }

      const models = (this.llmManager as any).getAvailableModels();
      // Get default model from AI Assistant Model which is the single source of truth
      const defaultModel = this.nodeOneCore?.aiAssistantModel?.getDefaultModel();
      const defaultModelId = defaultModel?.id || null;

      // Mark models as loaded if they have AI contacts created
      // A model is loaded if it has been initialized with an AI contact (person ID)
      const modelsWithLoadStatus = models.map((model: any) => {
        const hasAIContact = this.nodeOneCore?.aiAssistantModel?.getPersonIdForModel(model.id) !== null;
        return {
          ...model,
          isLoaded: hasAIContact,
          isDefault: model.id === defaultModelId
        };
      });

      return {
        success: true,
        data: {
          models: modelsWithLoadStatus,
          defaultModelId
        }
      };
    } catch (error) {
      console.error('[AIPlan] Get models error:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: {
          models: [],
          defaultModelId: null
        }
      };
    }
  }

  /**
   * Set default AI model
   */
  async setDefaultModel(
    request: SetDefaultModelRequest,
    eventSender?: { getAllWindows: () => Array<{ webContents: { send: (channel: string, data: any) => void } }> }
  ): Promise<SetDefaultModelResponse> {
    console.log('[AIPlan] ==========================================');
    console.log('[AIPlan] SET DEFAULT MODEL CALLED');
    console.log('[AIPlan] Model ID:', request.modelId);
    console.log('[AIPlan] ==========================================');

    try {
      if (!this.llmManager) {
        return { success: false, error: 'LLM Manager not initialized' };
      }

      if (!(this.llmManager as any).isInitialized) {
        await (this.llmManager as any).init();
      }

      const model = (this.llmManager as any).getModel(request.modelId);
      if (!model) {
        throw new Error(`Model ${request.modelId} not found`);
      }

      // AI Assistant is the single source of truth for default model
      console.log('[AIPlan] Creating AI contact for newly selected model:', request.modelId);
      await this.nodeOneCore.aiAssistantModel.createAIContact(request.modelId, model.name);

      // Set default model through AI Assistant
      await this.nodeOneCore.aiAssistantModel.setDefaultModel(request.modelId);

      // Don't create chats here - wait for user to navigate to chat view
      console.log('[AIPlan] Model set successfully, chats will be created when accessed');

      // Notify all windows that the model has changed
      if (eventSender) {
        eventSender.getAllWindows().forEach(window => {
          window.webContents.send('ai:defaultModelChanged', { modelId: request.modelId, modelName: model.name });
        });
      }

      return {
        success: true,
        modelId: request.modelId,
        modelName: model.name
      };
    } catch (error) {
      console.error('[AIPlan] Set default model error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Set API key for a provider
   */
  async setApiKey(request: SetApiKeyRequest): Promise<SetApiKeyResponse> {
    console.log('[AIPlan] Set API key for:', request.provider);

    try {
      if (!this.llmManager) {
        return { success: false, error: 'LLM Manager not initialized' };
      }

      if (!(this.llmManager as any).isInitialized) {
        await (this.llmManager as any).init();
      }

      await (this.llmManager as any).setApiKey(request.provider, request.apiKey);

      // Store securely (implement proper encryption)
      if (this.stateManager) {
        this.stateManager.setState(`ai.apiKeys.${request.provider}`, request.apiKey);
      }

      return {
        success: true,
        data: { provider: request.provider }
      };
    } catch (error) {
      console.error('[AIPlan] Set API key error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get available MCP tools
   */
  async getTools(request: GetToolsRequest): Promise<GetToolsResponse> {
    console.log('[AIPlan] Get MCP tools request');

    try {
      if (!this.llmManager) {
        return {
          success: false,
          error: 'LLM Manager not initialized',
          data: { tools: [], count: 0 }
        };
      }

      if (!(this.llmManager as any).isInitialized) {
        await (this.llmManager as any).init();
      }

      const tools = Array.from((this.llmManager as any).mcpTools.values());

      return {
        success: true,
        data: {
          tools,
          count: tools.length
        }
      };
    } catch (error) {
      console.error('[AIPlan] Get tools error:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: {
          tools: [],
          count: 0
        }
      };
    }
  }

  /**
   * Execute an MCP tool
   */
  async executeTool(request: ExecuteToolRequest): Promise<ExecuteToolResponse> {
    console.log('[AIPlan] Execute tool:', request.toolName);

    try {
      if (!this.llmManager) {
        return { success: false, error: 'LLM Manager not initialized' };
      }

      if (!(this.llmManager as any).isInitialized) {
        await (this.llmManager as any).init();
      }

      // Use mcpManager - it should be passed to constructor or available globally
      // For now, we'll need to pass it through the constructor
      // TODO: Pass mcpManager through constructor
      throw new Error('MCP Manager integration needs to be refactored - pass through constructor');
    } catch (error) {
      console.error('[AIPlan] Tool execution error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Initialize LLM manager
   */
  async initializeLLM(request: InitializeLLMRequest): Promise<InitializeLLMResponse> {
    console.log('[AIPlan] Initialize LLM request');

    try {
      if (!this.llmManager) {
        return { success: false, error: 'LLM Manager not initialized' };
      }

      if ((this.llmManager as any).isInitialized) {
        return {
          success: true,
          data: {
            initialized: true,
            modelCount: (this.llmManager as any).models.size,
            toolCount: (this.llmManager as any).mcpTools.size
          }
        };
      }

      await (this.llmManager as any).init();

      return {
        success: true,
        data: {
          initialized: true,
          modelCount: (this.llmManager as any).models.size,
          toolCount: (this.llmManager as any).mcpTools.size
        }
      };
    } catch (error) {
      console.error('[AIPlan] Initialize error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Debug MCP tools registration
   */
  async debugTools(request: DebugToolsRequest): Promise<DebugToolsResponse> {
    console.log('[AIPlan] Debug tools request');

    try {
      if (!this.llmManager) {
        return { success: false, error: 'LLM Manager not initialized' };
      }

      const debugInfo = (this.llmManager as any).debugToolsState();
      return {
        success: true,
        data: debugInfo
      };
    } catch (error) {
      console.error('[AIPlan] Debug tools error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get or create AI contact for a model
   */
  async getOrCreateContact(
    request: GetOrCreateContactRequest,
    eventSender?: { getAllWindows: () => Array<{ webContents: { send: (channel: string) => void } }> }
  ): Promise<GetOrCreateContactResponse> {
    console.log('[AIPlan] Get or create AI contact for model:', request.modelId);

    try {
      // Use the nodeOneCore instance
      if (!this.nodeOneCore || !this.nodeOneCore.aiAssistantModel) {
        throw new Error('AI system not initialized');
      }

      // Ensure the AI contact exists for this model
      const personId = await this.nodeOneCore.aiAssistantModel.ensureAIContactForModel(request.modelId);

      if (!personId) {
        throw new Error(`Failed to create AI contact for model ${request.modelId}`);
      }

      // Emit contacts:updated event to notify UI
      if (eventSender) {
        eventSender.getAllWindows().forEach(window => {
          window.webContents.send('contacts:updated');
        });
        console.log('[AIPlan] Emitted contacts:updated event after creating AI contact');
      }

      return {
        success: true,
        data: {
          personId: personId.toString(),
          modelId: request.modelId
        }
      };
    } catch (error) {
      console.error('[AIPlan] Get/create AI contact error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Test an API key with the provider
   */
  async testApiKey(request: TestApiKeyRequest): Promise<TestApiKeyResponse> {
    console.log(`[AIPlan] Testing ${request.provider} API key`);

    try {
      if (!this.llmManager) {
        return { success: false, error: 'LLM Manager not initialized' };
      }

      if (!(this.llmManager as any).isInitialized) {
        await (this.llmManager as any).init();
      }

      // Test the API key based on provider
      let isValid = false;

      if (request.provider === 'anthropic') {
        // Test Claude API key
        isValid = await (this.llmManager as any).testClaudeApiKey(request.apiKey);
      } else if (request.provider === 'openai') {
        // Test OpenAI API key
        isValid = await (this.llmManager as any).testOpenAIApiKey(request.apiKey);
      } else {
        throw new Error(`Unknown provider: ${request.provider}`);
      }

      return {
        success: isValid,
        data: { valid: isValid }
      };
    } catch (error) {
      console.error('[AIPlan] Test API key error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get current default model
   */
  async getDefaultModel(): Promise<GetDefaultModelResponse> {
    try {
      if (!this.nodeOneCore?.aiAssistantModel) {
        console.log('[AIPlan] AI assistant model not available');
        return { success: false, error: 'AI assistant model not available' };
      }

      // Use the new async method that loads from settings if needed
      const modelId = await this.nodeOneCore.aiAssistantModel.getDefaultModel();
      console.log('[AIPlan] Default model ID:', modelId);

      return {
        success: true,
        model: modelId || undefined
      };
    } catch (error) {
      console.error('[AIPlan] Error getting default model:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Ensure default AI chats exist when user navigates to chat view
   * This is called lazily when the chat view is accessed, not during model selection
   * DELEGATES to AIAssistantModel - we do NOT create chats here
   */
  async ensureDefaultChats(request: EnsureDefaultChatsRequest): Promise<EnsureDefaultChatsResponse> {
    try {
      if (!this.nodeOneCore?.initialized) {
        console.log('[AIPlan] Node not initialized');
        return { success: false, error: 'Node not initialized' };
      }

      if (!this.nodeOneCore.aiAssistantModel) {
        console.log('[AIPlan] AIAssistantModel not initialized');
        return { success: false, error: 'AIAssistantModel not initialized' };
      }

      // DELEGATE to AIAssistantModel - it owns default chat creation
      console.log('[AIPlan] Delegating default chat creation to AIAssistantModel');
      await this.nodeOneCore.aiAssistantModel.ensureDefaultChats();

      return {
        success: true,
        message: 'Default chats ensured by AIAssistantModel'
      };
    } catch (error) {
      console.error('[AIPlan] Ensure default chats error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Discover Claude models from Anthropic API
   * Called after API key is saved to dynamically register available models
   */
  async discoverClaudeModels(
    request: DiscoverClaudeModelsRequest,
    eventSender?: { getAllWindows: () => Array<{ webContents: { send: (channel: string) => void } }> }
  ): Promise<DiscoverClaudeModelsResponse> {
    console.log('[AIPlan] Discovering Claude models from API...');

    try {
      if (!this.llmManager) {
        return { success: false, error: 'LLM Manager not initialized' };
      }

      if (!(this.llmManager as any).isInitialized) {
        await (this.llmManager as any).init();
      }

      // API key must be provided in request
      // Secure storage should be handled by the platform layer (lama.electron)
      if (!request.apiKey) {
        throw new Error('API key is required to discover Claude models');
      }

      // Call LLM manager to discover models from API with explicit API key
      await (this.llmManager as any).discoverClaudeModels(request.apiKey);

      // Get the updated list of models
      const models = (this.llmManager as any).getModels();
      const claudeModels = models.filter((m: any) => m.provider === 'anthropic');

      console.log(`[AIPlan] Discovered ${claudeModels.length} Claude models`);

      // Automatically create AI contacts for all discovered Claude models
      if (this.nodeOneCore?.aiAssistantModel && claudeModels.length > 0) {
        console.log('[AIPlan] Creating AI contacts for discovered Claude models...');

        for (const model of claudeModels) {
          try {
            await this.nodeOneCore.aiAssistantModel.ensureAIContactForModel(model.id);
            console.log(`[AIPlan] Created AI contact for ${model.name}`);
          } catch (contactError) {
            console.warn(`[AIPlan] Failed to create contact for ${model.name}:`, contactError);
          }
        }

        // Emit contacts:updated event to notify UI
        if (eventSender) {
          eventSender.getAllWindows().forEach(window => {
            window.webContents.send('contacts:updated');
          });
          console.log('[AIPlan] Emitted contacts:updated event after creating Claude contacts');
        }
      }

      return {
        success: true,
        data: {
          models: claudeModels,
          count: claudeModels.length
        }
      };
    } catch (error) {
      console.error('[AIPlan] Discover Claude models error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
}
