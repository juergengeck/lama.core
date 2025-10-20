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
import { AIContactManager } from '../models/ai/AIContactManager.js';
import { AITopicManager } from '../models/ai/AITopicManager.js';
import { AITaskManager } from '../models/ai/AITaskManager.js';
import { AIPromptBuilder } from '../models/ai/AIPromptBuilder.js';
import { AIMessageProcessor } from '../models/ai/AIMessageProcessor.js';
import type { LLMPlatform } from '../services/llm-platform.js';
import type { LLMModelInfo } from '../models/ai/types.js';

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
    this.contactManager = new AIContactManager(deps.leuteModel, deps.llmObjectManager);

    this.topicManager = new AITopicManager(
      deps.topicModel,
      deps.channelManager,
      deps.leuteModel,
      deps.llmManager
    );

    this.taskManager = new AITaskManager(deps.channelManager, deps.topicAnalysisModel);

    this.promptBuilder = new AIPromptBuilder(
      deps.channelManager,
      deps.llmManager,
      this.topicManager,
      deps.contextEnrichmentService
    );

    this.messageProcessor = new AIMessageProcessor(
      deps.channelManager,
      deps.llmManager,
      deps.leuteModel,
      this.topicManager,
      deps.stateManager,
      deps.platform
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

      // Set available models in message processor
      this.messageProcessor.setAvailableLLMModels(models);

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

      // Scan existing conversations for AI participants
      const topicCount = await this.topicManager.scanExistingConversations(this.contactManager);
      console.log(`[AIAssistantHandler] Scanned ${topicCount} existing AI topics`);

      // Set default model if not already set
      if (!this.topicManager.getDefaultModel() && models.length > 0) {
        this.topicManager.setDefaultModel(models[0].id);
        console.log(`[AIAssistantHandler] Set default model: ${models[0].id}`);
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

    await this.topicManager.ensureDefaultChats(
      this.contactManager,
      async (topicId: string, modelId: string) => {
        // Callback when topic is created - generate welcome message
        await this.messageProcessor.handleNewTopic(topicId, modelId);
      }
    );
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

    // Ensure default chats exist with new model
    await this.ensureDefaultChats();
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
}
