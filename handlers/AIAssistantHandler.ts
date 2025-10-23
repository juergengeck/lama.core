/**
 * AIAssistantHandler
 *
 * Main orchestrator for AI assistant operations. Platform-agnostic business logic
 * that receives dependencies via constructor injection and delegates to specialized
 * components.
 *
 * This handler follows the two-phase initialization pattern to resolve circular
 * dependencies between AIPromptBuilder and AIMessageProcessor.
 *
 * Responsibilities:
 * - Initialize all AI assistant components
 * - Coordinate operations across components
 * - Provide unified API for IPC handlers
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

/**
 * Platform-agnostic settings persistence interface
 */
export interface AISettingsPersistence {
  setDefaultModelId(modelId: string | null): Promise<boolean>;
  getDefaultModelId(): Promise<string | null>;
}

/**
 * Dependencies required by AIAssistantHandler
 */
export interface AIAssistantHandlerDependencies {
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

  /** Optional: Settings persistence for default model and other preferences */
  settingsPersistence?: AISettingsPersistence;

  /** Optional: LLM config handler for browser platform */
  llmConfigHandler?: any;

  /** Storage functions for AIContactManager (to avoid module duplication in Vite worker) */
  storageDeps: AIContactManagerDeps;
}

/**
 * AIAssistantHandler public interface
 */
export class AIAssistantHandler {
  // Component instances
  private contactManager: AIContactManager;
  private topicManager: AITopicManager;
  private taskManager: AITaskManager;
  private promptBuilder: AIPromptBuilder;
  private messageProcessor: AIMessageProcessor;

  // Dependencies
  private deps: AIAssistantHandlerDependencies;

  // Initialization state
  private initialized = false;

