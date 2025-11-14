/**
 * AIAssistantPlan
 *
 * Main orchestrator for AI assistant operations. Platform-agnostic business logic
 * that receives dependencies via constructor injection and delegates to specialized
 * components.
 *
 * This plan follows the two-phase initialization pattern to resolve circular
 * dependencies between AIPromptBuilder and AIMessageProcessor.
 *
 * Responsibilities:
 * - Initialize all AI assistant components
 * - Coordinate operations across components
 * - Provide unified API for IPC plans
 * - Maintain default model selection
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import { AIContactManager, type AIContactManagerDeps } from '../models/ai/AIContactManager.js';
import { AITopicManager } from '../models/ai/AITopicManager.js';
import { AITaskManager } from '../models/ai/AITaskManager.js';
import { AIPromptBuilder } from '../models/ai/AIPromptBuilder.js';
import { AIMessageProcessor } from '../models/ai/AIMessageProcessor.js';
import type { LLMPlatform } from '../services/llm-platform.js';
import type { LLMModelInfo } from '../models/ai/types.js';
import { LLMAnalysisService } from '../services/analysis-service.js';
import type { AnalysisContent, AnalysisContext } from '../services/analysis-service.js';

/**
 * Platform-agnostic settings persistence interface
 */
export interface AISettingsPersistence {
  setDefaultModelId(modelId: string | null): Promise<boolean>;
  getDefaultModelId(): Promise<string | null>;
}

/**
 * Dependencies required by AIAssistantPlan
 */
export interface AIAssistantPlanDependencies {
  /** ONE.core instance (NodeOneCore in Electron, similar in browser) */
  oneCore: any;

  /** Channel manager for message channels */
  channelManager: ChannelManager;

  /** Topic model for chat topics */
  topicModel: TopicModel;

  /** Leute model for contacts */
  leuteModel: LeuteModel;

  /** LLM manager for AI model operations */
  llmManager: any;

  /** Optional: Platform abstraction for UI events */
  platform?: LLMPlatform;

  /** Optional: State manager for platform-specific state */
  stateManager?: any;

  /** Optional: LLM object manager */
  llmObjectManager?: any;

  /** Optional: Context enrichment service */
  contextEnrichmentService?: any;

  /** Optional: Topic analysis model */
  topicAnalysisModel?: any;

  /** Optional: Topic group manager for topic creation (Node.js only) */
  topicGroupManager?: any;

  /** Optional: Assembly manager for knowledge assembly creation */
  assemblyManager?: any;

  /** Optional: Settings persistence for default model and other preferences */
  settingsPersistence?: AISettingsPersistence;

  /** Optional: LLM config plan for browser platform */
  llmConfigPlan?: any;

  /** Optional: MCP manager for memory context (Node.js only) */
  mcpManager?: any;

  /** Storage functions for AIContactManager (to avoid module duplication in Vite worker) */
  storageDeps: AIContactManagerDeps;
}

/**
 * AIAssistantPlan public interface
 */
export class AIAssistantPlan {
  // Component instances
  private contactManager: AIContactManager;
  private topicManager: AITopicManager;
  private taskManager: AITaskManager;
  private promptBuilder: AIPromptBuilder;
  private messageProcessor: AIMessageProcessor;
  private analysisService: LLMAnalysisService;

  // Dependencies
  private deps: AIAssistantPlanDependencies;

  // Initialization state
  private initialized = false;

  constructor(deps: AIAssistantPlanDependencies) {
    this.deps = deps;

    // Phase 1: Construct components with non-circular dependencies
    this.contactManager = new AIContactManager(deps.leuteModel, deps.storageDeps, deps.llmObjectManager);

    this.topicManager = new AITopicManager(
      deps.topicModel,
      deps.channelManager,
      deps.leuteModel,
      deps.llmManager,
      deps.topicGroupManager,
      deps.assemblyManager
    );

    this.taskManager = new AITaskManager(deps.channelManager, deps.topicAnalysisModel);

    this.promptBuilder = new AIPromptBuilder(
      deps.leuteModel,
      deps.channelManager,
      deps.topicModel,
      deps.llmManager,
      this.topicManager,
      deps.contextEnrichmentService
    );

    this.messageProcessor = new AIMessageProcessor(
      deps.channelManager,
      deps.llmManager,
      deps.leuteModel,
      this.topicManager,
      this.contactManager,
      deps.topicModel,
      deps.stateManager,
      deps.platform,
      deps.topicAnalysisModel
    );

    // Initialize analysis service (abstract, reusable for chat/memory/files)
    this.analysisService = new LLMAnalysisService(deps.llmManager, deps.mcpManager);

    // CRITICAL: Inject self into messageProcessor so it calls through us, not llmManager directly
    this.messageProcessor.setAIAssistant(this);
  }

