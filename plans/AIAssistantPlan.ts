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
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('AIAssistantPlan');
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type { StoryFactory } from '@refinio/api/plan-system';
import { AIManager, type AIManagerDeps } from '../models/ai/AIManager.js';
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

  /** Optional: AI settings manager for user preferences (response length, etc.) */
  aiSettingsManager?: any;

  /** Storage functions for AIManager (to avoid module duplication in Vite worker) */
  storageDeps: AIManagerDeps;
}

/**
 * AIAssistantPlan public interface
 */
export class AIAssistantPlan {
  // Component instances
  private aiManager: AIManager;
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
    MessageBus.send('debug', 'Creating AIAssistantPlan instance');
    this.deps = deps;

    // Phase 1: Construct components with non-circular dependencies
    this.aiManager = new AIManager(deps.leuteModel, deps.storageDeps);

    this.topicManager = new AITopicManager(
      deps.topicModel,
      deps.channelManager,
      deps.leuteModel,
      deps.llmManager,
      deps.topicGroupManager,
      deps.assemblyManager,
      deps.llmObjectManager
    );

    this.taskManager = new AITaskManager(deps.channelManager, deps.topicAnalysisModel);

    this.promptBuilder = new AIPromptBuilder(
      deps.leuteModel,
      deps.channelManager,
      deps.topicModel,
      deps.llmManager,
      this.topicManager,
      this.aiManager,
      deps.contextEnrichmentService
    );

    this.messageProcessor = new AIMessageProcessor(
      deps.channelManager,
      deps.llmManager,
      deps.leuteModel,
      this.topicManager,
      this.aiManager,
      deps.topicModel,
      deps.stateManager,
      deps.platform,
      deps.topicAnalysisModel
    );

    // Initialize analysis service (abstract, reusable for chat/memory/files)
    this.analysisService = new LLMAnalysisService(deps.llmManager, deps.mcpManager);

    // CRITICAL: Inject self into messageProcessor so it calls through us, not llmManager directly
    this.messageProcessor.setAIAssistant(this);