  constructor(deps: AIAssistantHandlerDependencies) {
    this.deps = deps;

    // Phase 1: Construct components with non-circular dependencies
    this.contactManager = new AIContactManager(deps.leuteModel, deps.storageDeps, deps.llmObjectManager);

    this.topicManager = new AITopicManager(
      deps.topicModel,
      deps.channelManager,
      deps.leuteModel,
      deps.llmManager,
      deps.topicGroupManager
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
  }

  /**
   * Initialize the AI handler and all components
   * Performs two-phase initialization to resolve circular dependencies
   */
  async init(): Promise<void> {
    if (this.initialized) {
      console.log('[AIAssistantHandler] Already initialized');
      return;
    }

    console.log('[AIAssistantHandler] Initializing...');

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
      console.log(`[AIAssistantHandler] Found ${models.length} available models`);

      // Load existing AI contacts
      const contactCount = await this.contactManager.loadExistingAIContacts(models);
      console.log(`[AIAssistantHandler] Loaded ${contactCount} existing AI contacts`);

      // Update model info with personIds
      for (const model of models) {
        const personId = this.contactManager.getPersonIdForModel(model.id);
        if (personId) {
          model.personId = personId;
        }
      }

      // Set available models in message processor (AFTER personIds are populated)
      this.messageProcessor.setAvailableLLMModels(models);
      console.log(`[AIAssistantHandler] Updated message processor with ${models.length} models (with personIds)`);

      // Scan existing conversations for AI participants
      const topicCount = await this.topicManager.scanExistingConversations(this.contactManager);
      console.log(`[AIAssistantHandler] Scanned ${topicCount} existing AI topics`);

      // Load saved default model from persistence
      if (this.deps.settingsPersistence && models.length > 0) {
        const savedDefaultModel = await this.deps.settingsPersistence.getDefaultModelId();
        if (savedDefaultModel) {
          // Verify the saved model exists in available models
          const modelExists = models.some(m => m.id === savedDefaultModel);
          if (modelExists) {
            this.topicManager.setDefaultModel(savedDefaultModel);
            console.log(`[AIAssistantHandler] Restored saved default model: ${savedDefaultModel}`);
          } else {
            console.log(`[AIAssistantHandler] Saved model ${savedDefaultModel} not available, using fallback`);
          }
        }
      }

      // DO NOT auto-select a default model - user must choose via ModelOnboarding
      // The model should only be set when explicitly selected by the user
      if (!this.topicManager.getDefaultModel()) {
        console.log(`[AIAssistantHandler] No default model set - user must select via ModelOnboarding`);
      }

      this.initialized = true;
      console.log('[AIAssistantHandler] ✅ Initialization complete');
    } catch (error) {
      console.error('[AIAssistantHandler] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Ensure default AI chats exist (Hi and LAMA)
   */
  async ensureDefaultChats(): Promise<void> {
    console.log('[AIAssistantHandler] Ensuring default AI chats...');

    // CRITICAL: Load default model from storage first
    // The topic manager needs to know the default model before creating chats
    const config = await this.deps.llmConfigHandler?.getConfig({});
    if (config?.success && config.config?.modelName) {
      console.log(`[AIAssistantHandler] Setting default model: ${config.config.modelName}`);
      this.topicManager.setDefaultModel(config.config.modelName);
    } else {
      console.log('[AIAssistantHandler] No default model configured yet');
    }

    await this.topicManager.ensureDefaultChats(
      this.contactManager,
      async (topicId: string, modelId: string) => {
        // Callback when topic is created - generate welcome message
        await this.messageProcessor.handleNewTopic(topicId, modelId);
      }
    );

    // CRITICAL: Refresh message processor's model list after ensureDefaultChats
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
    console.log(`[AIAssistantHandler] Refreshed message processor with ${updatedModels.length} models (after ensureDefaultChats)`);
  }

  /**
   * Scan existing conversations for AI participants and register them
   */
  async scanExistingConversations(): Promise<void> {
    console.log('[AIAssistantHandler] Scanning existing conversations...');
    await this.topicManager.scanExistingConversations(this.contactManager);
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
      throw new Error('[AIAssistantHandler] Handler not initialized - call init() first');
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
      throw new Error(`[AIAssistantHandler] Model ${modelId} not found in available models`);
    }

    return await this.contactManager.ensureAIContactForModel(modelId, model.displayName || model.name);
  }

  /**
   * Set the default AI model
   */
  async setDefaultModel(modelId: string): Promise<void> {
    console.log(`[AIAssistantHandler] Setting default model: ${modelId}`);

    // Verify model exists
    const models = this.deps.llmManager?.getAvailableModels() || [];
    const model = models.find((m: any) => m.id === modelId);

    if (!model) {
      throw new Error(`[AIAssistantHandler] Model ${modelId} not found`);
    }

    this.topicManager.setDefaultModel(modelId);

    // Persist to platform-specific storage if available
    if (this.deps.settingsPersistence) {
      await this.deps.settingsPersistence.setDefaultModelId(modelId);
    }

    // Ensure default chats exist with new model (fire-and-forget)
    // Don't block setDefaultModel waiting for topic creation + welcome message generation
    this.ensureDefaultChats().catch(error => {
      console.error('[AIAssistantHandler] Failed to ensure default chats:', error);
    });
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
      throw new Error(`[AIAssistantHandler] No model ID for topic: ${topicId}`);
    }

    await this.messageProcessor.handleNewTopic(topicId, modelId);
  }

  /**
   * Shutdown the AI handler and clean up resources
   */
  async shutdown(): Promise<void> {
    console.log('[AIAssistantHandler] Shutting down...');
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
   * Returns array of {modelId, name, personId} for compatibility with chat handler
   */
  getAllContacts(): Array<{ modelId: string; name: string; personId: string | null }> {
    const models = this.deps.llmManager.getAvailableModels();

    return models.map(model => ({
      modelId: model.id,
      name: model.name,
      personId: this.contactManager.getPersonIdForModel(model.id)
    }));
  }
}