  /**
   * Check if a topic exists in storage
   * @private
   */
  private async _checkTopicExists(topicId: string): Promise<boolean> {
    try {
      await this.deps.topicModel.enterTopicRoom(topicId);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Load default model from platform-specific persistence
   * @private
   */
  private async _loadDefaultModelFromPersistence(_models: LLMModelInfo[]): Promise<string | null> {
    // Try browser-specific llmConfigPlan first (if available)
    if (this.deps.llmConfigPlan) {
      const config = await this.deps.llmConfigPlan.getConfig({});
      if (config?.success && config.config?.modelName) {
        return config.config.modelName;
      }
    }

    // Try Electron-specific settingsPersistence (if available)
    if (this.deps.settingsPersistence) {
      const savedModelId = await this.deps.settingsPersistence.getDefaultModelId();
      if (savedModelId) {
        return savedModelId;
      }
    }

    return null;
  }

  /**
   * Initialize the AI plan and all components
   * Performs two-phase initialization to resolve circular dependencies
   */
  async init(): Promise<void> {
    if (this.initialized) {
      console.log('[AIAssistantPlan] Already initialized');
      return;
    }

    console.log('[AIAssistantPlan] Initializing...');

    try {
      // Phase 2: Resolve circular dependencies via setters
      this.promptBuilder.setMessageProcessor(this.messageProcessor);
      this.messageProcessor.setPromptBuilder(this.promptBuilder);
      this.messageProcessor.setTaskManager(this.taskManager);

      // Initialize task manager (subject channel)
      if (this.deps.topicAnalysisModel) {
        await this.taskManager.initializeSubjectChannel();
      }

      // Get available models from LLM manager
      const models: LLMModelInfo[] = this.deps.llmManager?.getAvailableModels() || [];
      console.log(`[AIAssistantPlan] Found ${models.length} available models`);

      // Load existing AI contacts
      const contactCount = await this.contactManager.loadExistingAIContacts(models);
      console.log(`[AIAssistantPlan] Loaded ${contactCount} existing AI contacts`);

      // DO NOT create contacts for all models - contacts are only created when user selects a model
      console.log(`[AIAssistantPlan] ${models.length} models available`);

      // Update model info with personIds
      for (const model of models) {
        const personId = this.contactManager.getPersonIdForModel(model.id);
        if (personId) {
          model.personId = personId;
        }
      }

      // Set available models in message processor (AFTER personIds are populated)
      this.messageProcessor.setAvailableLLMModels(models);
      console.log(`[AIAssistantPlan] Updated message processor with ${models.length} models (with personIds)`);

      // Load saved default model from persistence - BUT only if default chats already exist
      // If chats don't exist, user must select via UI (which creates chats)
      if (models.length > 0) {
        // Check if default chats (hi/lama) already exist
        const hiExists = await this._checkTopicExists('hi');
        const lamaExists = await this._checkTopicExists('lama');

        const savedDefaultModel = await this._loadDefaultModelFromPersistence(models);

        // If topics exist but no saved model, repair by scanning and registering them
        if (hiExists && lamaExists && !savedDefaultModel) {
          console.log(`[AIAssistantPlan] ⚠️  Found orphaned topics without saved model - will scan to register them`);
          // Note: Topics will be registered during scanExistingConversations below
          // No need to set default model here - user will select via UI
        } else if (savedDefaultModel) {
          // Verify the saved model exists in available models
          const modelExists = models.some(m => m.id === savedDefaultModel);
          if (modelExists) {
            if (hiExists && lamaExists) {
              // Chats exist - safe to auto-load the saved model
              this.topicManager.setDefaultModel(savedDefaultModel);
              console.log(`[AIAssistantPlan] Restored saved default model: ${savedDefaultModel} (chats already exist)`);

              // Ensure AI contacts exist for this model only (the one that was selected)
              const model = models.find(m => m.id === savedDefaultModel);
              if (model) {
                const displayName = model.displayName || model.name || savedDefaultModel;

                // Check if contact already exists before creating
                const existingPersonId = this.contactManager.getPersonIdForModel(savedDefaultModel);
                if (!existingPersonId) {
                  await this.contactManager.ensureAIContactForModel(savedDefaultModel, displayName);
                  console.log(`[AIAssistantPlan] Created AI contact for restored model: ${savedDefaultModel}`);
                }

                // Check private variant
                const privateModelId = savedDefaultModel + '-private';
                const privateDisplayName = `${displayName} (Private)`;
                const existingPrivatePersonId = this.contactManager.getPersonIdForModel(privateModelId);
                if (!existingPrivatePersonId) {
                  await this.contactManager.ensureAIContactForModel(privateModelId, privateDisplayName);
                  console.log(`[AIAssistantPlan] Created private AI contact for restored model`);
                }

                // Ensure topics exist and AI participants are in groups (this registers them)
                await this.createDefaultChats();
                console.log(`[AIAssistantPlan] Ensured existing chats have AI participants and are registered`);
              }
            } else {
              // Chats don't exist - user must select via UI
              console.log(`[AIAssistantPlan] Default chats missing - user must select model via UI`);
            }
          } else {
            console.log(`[AIAssistantPlan] Saved model ${savedDefaultModel} not available`);
          }
        }
      }

      // Removed: Auto-selection disabled - user must select model via UI
      // if (!this.topicManager.getDefaultModel() && models.length > 0) {
      //   const firstModel = models[0];
      //   console.log(`[AIAssistantPlan] Auto-selecting first available model: ${firstModel.id}`);
      //   await this.setDefaultModel(firstModel.id);
      // }

      if (this.topicManager.getDefaultModel()) {
        console.log(`[AIAssistantPlan] Default model configured: ${this.topicManager.getDefaultModel()}`);
      } else {
        console.log(`[AIAssistantPlan] No default model set - user will be prompted to select one`);
      }

      // Scan existing conversations to register AI topics
      // This rebuilds the in-memory topic registry from ONE.core storage
      console.log('[AIAssistantPlan] Scanning existing conversations for AI participants...');
      const scannedCount = await this.scanExistingConversations();
      console.log(`[AIAssistantPlan] ✅ Scan complete - registered ${scannedCount} additional AI topics`);

      this.initialized = true;
      console.log('[AIAssistantPlan] ✅ Initialization complete');
    } catch (error) {
      console.error('[AIAssistantPlan] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create default AI chats (Hi and LAMA)
   * Called when user selects a default model
   */
  private async createDefaultChats(): Promise<void> {
    console.log('[AIAssistantPlan] Creating default AI chats...');

    const defaultModel = this.topicManager.getDefaultModel();
    if (!defaultModel) {
      throw new Error('Cannot create default chats - no default model set');
    }

    console.log(`[AIAssistantPlan] Using default model: ${defaultModel}`);

    await this.topicManager.ensureDefaultChats(
      this.contactManager,
      async (topicId: string, modelId: string) => {
        // Callback when topic is created - generate welcome message
        await this.messageProcessor.handleNewTopic(topicId, modelId);
      }
    );

    // Refresh message processor's model list after chat creation
    // because private variants may have been registered during topic creation
    const updatedModels: LLMModelInfo[] = this.deps.llmManager?.getAvailableModels() || [];

    // Update model info with personIds (including newly created private variants)
    for (const model of updatedModels) {
      const personId = this.contactManager.getPersonIdForModel(model.id);
      if (personId) {
        model.personId = personId;
      }
    }

    this.messageProcessor.setAvailableLLMModels(updatedModels);
    console.log(`[AIAssistantPlan] ✅ Default chats created with ${updatedModels.length} models`);
  }

  /**
   * Scan existing conversations for AI participants and register them
   */
  async scanExistingConversations(): Promise<number> {
    console.log('[AIAssistantPlan] Scanning existing conversations...');
    const count = await this.topicManager.scanExistingConversations(this.contactManager);
    return count;
  }

  /**
   * Process a message in an AI topic
   */
  async processMessage(
    topicId: string,
    message: string,
    senderId: SHA256IdHash<Person>
  ): Promise<string | null> {
    if (!this.initialized) {
      throw new Error('[AIAssistantPlan] Plan not initialized - call init() first');
    }

    return await this.messageProcessor.processMessage(topicId, message, senderId);
  }

  /**
   * Check if a topic is an AI topic
   */
  isAITopic(topicId: string): boolean {
    return this.topicManager.isAITopic(topicId);
  }

  /**
   * Get the model ID for a topic
   */
  getModelIdForTopic(topicId: string): string | null {
    return this.topicManager.getModelIdForTopic(topicId);
  }

  /**
   * Check if a person ID is an AI person
   */
  isAIPerson(personId: SHA256IdHash<Person>): boolean {
    return this.contactManager.isAIPerson(personId);
  }

  /**
   * Check if a topic has any LLM participants.
   *
   * The AITopicManager registry is the source of truth - if the topic isn't registered, it doesn't have AI.
   */
  async topicHasLLMParticipant(topicId: string): Promise<boolean> {
    const isRegistered = this.topicManager.isAITopic(topicId);
    console.log(`[AIAssistantPlan.topicHasLLMParticipant] Topic ${topicId} registered: ${isRegistered}`);
    return isRegistered;
  }

  /**
   * Get model ID for a person ID (reverse lookup)
   */
  getModelIdForPersonId(personId: SHA256IdHash<Person>): string | null {
    return this.contactManager.getModelIdForPersonId(personId);
  }

  /**
   * Ensure an AI contact exists for a specific model
   */
  async ensureAIContactForModel(modelId: string): Promise<SHA256IdHash<Person>> {
    // Find model info
    const models = this.deps.llmManager?.getAvailableModels() || [];
    const model = models.find((m: any) => m.id === modelId);

    if (!model) {
      throw new Error(`[AIAssistantPlan] Model ${modelId} not found in available models`);
    }

    return await this.contactManager.ensureAIContactForModel(modelId, model.displayName || model.name);
  }

  /**
   * Set the default AI model and create default chats
   * Called when user selects a model in ModelOnboarding
   */
  async setDefaultModel(modelId: string): Promise<void> {
    console.log(`[AIAssistantPlan] Setting default model: ${modelId}`);

    // Set as default immediately - topicManager uses modelId directly
    this.topicManager.setDefaultModel(modelId);

    // Persist the model
    if (this.deps.settingsPersistence) {
      await this.deps.settingsPersistence.setDefaultModelId(modelId);
    }

    // Wait for topics to be created so they appear in conversation list immediately
    // (Welcome messages still generate in background via callbacks)
    try {
      await this.createDefaultChats();
      console.log(`[AIAssistantPlan] ✅ Default chats created, topics are ready`);
    } catch (err) {
      console.error('[AIAssistantPlan] ❌ Failed to create default chats:', err);
    }

    console.log(`[AIAssistantPlan] ✅ Default model set: ${modelId}`);
  }

  /**
   * Get the default AI model
   */
  getDefaultModel(): any | null {
    const modelId = this.topicManager.getDefaultModel();
    if (!modelId) {
      return null;
    }

    const models = this.deps.llmManager?.getAvailableModels() || [];
    return models.find((m: any) => m.id === modelId) || null;
  }

  /**
   * Register an AI topic
   */
  registerAITopic(topicId: string, modelId: string): void {
    this.topicManager.registerAITopic(topicId, modelId);
  }

  /**
   * Get topic display name
   */
  getTopicDisplayName(topicId: string): string | undefined {
    return this.topicManager.getTopicDisplayName(topicId);
  }

  /**
   * Set topic display name
   */
  setTopicDisplayName(topicId: string, name: string): void {
    this.topicManager.setTopicDisplayName(topicId, name);
  }

  /**
   * Handle a new topic creation by sending a welcome message
   */
  async handleNewTopic(topicId: string): Promise<void> {
    const modelId = this.topicManager.getModelIdForTopic(topicId);
    if (!modelId) {
      throw new Error(`[AIAssistantPlan] No model ID for topic: ${topicId}`);
    }

    await this.messageProcessor.handleNewTopic(topicId, modelId);
  }

  /**
   * Chat with LLM (simple streaming)
   * This is the ONLY way AIMessageProcessor should talk to LLMs
   *
   * @param history - Conversation history
   * @param modelId - LLM model ID
   * @param options - Streaming and tool options
   * @param topicId - Optional topic ID for MCP configuration check
   * @returns LLM response
   */
  async chat(
    history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    modelId: string,
    options?: {
      onStream?: (chunk: string) => void;
      disableTools?: boolean;
    },
    topicId?: string
  ): Promise<any> {
    if (!this.initialized) {
      throw new Error('[AIAssistantPlan] Plan not initialized - call init() first');
    }

    if (!this.deps.llmManager) {
      throw new Error('[AIAssistantPlan] LLM Manager not available');
    }

    // All LLM calls go through here - we can add middleware, logging, etc.
    // Pass topicId through to LLM manager for MCP configuration check
    const optionsWithTopic = topicId ? { ...options, topicId } : options;
    return await this.deps.llmManager.chat(history, modelId, optionsWithTopic);
  }

  /**
   * Chat with LLM and get analysis (response + subjects/keywords)
   * This is the ONLY way AIMessageProcessor should get analyzed responses
   *
   * @param history - Conversation history
   * @param modelId - LLM model ID
   * @param options - Streaming and analysis options
   * @param topicId - Topic ID for analysis context
   * @returns {response, analysis, thinking} with subjects, keywords, and thinking trace
   */
  async chatWithAnalysis(
    history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    modelId: string,
    options?: {
      onStream?: (chunk: string) => void;
      onThinkingStream?: (chunk: string) => void;
    },
    topicId?: string
  ): Promise<any> {
    if (!this.initialized) {
      throw new Error('[AIAssistantPlan] Plan not initialized - call init() first');
    }

    if (!this.deps.llmManager) {
      throw new Error('[AIAssistantPlan] LLM Manager not available');
    }

    const startTime = Date.now();
    console.log(`[AIAssistantPlan] chatWithAnalysis starting for model: ${modelId}`);

    // Emit thinking status: preparing to call LLM
    if (topicId && this.deps.platform?.emitThinkingStatus) {
      this.deps.platform.emitThinkingStatus(topicId, 'Preparing request...');
    }

    // OPTION 1: Stream response first, then analyze in background
    // Step 1: Stream the response (fast UX)
    let fullResponse = '';
    let fullThinking = '';

    // Emit thinking status: calling LLM
    if (topicId && this.deps.platform?.emitThinkingStatus) {
      this.deps.platform.emitThinkingStatus(topicId, 'Calling LLM...');
    }

    const rawResponse = await this.deps.llmManager.chat(history, modelId, {
      ...options,
      // Tools enabled - LLM can use MCP tools. Tool calls are filtered from streaming below.
      onStream: (chunk: string) => {
        fullResponse += chunk;

        // Don't stream tool call JSON to user - let processToolCalls handle it
        // Tool calls look like: {"tool":"...", "parameters":{...}} or ```json\n{...}\n```
        const looksLikeToolCall = chunk.includes('"tool"') && chunk.includes('"parameters"');
        if (!looksLikeToolCall) {
          options?.onStream?.(chunk);
        }
      },
      onThinkingStream: (chunk: string) => {
        fullThinking += chunk;
        options?.onThinkingStream?.(chunk);
      }
    });

    // Handle both string and object responses (with thinking metadata)
    if (typeof rawResponse === 'object' && (rawResponse as any)._hasThinking) {
      fullResponse = (rawResponse as any).content;
      fullThinking = (rawResponse as any).thinking || '';
      console.log('[AIAssistantPlan] Response includes thinking metadata (length:', fullThinking.length, 'chars)');
    } else if (typeof rawResponse === 'string') {
      fullResponse = rawResponse;
    } else {
      fullResponse = String(rawResponse || '');
    }

    console.log(`[AIAssistantPlan] Response streaming complete (${Date.now() - startTime}ms), starting background analysis`);

    // Return immediately - don't block on analysis
    const immediateResult = {
      response: fullResponse,
      thinking: fullThinking || undefined, // Include thinking trace if present
      analysis: { subjects: [], summaryUpdate: '', keywords: [] }, // Empty - will be updated async
      topicId
    };

    // Step 2: Analyze in background (non-blocking)
    // Use setTimeout for browser compatibility (setImmediate is Node.js only)
    setTimeout(async () => {
      try {
        console.log(`[AIAssistantPlan] Background analysis starting for topic: ${topicId}`);

        // Create analysis service with progress callback
        const progressCallback = (message: string) => {
          console.log(`[AIAssistantPlan] Analysis progress: ${message}`);
        };
        const analysisService = new (this.analysisService.constructor as any)(
          this.deps.llmManager,
          this.deps.mcpManager,
          progressCallback
        );

        const analysisContent: AnalysisContent = {
          type: 'chat',
          messages: [
            ...history,
            { role: 'assistant', content: fullResponse }
          ]
        };

        const analysisContext: AnalysisContext = {
          // Don't specify modelId - let AnalysisService auto-select a model that supports structured output
          temperature: 0,
          topicId,
          disableTools: true
        };

        // AnalysisService automatically:
        // 1. Fetches existing subjects from memory via MCP
        // 2. Includes them in prompt for consistency
        // 3. Returns structured analysis
        const result = await analysisService.analyze(analysisContent, analysisContext);

        console.log(`[AIAssistantPlan] Background analysis complete (${Date.now() - startTime}ms total)`);
        console.log(`[AIAssistantPlan] Analysis results: ${result.subjects?.length || 0} subjects, ${result.keywords?.length || 0} keywords`);

        // Store the extracted subjects and keywords using TopicAnalysisModel
        if (result.subjects && result.subjects.length > 0 && this.deps.topicAnalysisModel) {
          console.log(`[AIAssistantPlan] Storing ${result.subjects.length} subjects to ONE.core...`);
          for (const subject of result.subjects.slice(0, 5)) {
            try {
              const subjectId = subject.keywords.map((k: any) => k.term).join('+');
              const createdSubject = await this.deps.topicAnalysisModel.createSubject(
                topicId as any,
                subject.keywords.map((k: any) => k.term),
                subjectId,
                subject.description,
                subject.keywords[0]?.confidence || 0.8
              );
              // Add keywords to subject
              for (const keyword of subject.keywords) {
                await this.deps.topicAnalysisModel.addKeywordToSubject(
                  topicId as any,
                  keyword.term,
                  createdSubject.idHash
                );
              }
            } catch (error) {
              console.warn(`[AIAssistantPlan] Failed to store subject:`, error);
            }
          }
          console.log(`[AIAssistantPlan] ✅ Subjects stored successfully`);
        }

        // Analysis complete - could emit event here if needed for UI updates
      } catch (error: any) {
        console.warn('[AIAssistantPlan] Background analysis failed:', error?.message || error);
      }
    });

    return immediateResult;
  }

  /**
   * Shutdown the AI plan and clean up resources
   */
  async shutdown(): Promise<void> {
    console.log('[AIAssistantPlan] Shutting down...');
    this.initialized = false;
  }

  /**
   * Get all AI topic IDs
   */
  getAllAITopicIds(): string[] {
    return this.topicManager.getAllAITopicIds();
  }

  /**
   * Associate a task with a topic (for IoM)
   */
  async associateTaskWithTopic(topicId: string, taskType: any): Promise<void> {
    await this.taskManager.associateTaskWithTopic(topicId, taskType);
  }

  /**
   * Get contact manager (for testing/debugging)
   */
  getContactManager(): AIContactManager {
    return this.contactManager;
  }

  /**
   * Get topic manager (for testing/debugging)
   */
  getTopicManager(): AITopicManager {
    return this.topicManager;
  }

  /**
   * Get task manager (for testing/debugging)
   */
  getTaskManager(): AITaskManager {
    return this.taskManager;
  }

  /**
   * Get prompt builder (for testing/debugging)
   */
  getPromptBuilder(): AIPromptBuilder {
    return this.promptBuilder;
  }

  /**
   * Get message processor (for testing/debugging)
   */
  getMessageProcessor(): AIMessageProcessor {
    return this.messageProcessor;
  }

  /**
   * Get all AI contacts with their model information
   * Returns array of {modelId, name, personId} for compatibility with chat plan
   */
  getAllContacts(): Array<{ modelId: string; name: string; personId: string | null }> {
    const models = this.deps.llmManager.getAvailableModels();

    return models.map((model: any) => ({
      modelId: model.id,
      name: model.name,
      personId: this.contactManager.getPersonIdForModel(model.id)
    }));
  }
}