    MessageBus.send('debug', 'AIAssistantPlan construction complete');
  }

  /**
   * Extract model family name from model ID for AI Person naming
   * Examples:
   * - "claude-sonnet-4-5" → "Claude"
   * - "gpt-4" → "GPT"
   * - "gpt-oss-20b" → "GPT"
   * - "llama-3" → "Llama"
   * @private
   */
  private _extractModelFamily(modelId: string): string {
    const parts = modelId.split('-');
    if (parts.length === 0) return modelId;

    // Get the first part (model family)
    const family = parts[0];

    // Capitalize appropriately
    if (family === 'gpt' || family === 'llm') {
      return family.toUpperCase(); // GPT, LLM
    } else if (family === 'claude') {
      return 'Claude';
    } else if (family === 'llama') {
      return 'Llama';
    } else {
      // Capitalize first letter
      return family.charAt(0).toUpperCase() + family.slice(1);
    }
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
      return;
    }

    MessageBus.send('log', 'Initializing...');

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
      const models: LLMModelInfo[] = await this.deps.llmManager?.getAvailableModels() || [];
      MessageBus.send('debug', `Found ${models.length} available models`);

      // Load existing AI and LLM Persons from storage
      const { aiCount, llmCount } = await this.aiManager.loadExisting();
      MessageBus.send('debug', `Loaded ${aiCount} AI Persons, ${llmCount} LLM Persons`);

      // Set available models in message processor
      this.messageProcessor.setAvailableLLMModels(models);

      // Load saved default model from persistence FIRST (don't gate on models.length)
      // FIX: The default model ID is stored in AISettings, independent of model availability.
      // The models list from llmManager may be empty during early init (channelManager not ready),
      // but we already have LLM Persons loaded via aiManager.loadExisting() above.
      const savedDefaultModel = await this._loadDefaultModelFromPersistence(models);

      if (savedDefaultModel) {
        MessageBus.send('debug', `Found persisted default model: ${savedDefaultModel}`);

        // Set as default immediately - trust the persistence
        this.topicManager.setDefaultModel(savedDefaultModel);

        // Ensure AI/LLM Persons exist (single source of truth - don't duplicate createLLM/createAI logic)
        await this.ensureAIForModel(savedDefaultModel);

        // Ensure topics exist and AI participants are in groups
        await this.createDefaultChats();
      }

      // Auto-select first available model on first run (when no saved default exists)
      if (!this.topicManager.getDefaultModel() && models.length > 0) {
        const firstModel = models[0];
        MessageBus.send('debug', `Auto-selecting first available model: ${firstModel.id}`);
        await this.setDefaultModel(firstModel.id);
      }

      const finalDefaultModel = this.topicManager.getDefaultModel();
      if (finalDefaultModel) {
        MessageBus.send('debug', `Default model configured: ${finalDefaultModel}`);
      }

      // Note: Scan is NOT called here because ChannelManager hasn't loaded channels yet
      // The scan will be called by AIModule AFTER ChannelManager.init() via ModuleRegistry

      this.initialized = true;
      MessageBus.send('log', 'Initialized successfully');
    } catch (error) {
      MessageBus.send('error', 'Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create default AI chats (Hi and LAMA)
   * Called when user selects a default model
   */
  private async createDefaultChats(): Promise<void> {
    const defaultModel = this.topicManager.getDefaultModel();
    if (!defaultModel) {
      throw new Error('Cannot create default chats - no default model set');
    }

    MessageBus.send('debug', `Creating default chats with model: ${defaultModel}`);

    await this.topicManager.ensureDefaultChats(
      this.aiManager,
      async (topicId: string, aiPersonId: SHA256IdHash<Person>) => {
        // Callback when topic is created - generate welcome message
        await this.messageProcessor.handleNewTopic(topicId, aiPersonId);
      }
    );

    // Refresh message processor's model list after chat creation
    const updatedModels: LLMModelInfo[] = await this.deps.llmManager?.getAvailableModels() || [];
    this.messageProcessor.setAvailableLLMModels(updatedModels);
  }

  /**
   * Scan existing conversations for AI participants and register them
   */
  async scanExistingConversations(): Promise<number> {
    MessageBus.send('debug', 'Scanning existing conversations...');
    const count = await this.topicManager.scanExistingConversations(this.aiManager);
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
   * Get the model ID for a topic by resolving AI Person → LLM Person → Model ID
   */
  async getModelIdForTopic(topicId: string): Promise<string | null> {
    const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
    if (!aiPersonId) {
      return null;
    }

    try {
      // Resolve AI Person → LLM Person (follows delegation chain)
      const llmPersonId = await this.aiManager.resolveLLMPerson(aiPersonId);

      // Get LLM entity ID (llm:modelId)
      const llmId = this.aiManager.getEntityId(llmPersonId);
      if (!llmId || !llmId.startsWith('llm:')) {
        return null;
      }

      return llmId.replace(/^llm:/, ''); // Strip llm: prefix
    } catch (error) {
      MessageBus.send('error', `Failed to resolve model ID for topic ${topicId}:`, error);
      return null;
    }
  }

  /**
   * Check if a person ID is an AI person
   */
  isAIPerson(personId: SHA256IdHash<Person>): boolean {
    return this.aiManager.isAI(personId);
  }

  /**
   * Check if a topic has any LLM participants.
   *
   * The AITopicManager registry is the source of truth - if the topic isn't registered, it doesn't have AI.
   */
  async topicHasLLMParticipant(topicId: string): Promise<boolean> {
    return this.topicManager.isAITopic(topicId);
  }

  /**
   * Get entity ID for a person ID (reverse lookup)
   * Returns "ai:{aiId}" or "llm:{modelId}"
   */
  getEntityIdForPersonId(personId: SHA256IdHash<Person>): string | null {
    return this.aiManager.getEntityId(personId);
  }

  /**
   * Get model ID for a person ID (reverse lookup)
   * Extracts the model ID from the entity ID naming convention
   *
   * @param personId - Person ID hash to look up
   * @returns Model ID (e.g., "gpt-oss:20b") or null if not found
   */
  getModelIdForPersonId(personId: SHA256IdHash<Person>): string | null {
    return this.aiManager.getModelIdForPersonId(personId);
  }

  /**
   * Ensure an AI Person exists for a specific model
   * Creates both LLM Person and AI Person with delegation
   * @param modelId - The model ID (e.g., 'gpt-oss:20b')
   * @param customName - Optional custom display name for the AI (e.g., 'frieda')
   * @param customEmail - Optional custom email for the AI (e.g., 'frieda@ai.local')
   */
  async ensureAIForModel(modelId: string, customName?: string, customEmail?: string): Promise<SHA256IdHash<Person>> {
    // Try to find model info from storage
    const models = await this.deps.llmManager?.getAvailableModels() || [];
    const model = models.find((m: any) => m.id === modelId);

    // Use custom name if provided, otherwise use model info or derive from modelId
    // Models may not be in storage yet (e.g., fresh install with Ollama models)
    const displayName = customName || model?.displayName || model?.name || modelId;
    const provider = model?.provider || (modelId.includes('claude') ? 'claude' : 'ollama');

    // Create LLM Profile if doesn't exist (keep detailed name for LLM)
    // createLLM returns the Profile idHash directly
    // Pass customEmail to allow multiple Persons using the same model
    const llmProfileId = await this.aiManager.createLLM(modelId, displayName, provider, undefined, undefined, customEmail);

    if (!llmProfileId) {
      throw new Error(`[AIAssistantPlan] createLLM returned undefined for model: ${modelId}`);
    }

    // Extract model family for AI Person name (e.g., "GPT", "Claude", "Llama")
    // Use custom name if provided
    const familyName = customName || this._extractModelFamily(modelId);

    // Create AI Person if doesn't exist (use family name, not full model name)
    // Use custom email in the ID to make it unique when user specifies custom name
    const aiId = customEmail ? `ai-${customEmail.replace('@', '-at-')}` : `started-as-${modelId}`;
    let aiPersonId = this.aiManager.getPersonId(`ai:${aiId}`);
    if (!aiPersonId) {
      // AIManager.createAI() returns Person idHash directly
      aiPersonId = await this.aiManager.createAI(aiId, familyName, llmProfileId);
      MessageBus.send('debug', `Created AI Person: ${aiId} (${familyName})`);
    }

    return aiPersonId;
  }

  /**
   * Set the default AI model and create default chats
   * Called when user selects a model in ModelOnboarding
   * @param modelId - The model ID
   * @param displayName - Optional custom display name for the AI contact
   * @param email - Optional custom email for the AI contact
   */
  async setDefaultModel(modelId: string, displayName?: string, email?: string): Promise<void> {
    MessageBus.send('debug', `Setting default model: ${modelId}`);

    // Set as default immediately - topicManager uses modelId directly
    this.topicManager.setDefaultModel(modelId);

    // Persist the model
    if (this.deps.settingsPersistence) {
      await this.deps.settingsPersistence.setDefaultModelId(modelId);
    }

    // CRITICAL: Ensure AI and LLM Persons exist before creating chats
    // This sets up the delegation chain needed for welcome message generation
    await this.ensureAIForModel(modelId, displayName, email);

    // Wait for topics to be created so they appear in conversation list immediately
    // (Welcome messages still generate in background via callbacks)
    try {
      await this.createDefaultChats();
    } catch (err) {
      MessageBus.send('error', 'createDefaultChats failed:', err);
    }

    MessageBus.send('log', `Default model set: ${modelId}`);
  }

  /**
   * Switch a topic to use a different LLM model
   * Keeps the same AI Person (conversation identity) but changes which LLM it delegates to
   */
  async switchTopicModel(topicId: string, modelId: string): Promise<void> {
    MessageBus.send('debug', `Switching topic ${topicId} to LLM model ${modelId}`);

    // Verify topic is an AI topic
    if (!this.topicManager.isAITopic(topicId)) {
      throw new Error(`Cannot switch model - topic ${topicId} is not an AI topic`);
    }

    // Get the AI Person for this topic
    const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
    if (!aiPersonId) {
      throw new Error(`No AI Person found for topic ${topicId}`);
    }

    // Get the AI ID from the Person
    const aiId = this.aiManager.getEntityId(aiPersonId);
    if (!aiId || !aiId.startsWith('ai:')) {
      throw new Error(`Invalid AI Person for topic ${topicId}`);
    }

    // Get or create LLM Profile for the new model
    const models = await this.deps.llmManager?.getAvailableModels() || [];
    const model = models.find((m: any) => m.id === modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found in available models`);
    }

    const displayName = model.displayName || model.name || modelId;
    const provider = model.provider || 'unknown';

    // Get or create LLM Profile
    // createLLM returns the Profile idHash directly
    const llmProfileId = await this.aiManager.createLLM(modelId, displayName, provider);

    // Update the AI's delegation to point to the new LLM Profile
    await this.aiManager.setAIDelegation(aiId.replace('ai:', ''), llmProfileId);

    MessageBus.send('debug', `Topic ${topicId} now delegates to ${modelId}`);
  }

  /**
   * Get the default AI model
   */
  async getDefaultModel(): Promise<any | null> {
    const modelId = this.topicManager.getDefaultModel();
    if (!modelId) {
      return null;
    }

    const models = await this.deps.llmManager?.getAvailableModels() || [];
    return models.find((m: any) => m.id === modelId) || null;
  }

  /**
   * Register an AI topic with its AI Person
   */
  registerAITopic(topicId: string, aiPersonId: SHA256IdHash<Person>): void {
    this.topicManager.registerAITopic(topicId, aiPersonId);
  }

  /**
   * Rename an AI chat, preserving past identities
   * Creates a new Person/Profile while keeping the old one as a past identity
   *
   * @param topicId - Topic ID to rename
   * @param newName - New display name
   */
  async renameAIChat(topicId: string, newName: string): Promise<void> {
    MessageBus.send('debug', `Renaming AI chat: ${topicId} → ${newName}`);

    // Get the AI Person for this topic
    const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
    if (!aiPersonId) {
      throw new Error(`[AIAssistantPlan] Topic ${topicId} is not an AI topic`);
    }

    // Get the AI entity ID
    const aiId = this.aiManager.getEntityId(aiPersonId);
    if (!aiId || !aiId.startsWith('ai:')) {
      throw new Error(`[AIAssistantPlan] Invalid AI entity ID: ${aiId}`);
    }

    // Rename the AI (creates new Person/Profile, preserves old as past identity)
    const aiIdWithoutPrefix = aiId.replace(/^ai:/, '');
    await this.aiManager.renameAI(aiIdWithoutPrefix, newName);
  }

  /**
   * Get past identities for an AI chat
   *
   * @param topicId - Topic ID
   * @returns Array of {personId, name} for past identities
   */
  async getPastIdentities(topicId: string): Promise<Array<{personId: SHA256IdHash<Person>, name: string}>> {
    // Get the AI Person for this topic
    const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
    if (!aiPersonId) {
      return [];
    }

    // Get the AI entity ID
    const aiId = this.aiManager.getEntityId(aiPersonId);
    if (!aiId || !aiId.startsWith('ai:')) {
      return [];
    }

    // Get past identities
    const aiIdWithoutPrefix = aiId.replace(/^ai:/, '');
    return await this.aiManager.getPastIdentities(aiIdWithoutPrefix);
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
    const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
    if (!aiPersonId) {
      throw new Error(`[AIAssistantPlan] No AI Person for topic: ${topicId}`);
    }

    await this.messageProcessor.handleNewTopic(topicId, aiPersonId);
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

    // Read maxTokens from user settings
    const maxTokens = await this.getResponseLength();

    // All LLM calls go through here - we can add middleware, logging, etc.
    const optionsWithSettings = { ...options, maxTokens, topicId };
    return await this.deps.llmManager.chat(history, modelId, optionsWithSettings);
  }

  /**
   * Chat with LLM and get analysis (response + subjects/keywords)
   * This is the ONLY way AIMessageProcessor should get analyzed responses
   *
   * NON-BLOCKING: Returns immediately after starting Phase 1 streaming
   * Phase 2 analytics run in background and deliver results via onAnalysis callback
   *
   * @param history - Conversation history
   * @param modelId - LLM model ID
   * @param options - Streaming and analysis options
   * @returns {streaming: true, topicId} immediately while streaming continues
   */
  async chatWithAnalysis(
    history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    modelId: string,
    options?: {
      topicId?: string;
      priority?: number;
      onStream?: (chunk: string) => void;
      onThinkingStream?: (chunk: string) => void;
      onProgress?: (status: string) => void;
      onAnalysis?: (analysis: { keywords: string[]; description?: string; summaryUpdate?: string }) => void;
      onComplete?: (result: { response: string; thinking?: string; analysis?: any }) => void;
    }
  ): Promise<any> {
    if (!this.initialized) {
      throw new Error('[AIAssistantPlan] Plan not initialized - call init() first');
    }

    if (!this.deps.llmManager) {
      throw new Error('[AIAssistantPlan] LLM Manager not available');
    }

    const startTime = Date.now();
    const topicId = options?.topicId;
    MessageBus.send('debug', `chatWithAnalysis starting for model: ${modelId}, topicId: ${topicId || 'none'}`);

    // Read maxTokens from user settings
    const maxTokens = await this.getResponseLength();

    // ═══════════════════════════════════════════════════════════════════
    // THREE-PHASE REACT PATTERN WITH TRANSPARENT PROGRESS
    // ═══════════════════════════════════════════════════════════════════
    // PHASE 0: Tool Evaluation & Context Gathering
    //          - Check if MCP tools should be used
    //          - Execute tools with progress updates
    //          - Collect results for Phase 1 context
    // PHASE 1: Stream natural language response
    //          - Real-time UX via onStream callback
    //          - Uses tool results from Phase 0
    //          - Caches context automatically
    // PHASE 2: Background analytics (structured output)
    //          - Extract keywords/subjects
    //          - Results via onAnalysis callback
    // ═══════════════════════════════════════════════════════════════════

    // ✅ PHASE 0: Tool evaluation and context gathering
    options?.onProgress?.('Analyzing context...');

    let toolResults: string | null = null;
    let enhancedHistory = [...history];

    // Check if we should use MCP tools (only if tools are available and enabled)
    const hasMCPTools = this.deps.llmManager.getMCPToolCount && this.deps.llmManager.getMCPToolCount() > 0;

    if (hasMCPTools && topicId) {
      try {
        options?.onProgress?.('Checking recent subjects...');

        // Call LLM to determine if tools should be used and which ones
        // This uses the normal chat flow which includes tool processing
        const toolEvalResponse = await this.deps.llmManager.chat(history, modelId, {
          topicId,
          maxTokens,
          temperature: 0.3, // Lower temp for more deterministic tool selection
          // Don't disable tools here - we WANT tool calls in Phase 0
        });

        // Extract tool results if any were executed
        if (typeof toolEvalResponse === 'object' && toolEvalResponse !== null) {
          if ('_toolResults' in toolEvalResponse) {
            toolResults = (toolEvalResponse as any)._toolResults;
            options?.onProgress?.('Context gathered successfully');
          }
        }

        // Add tool results to conversation history for Phase 1
        if (toolResults) {
          enhancedHistory = [
            ...history,
            {
              role: 'user' as const,
              content: `Context from analysis:\n${toolResults}\n\nPlease use this context to provide a natural, conversational response.`
            }
          ];
        }

        const phase0Time = Date.now() - startTime;
        MessageBus.send('debug', `Phase 0 complete (${phase0Time}ms)${toolResults ? ' - context gathered' : ''}`);
      } catch (error) {
        MessageBus.send('alert', 'Phase 0 tool evaluation failed:', error);
        options?.onProgress?.('Continuing without additional context...');
        // Continue to Phase 1 anyway - don't block on tool failures
      }
    }

    // ✅ PHASE 1: Start streaming (DON'T AWAIT - non-blocking)
    options?.onProgress?.('Generating response...');

    const responsePromise = this.deps.llmManager.chat(enhancedHistory, modelId, {
      topicId, // CRITICAL: Enables context caching
      maxTokens,
      onStream: options?.onStream, // UI gets chunks in real-time
      onThinkingStream: options?.onThinkingStream, // Thinking stream
      temperature: 0.7, // Normal temp for user-facing response
      disableTools: true // ✅ Disable tools to get clean streaming text (not JSON)
    });

    // ✅ Background: Chain Phase 2 after Phase 1 completes
    responsePromise.then(async (response) => {
      const phase1Time = Date.now() - startTime;
      MessageBus.send('debug', `Phase 1 complete (${phase1Time}ms)`);

      // Extract actual response content and thinking
      let actualResponse = '';
      let thinking: string | undefined;
      if (typeof response === 'object' && response !== null && 'content' in response) {
        actualResponse = (response as any).content; // Handle {content, thinking, context} format
        thinking = (response as any).thinking;
      } else {
        actualResponse = String(response);
      }

      let analysis: any = undefined;

      // ✅ PHASE 2: Run analytics with cached context (if topicId provided)
      if (topicId && options?.onAnalysis) {

        try {
          // Import Phase 2 analytics prompt (JSON structured output)
          const { PHASE2_ANALYTICS_PROMPT } = await import('../constants/system-prompts.js');

          // Build analytics conversation with structured prompt
          const analyticsHistory = [
            { role: 'system' as const, content: PHASE2_ANALYTICS_PROMPT },
            ...history.slice(-3) // Use recent conversation for context
          ];

          // Use cached context for analytics (3-12x faster!)
          const analyticsResponse = await this.deps.llmManager.chat(
            analyticsHistory,
            modelId,
            {
              topicId, // Reuses cached context from Phase 1
              maxTokens,
              temperature: 0.3, // Lower temp for deterministic extraction
              disableTools: true // No tool calls needed for analytics
            }
          );

          const jsonResponse = typeof analyticsResponse === 'string'
            ? analyticsResponse
            : (typeof analyticsResponse === 'object' && 'content' in analyticsResponse)
              ? (analyticsResponse as any).content
              : JSON.stringify(analyticsResponse);

          const parsedAnalysis = JSON.parse(jsonResponse);

          analysis = {
            keywords: parsedAnalysis.keywords || [],
            description: parsedAnalysis.description
          };

          const totalTime = Date.now() - startTime;
          MessageBus.send('debug', `Phase 2 complete (${totalTime}ms) - keywords: ${analysis.keywords.length}`);

          // ✅ Deliver analysis to UI via callback
          options.onAnalysis(analysis);

        } catch (error) {
          MessageBus.send('alert', 'Phase 2 analytics failed:', error);
          // Deliver empty analysis on error
          analysis = { keywords: [] };
          if (options.onAnalysis) {
            options.onAnalysis(analysis);
          }
        }
      }

      // ✅ COMPLETION: Call onComplete with consolidated state (response + thinking + analysis)
      if (options?.onComplete) {
        options.onComplete({
          response: actualResponse,
          thinking,
          analysis
        });
      }
    }).catch(error => {
      MessageBus.send('error', 'Phase 1 failed:', error);
      // Phase 1 failed - can't run Phase 2
    });

    // ✅ Return immediately - streaming already started
    return {
      streaming: true,
      topicId
    };
  }

  /**
   * Set maximum response length (in tokens)
   * Updates AISettings.maxTokens for the user
   */
  async setResponseLength(maxTokens: number): Promise<void> {
    await this.deps.aiSettingsManager.updateSettings({ maxTokens });
    MessageBus.send('debug', `Response length set to ${maxTokens} tokens`);
  }

  /**
   * Get current maximum response length (in tokens)
   * Returns value from AISettings
   */
  async getResponseLength(): Promise<number> {
    const settings = await this.deps.aiSettingsManager.getSettings();
    return settings.maxTokens;
  }

  /**
   * Shutdown the AI plan and clean up resources
   */
  async shutdown(): Promise<void> {
    MessageBus.send('log', 'Shutting down...');
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
   * Get AI manager (for testing/debugging)
   */
  getAIManager(): AIManager {
    return this.aiManager;
  }

  /**
   * Set the StoryFactory for Assembly tracking
   * Wraps AIManager with a Proxy that auto-creates Stories for createAI/createLLM
   */
  async setStoryFactory(factory: StoryFactory): Promise<void> {
    const myId = await this.deps.leuteModel.myMainIdentity();

    // Wrap aiManager with auto-Story creation
    this.aiManager = await factory.registerPlanInstance({
      instance: this.aiManager,
      plan: {
        id: AIManager.PLAN_ID,
        name: AIManager.PLAN_NAME,
        description: AIManager.PLAN_DESCRIPTION,
        domain: AIManager.PLAN_DOMAIN
      },
      methods: {
        createAI: { product: 'idHash', title: 'Create AI Contact' },
        createLLM: { product: 'idHash', title: 'Create LLM Profile' },
        loadExisting: { tracked: false }
      },
      owner: myId,
      instanceVersion: `instance-${Date.now()}`
    });
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
   * Get all AI Persons with their delegation information
   * Returns array of {aiId, name, aiPersonId, llmPersonId} for chat plan
   */
  async getAllAIPersons(): Promise<Array<{
    aiId: string;
    name: string;
    aiPersonId: SHA256IdHash<Person>;
    llmPersonId: SHA256IdHash<Person> | null;
  }>> {
    // This would require iterating through all AI Persons in storage
    // For now, return empty array - proper implementation needed
    return [];
  }
}
