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
import { AIManager, type AIManagerDeps, type AIPersonality } from '../models/ai/AIManager.js';
import { AITopicManager } from '../models/ai/AITopicManager.js';
import { AITaskManager } from '../models/ai/AITaskManager.js';
import { AIPromptBuilder } from '../models/ai/AIPromptBuilder.js';
import { AIMessageProcessor } from '../models/ai/AIMessageProcessor.js';
import type { LLMPlatform } from '../services/llm-platform.js';
import type { LLMModelInfo } from '../models/ai/types.js';
import { LLMAnalysisService } from '../services/analysis-service.js';
import type { AnalysisContent, AnalysisContext } from '../services/analysis-service.js';


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

  /** Optional: MCP manager for memory context (Node.js only) */
  mcpManager?: any;

  /** AI settings manager for user preferences (required) */
  aiSettingsManager: any;

  /** Optional: Local model lookup for on-device models (platform-specific) */
  localModelLookup?: (modelId: string) => Promise<{ displayName: string; provider: string } | null>;

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

  // Default AI Person ID (set when AI creation completes)
  // This is stored separately from model because AI identity is independent of model per design
  private _defaultAIPersonId: SHA256IdHash<Person> | null = null;

  // Private AI Person ID for LAMA chat (uses aiId-private suffix for separate identity)
  private _privateAIPersonId: SHA256IdHash<Person> | null = null;

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

    this.taskManager = new AITaskManager(deps.channelManager, deps.leuteModel, deps.topicAnalysisModel);

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
      const topic = await this.deps.topicModel.findTopic(topicId);
      return !!topic;
    } catch (e) {
      return false;
    }
  }

  /**
   * Load default model from AISettingsManager (ONE.core storage)
   * @private
   */
  private async _loadDefaultModelFromPersistence(_models: LLMModelInfo[]): Promise<string | null> {
    if (!this.deps.aiSettingsManager) {
      throw new Error('AISettingsManager is required');
    }
    return await this.deps.aiSettingsManager.getDefaultModelId();
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

      // Backfill: Create LLM objects for existing AIs that don't have them
      // This ensures LLMObjectManager cache is populated for isLLMPerson() checks
      if (this.deps.llmObjectManager && aiCount > 0) {
        const existingAIs = this.aiManager.getAllAIs();
        for (const ai of existingAIs) {
          if (ai.modelId && ai.personId) {
            // Check if LLM object already exists for this AI
            const existingLLM = await this.deps.llmObjectManager.getByModelId(ai.modelId);
            if (!existingLLM) {
              MessageBus.send('debug', `Backfilling LLM object for ${ai.displayName} (${ai.modelId})`);
              await this.deps.llmObjectManager.create({
                modelId: ai.modelId,
                name: ai.displayName,
                server: ai.modelId.startsWith('ollama:') ? 'http://localhost:11434' : '',
                aiPersonId: ai.personId
              });
            }
          }
        }
      }

      // Set available models in message processor
      this.messageProcessor.setAvailableLLMModels(models);

      // Load saved default model from persistence FIRST (don't gate on models.length)
      // FIX: The default model ID is stored in AISettings, independent of model availability.
      // The models list from llmManager may be empty during early init (channelManager not ready),
      // but we already have LLM Persons loaded via aiManager.loadExisting() above.
      const savedDefaultModel = await this._loadDefaultModelFromPersistence(models);
      console.log(`[AIAssistantPlan.init] savedDefaultModel: ${savedDefaultModel}`);
      console.log(`[AIAssistantPlan.init] aiByPerson map size: ${this.aiManager.getAllAIs().length}`);

      if (savedDefaultModel) {
        MessageBus.send('debug', `Found persisted default model: ${savedDefaultModel}`);

        // Set as default immediately - trust the persistence
        this.topicManager.setDefaultModel(savedDefaultModel);

        // Check if AI already exists for this model (loaded via loadExisting above)
        // If so, skip ensureAIForModel since we don't have the AI creation email
        const existingAIs = this.aiManager.getAllAIs();
        console.log(`[AIAssistantPlan.init] existingAIs: ${existingAIs.map(ai => `${ai.aiId}(${ai.modelId})`).join(', ')}`);
        // Find the PUBLIC AI (exclude -private suffix to avoid finding private AI first)
        const aiForModel = existingAIs.find(ai =>
          ai.modelId === savedDefaultModel &&
          ai.active &&
          !ai.aiId.endsWith('-private')
        );
        console.log(`[AIAssistantPlan.init] aiForModel: ${aiForModel?.aiId || 'NOT FOUND'}`);

        if (aiForModel) {
          MessageBus.send('debug', `Found existing AI for model ${savedDefaultModel}: ${aiForModel.aiId}`);

          // Also find the private AI (aiId with -private suffix)
          const privateAiId = `${aiForModel.aiId}-private`;
          console.log(`[AIAssistantPlan.init] Looking for privateAiId: ${privateAiId}`);
          const privateAI = existingAIs.find(ai => ai.aiId === privateAiId && ai.active);
          console.log(`[AIAssistantPlan.init] privateAI: ${privateAI?.aiId || 'NOT FOUND'}`);

          if (privateAI) {
            // CRITICAL: Set both AI Person IDs from loaded data
            this._defaultAIPersonId = aiForModel.personId;
            this._privateAIPersonId = privateAI.personId;
            console.log(`[AIAssistantPlan.init] Both AIs found, calling createDefaultChats()`);
            console.log(`[AIAssistantPlan.init] _defaultAIPersonId: ${this._defaultAIPersonId}`);
            console.log(`[AIAssistantPlan.init] _privateAIPersonId: ${this._privateAIPersonId}`);
            // Ensure topics exist and AI participants are in groups
            await this.createDefaultChats();
            console.log(`[AIAssistantPlan.init] createDefaultChats() completed`);
          } else {
            // Private AI not found - may be legacy data before -private was introduced
            // Still set the default to prevent blocking, but log warning
            console.log(`[AIAssistantPlan.init] No private AI found (${privateAiId}) - legacy data, skipping createDefaultChats`);
            MessageBus.send('debug', `No private AI found (${privateAiId}) - legacy data, will create on next AI creation`);
            this._defaultAIPersonId = aiForModel.personId;
            // Skip createDefaultChats since we don't have both IDs
            // UI should show properly with just the existing topics
          }
        } else {
          // No AI exists for this model - AI creation was incomplete
          // Clear the saved model so UI shows onboarding again
          console.log(`[AIAssistantPlan.init] No AI found for saved model ${savedDefaultModel} - clearing default`);
          MessageBus.send('debug', `No AI found for saved model ${savedDefaultModel} - creation incomplete, clearing default`);
          this.topicManager.setDefaultModel(null);
          await this.deps.aiSettingsManager.setDefaultModelId(null);
        }
      } else {
        console.log(`[AIAssistantPlan.init] No savedDefaultModel - showing onboarding`);
      }

      // DO NOT auto-select first available model during init - let UI show onboarding
      // When user later configures a model and no default exists, that model becomes default
      // (handled in LLMConfigPlan.setConfig)
      if (!this.topicManager.getDefaultModel() && models.length > 0) {
        MessageBus.send('debug', `No default model - UI will show onboarding (${models.length} models available)`);
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

    // Get both AI Person IDs - must exist (set by setDefaultModel after AI creation)
    const aiPersonId = this._defaultAIPersonId;
    const privateAIPersonId = this._privateAIPersonId;
    if (!aiPersonId) {
      throw new Error('[AIAssistantPlan] No default AI Person ID - setDefaultModel must be called with AI creation data first');
    }
    if (!privateAIPersonId) {
      throw new Error('[AIAssistantPlan] No private AI Person ID - setDefaultModel must be called with AI creation data first');
    }

    await this.topicManager.ensureDefaultChats(
      aiPersonId,
      privateAIPersonId,
      async (topicId: string, personId: SHA256IdHash<Person>) => {
        // Callback when topic is created - generate welcome message
        await this.messageProcessor.handleNewTopic(topicId, personId);
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
   * @param topicId - The topic ID
   * @param message - The message text
   * @param senderId - The sender's Person ID
   * @param aiPersonId - Optional: specific AI to respond (from settings-based routing)
   */
  async processMessage(
    topicId: string,
    message: string,
    senderId: SHA256IdHash<Person>,
    aiPersonId?: SHA256IdHash<Person>
  ): Promise<string | null> {
    if (!this.initialized) {
      throw new Error('[AIAssistantPlan] Plan not initialized - call init() first');
    }

    return await this.messageProcessor.processMessage(topicId, message, senderId, aiPersonId);
  }

  /**
   * Check if a topic is an AI topic
   */
  isAITopic(topicId: string): boolean {
    return this.topicManager.isAITopic(topicId);
  }

  /**
   * Get the model ID for a topic by resolving AI Person → modelId
   */
  async getModelIdForTopic(topicId: string): Promise<string | null> {
    const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
    if (!aiPersonId) {
      return null;
    }

    // Get modelId directly from AI object
    return this.aiManager.getModelIdForAI(aiPersonId);
  }

  /**
   * Get the AI Person ID for a topic
   * This is used by the UI to pass to switchAIModel()
   *
   * @param topicId - The topic ID
   * @returns AI Person ID hash as string, or null if not an AI topic
   */
  getAIPersonForTopic(topicId: string): string | null {
    const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
    return aiPersonId ? aiPersonId.toString() : null;
  }

  /**
   * Check if a person ID is an AI person
   */
  isAIPerson(personId: SHA256IdHash<Person>): boolean {
    return this.aiManager.isAI(personId);
  }

  /**
   * Check if an LLM object exists for a given modelId
   * Returns true if model is "available" (has been registered)
   */
  hasLLM(modelId: string): boolean {
    return this.aiManager.hasLLM(modelId);
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
   * Get AI ID for a person ID (reverse lookup)
   * Returns AI ID (e.g., "dreizehn") or null
   */
  getAIIdForPersonId(personId: SHA256IdHash<Person>): string | null {
    return this.aiManager.getAIId(personId);
  }

  /**
   * Get model ID for a person ID (reverse lookup)
   *
   * @param personId - Person ID hash to look up
   * @returns Model ID (e.g., "gpt-oss:20b") or null if not found
   */
  getModelIdForPersonId(personId: SHA256IdHash<Person>): string | null {
    return this.aiManager.getModelIdForAI(personId);
  }

  /**
   * Get AI object by person ID hash string
   *
   * @param personIdHash - Person ID hash as string (UI-facing)
   * @returns AI object with personality, displayName, etc. or null if not found
   */
  getAIByPersonIdHash(personIdHash: string): {
    aiId: string;
    displayName: string;
    modelId: string;
    personality?: {
      creationContext?: { device: string; locale: string; time: number; app: string };
      traits?: string[];
      systemPromptAddition?: string;
    };
  } | null {
    const ai = this.aiManager.getAI(personIdHash as SHA256IdHash<Person>);
    if (!ai) return null;
    return {
      aiId: ai.aiId,
      displayName: ai.displayName,
      modelId: ai.modelId,
      personality: ai.personality
    };
  }

  /**
   * Update AI personality (system prompt addition, traits)
   *
   * @param personIdHash - AI Person ID hash as string (UI-facing)
   * @param personality - Partial personality update
   */
  async updateAIPersonality(
    personIdHash: string,
    personality: { systemPromptAddition?: string; traits?: string[] }
  ): Promise<void> {
    await this.aiManager.updatePersonality(personIdHash as SHA256IdHash<Person>, personality);
  }

  /**
   * Ensure an AI Person exists for a specific model
   * Creates AI Person with modelId directly (no LLM object needed)
   * @param modelId - The model ID (e.g., 'gpt-oss:20b')
   * @param customName - Display name for the AI (from AI creation)
   * @param customEmail - Email for the AI (from AI creation) - REQUIRED
   * @param personality - Optional personality configuration (creationContext, traits)
   */
  async ensureAIForModel(
    modelId: string,
    customName?: string,
    customEmail?: string,
    personality?: AIPersonality
  ): Promise<SHA256IdHash<Person>> {
    if (!customEmail) {
      throw new Error(`[AIAssistantPlan] ensureAIForModel requires customEmail - AI creation must generate email first`);
    }

    // AI identity: email prefix (e.g., "dreizehn" from "dreizehn@gecko-macbook.local")
    const aiId = customEmail.split('@')[0];

    // Display name: use provided name or derive from modelId
    const displayName = customName || this._extractModelFamily(modelId);

    // Check if AI already exists
    const existingAI = this.aiManager.getAIByAiId(aiId);
    if (existingAI) {
      // Update modelId if different
      if (existingAI.modelId !== modelId) {
        MessageBus.send('debug', `Updating AI ${aiId} modelId: ${existingAI.modelId} → ${modelId}`);
        await this.aiManager.updateModelId(existingAI.personId, modelId);
      }
      // CRITICAL: Ensure AI's Someone is in LeuteModel
      // Fixes bug where AI exists in cache but Someone wasn't added to Leute
      // (can happen if Leute was cleared but AIList persisted in storage)
      await this.aiManager.ensureSomeoneInLeute(existingAI);
      return existingAI.personId;
    }

    // Create AI Person with modelId and personality
    const result = await this.aiManager.createAI(aiId, displayName, undefined, modelId, personality);
    MessageBus.send('debug', `Created AI Person: ${aiId} (${displayName}) with modelId: ${modelId}`);

    // CRITICAL: Create LLM object linking personId to modelId
    // This is what LLMObjectManager.loadLLMObjectsFromStorage() queries to populate the cache
    if (this.deps.llmObjectManager) {
      await this.deps.llmObjectManager.create({
        modelId,
        name: displayName,
        server: modelId.startsWith('ollama:') ? 'http://localhost:11434' : '',
        aiPersonId: result.personIdHash
      });
      MessageBus.send('debug', `Created LLM object for ${displayName} (${modelId})`);
    }

    // Create Assembly for AI contact creation (journal entry) - fire and forget
    if (this.deps.assemblyManager?.createAIContactAssembly) {
      this.deps.assemblyManager.createAIContactAssembly(
        result.personIdHash,
        displayName,
        modelId
      ).then(() => {
        MessageBus.send('debug', `Created Assembly for AI creation: ${displayName}`);
      }).catch((error: any) => {
        // Don't fail AI creation if assembly creation fails
        MessageBus.send('warn', `Failed to create Assembly for AI creation:`, error);
      });
    }

    return result.personIdHash;
  }

  /**
   * Set the default AI model and create default chats
   * Called when user selects a model in ModelOnboarding
   *
   * REQUIRES AI creation to have completed first - email is mandatory.
   * Per design: AI identity is {name}@{device}.local, aiId = email prefix (no ai- prefix, no started-as- patterns)
   *
   * @param modelId - The model ID
   * @param displayName - Display name for the AI contact (from AI creation)
   * @param email - Email for the AI contact (from AI creation) - REQUIRED
   */
  async setDefaultModel(modelId: string, displayName: string, email: string): Promise<void> {
    if (!email) {
      throw new Error('[AIAssistantPlan] setDefaultModel requires email - AI creation must complete first');
    }
    if (!displayName) {
      throw new Error('[AIAssistantPlan] setDefaultModel requires displayName - AI creation must complete first');
    }
    MessageBus.send('debug', `Setting default model: ${modelId} for AI: ${displayName} (${email})`);

    // Set as default immediately - topicManager uses modelId directly
    this.topicManager.setDefaultModel(modelId);

    // Persist the model to ONE.core storage
    await this.deps.aiSettingsManager.setDefaultModelId(modelId);

    // Create personality with creation context
    // Note: In React Native, navigator exists but userAgent/language may be undefined
    const personality: AIPersonality = {
      creationContext: {
        device: (typeof navigator !== 'undefined' && navigator.userAgent) || 'mobile',
        locale: (typeof navigator !== 'undefined' && navigator.language) || 'en',
        time: Date.now(),
        app: 'lama'
      }
      // traits and systemPromptAddition can be added later by user
    };

    // CRITICAL: Ensure AI and LLM Persons exist before creating chats
    // This sets up the delegation chain needed for welcome message generation
    const aiPersonId = await this.ensureAIForModel(modelId, displayName, email, personality);

    // Create PRIVATE AI Person for LAMA chat (separate identity with -private suffix)
    // This creates a different Person object, enabling separate P2P topic
    const [emailUser, emailDomain] = email.split('@');
    const privateEmail = `${emailUser}-private@${emailDomain}`;
    const privatePersonId = await this.ensureAIForModel(
      modelId,
      `${displayName} (private)`,  // Private AI has "(private)" suffix in name
      privateEmail,
      personality
    );

    // Store both AI Person IDs
    this._defaultAIPersonId = aiPersonId;
    this._privateAIPersonId = privatePersonId;

    // Wait for topics to be created so they appear in conversation list immediately
    // (Welcome messages still generate in background via callbacks)
    // CRITICAL: No try/catch - fail fast if topic creation fails
    await this.createDefaultChats();

    MessageBus.send('log', `Default model set: ${modelId}, default AI: ${aiPersonId}, private AI: ${privatePersonId}`);
  }

  /**
   * Switch an AI Person to use a different model
   * AI identity persists, only the model changes
   *
   * @param aiPersonId - The AI Person ID (participant in conversation)
   * @param modelId - New model ID (e.g., "claude-sonnet-4", "granite:3b")
   */
  async switchAIModel(aiPersonId: SHA256IdHash<Person>, modelId: string): Promise<void> {
    // Strip local: prefix if present (legacy)
    const effectiveModelId = modelId.startsWith('local:') ? modelId.slice(6) : modelId;

    MessageBus.send('debug', `Switching AI ${aiPersonId.toString().substring(0, 8)}... to model ${effectiveModelId}`);

    await this.aiManager.updateModelId(aiPersonId, effectiveModelId);
  }

  /**
   * Get the default AI model
   * Returns the configured model info, or a minimal object with just the ID if
   * the model isn't currently available (e.g., Ollama not running).
   * Returns null only if no default model was ever configured.
   */
  async getDefaultModel(): Promise<any | null> {
    const modelId = this.topicManager.getDefaultModel();
    if (!modelId) {
      return null;
    }

    // Try to find full model info from available models
    const models = await this.deps.llmManager?.getAvailableModels() || [];
    const fullModel = models.find((m: any) => m.id === modelId);

    // Return full model if available, otherwise return minimal object
    // This ensures UI knows a model was configured even if it's not currently available
    return fullModel || { id: modelId, name: modelId, available: false };
  }

  /**
   * Get the default AI Person ID (used when creating new AI chats)
   * Returns the stored default AI Person ID, set by setDefaultModel()
   *
   * Per design: AI identity is independent of model - we store the AI Person ID directly
   * rather than deriving it from the model ID.
   */
  getDefaultAIPersonId(): SHA256IdHash<Person> | null {
    return this._defaultAIPersonId;
  }

  /**
   * Ensure an AI contact exists for a model and return its Person ID
   * Finds existing AI by modelId, or creates a new one if none exists
   *
   * @param modelId - Model ID to find/create AI for (e.g., 'claude-opus-4-5-20251101')
   * @returns Person ID of the AI
   */
  async ensureAIContactForModel(modelId: string): Promise<SHA256IdHash<Person>> {
    // Find existing AI by modelId
    const allAIs = this.aiManager.getAllAIs();
    const aiForModel = allAIs.find(ai => ai.modelId === modelId && ai.active);

    if (aiForModel) {
      return aiForModel.personId;
    }

    // No AI found - create one with generated name/email
    MessageBus.send('debug', `No AI found for ${modelId}, creating new AI contact...`);

    // Generate AI identity
    const { name, email } = await this._generateAIIdentity(modelId);

    // Create the AI contact
    const personality: AIPersonality = {
      creationContext: {
        device: (typeof navigator !== 'undefined' && navigator.userAgent) || 'node',
        locale: (typeof navigator !== 'undefined' && navigator.language) || 'en',
        time: Date.now(),
        app: 'lama'
      }
    };

    const personId = await this.ensureAIForModel(modelId, name, email, personality);
    MessageBus.send('debug', `Created AI contact for ${modelId}: ${personId.toString().substring(0, 8)}...`);

    return personId;
  }

  /**
   * Generate AI identity (name and email) for a model
   * @private
   */
  private async _generateAIIdentity(modelId: string): Promise<{ name: string; email: string }> {
    // Extract model family for display name
    const displayName = this._extractModelFamily(modelId);

    // Generate unique email based on model
    const deviceName = (typeof process !== 'undefined' && process.env?.HOSTNAME) ||
                       (typeof window !== 'undefined' && 'location' in window ? window.location.hostname : 'local');
    const sanitizedModelId = modelId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const email = `${sanitizedModelId}@${deviceName}.local`;

    return { name: displayName, email };
  }

  /**
   * Register an AI topic with its AI Person
   */
  registerAITopic(topicId: string, aiPersonId: SHA256IdHash<Person>): void {
    this.topicManager.registerAITopic(topicId, aiPersonId);
  }

  /**
   * Rename an AI chat
   *
   * @deprecated This method creates new Person/Profile which is unnecessary.
   * Use setTopicScreenName() instead to just change the display name.
   * The AI identity stays stable - only the topic's screenName changes.
   *
   * @param topicId - Topic ID to rename
   * @param newName - New display name
   */
  async renameAIChat(topicId: string, newName: string): Promise<void> {
    MessageBus.send('debug', `[DEPRECATED] renameAIChat: ${topicId} → ${newName} - use setTopicScreenName() instead`);

    // For backwards compatibility, still update the in-memory display name
    // This will be removed after TopicV2 migration
    this.topicManager.setTopicDisplayName(topicId, newName);

    // NOTE: We no longer create new Person/Profile.
    // The AI identity is stable. Only the topic's screen name changes.
    // After TopicV2 migration, use TopicModelV2.setScreenName() directly.
  }

  /**
   * Set the screen name for a topic (new API)
   *
   * This is the preferred method for renaming topics.
   * Changes only the display name, not the AI identity.
   *
   * Note: During migration, this updates the in-memory display name.
   * After TopicV2 migration, this should call TopicModelV2.setScreenName().
   *
   * @param topicId - Topic ID
   * @param screenName - New screen name
   */
  async setTopicScreenName(topicId: string, screenName: string): Promise<void> {
    MessageBus.send('debug', `Setting topic screen name: ${topicId} → ${screenName}`);

    // During migration: update in-memory display name
    // TODO: After TopicV2 migration, use TopicModelV2.setScreenName() instead
    this.topicManager.setTopicDisplayName(topicId, screenName);
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

    // Get the AI ID from the aiByPerson lookup
    const aiId = this.aiManager.getAIId(aiPersonId);
    if (!aiId) {
      return [];
    }

    // Get past identities
    return await this.aiManager.getPastIdentities(aiId);
  }

  /**
   * Get topic display name
   * @deprecated Use TopicV2.screenName or TopicModelV2.getDisplayName() instead
   */
  getTopicDisplayName(topicId: string): string | undefined {
    return this.topicManager.getTopicDisplayName(topicId);
  }

  /**
   * Set topic display name
   * @deprecated Use setTopicScreenName() instead
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
      onAnalysis?: (analysis: { keywords: string[]; description?: string; language?: string; summaryUpdate?: string }) => void;
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
    // STREAMLINED ARCHITECTURE - IMMEDIATE RESPONSE WITH INLINE TOOLS
    // ═══════════════════════════════════════════════════════════════════
    // PHASE 1: Stream response IMMEDIATELY with inline tool calls
    //          - Real-time UX via onStream callback
    //          - Tools execute inline if LLM decides to use them
    //          - User sees thinking/response right away
    // PHASE 2: Background analytics (structured output)
    //          - Extract keywords/subjects
    //          - Results via onAnalysis callback
    // PHASE 3: Prepare context for NEXT message (async, non-blocking)
    //          - Pre-warm caches
    //          - Model context stays warm
    // ═══════════════════════════════════════════════════════════════════

    // ✅ PHASE 1: Start streaming IMMEDIATELY with inline tool support
    options?.onProgress?.('Generating response...');

    const responsePromise = this.deps.llmManager.chat(history, modelId, {
      topicId, // CRITICAL: Enables context caching
      maxTokens,
      onStream: options?.onStream, // UI gets chunks in real-time
      onThinkingStream: options?.onThinkingStream, // Thinking stream
      temperature: 0.7 // Normal temp for user-facing response
      // Tools enabled - LLM can call them inline if needed
    });

    // ✅ Background: Chain Phase 2 after Phase 1 completes
    responsePromise.then(async (response) => {
      const phase1Time = Date.now() - startTime;
      MessageBus.send('debug', `Phase 1 complete (${phase1Time}ms)`);

      // Extract actual response content and thinking
      // Handle multiple response formats: {content, ...}, {response, ...}, or plain string
      let actualResponse = '';
      let thinking: string | undefined;
      if (typeof response === 'object' && response !== null) {
        if ('content' in response) {
          actualResponse = (response as any).content;
        } else if ('response' in response) {
          actualResponse = (response as any).response;
        } else {
          actualResponse = String(response);
        }
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
          // CRITICAL: No streaming callbacks - this is background processing
          const analyticsResponse = await this.deps.llmManager.chat(
            analyticsHistory,
            modelId,
            {
              topicId, // Reuses cached context from Phase 1
              maxTokens,
              temperature: 0.3, // Lower temp for deterministic extraction
              disableTools: true, // No tool calls needed for analytics
              onStream: undefined, // No streaming - background only
              onThinkingStream: undefined // No thinking display - background only
            }
          );

          const jsonResponse = typeof analyticsResponse === 'string'
            ? analyticsResponse
            : (typeof analyticsResponse === 'object' && 'content' in analyticsResponse)
              ? (analyticsResponse as any).content
              : JSON.stringify(analyticsResponse);

          console.log('[Phase 2] Raw LLM response:', jsonResponse.substring(0, 200));
          const parsedAnalysis = JSON.parse(jsonResponse);
          console.log('[Phase 2] Parsed analysis:', {
            keywordsCount: parsedAnalysis.keywords?.length,
            description: parsedAnalysis.description,
            language: parsedAnalysis.language
          });

          analysis = {
            keywords: parsedAnalysis.keywords || [],
            description: parsedAnalysis.description,
            language: parsedAnalysis.language
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

      // ✅ PHASE 3: Prepare context for NEXT message (async, non-blocking)
      // Model context is warm after Phase 2 - good time to pre-cache
      if (topicId && this.deps.topicAnalysisModel) {
        setImmediate(async () => {
          try {
            const phase3Start = Date.now();

            // Pre-warm subject cache for proposals (most expensive cache miss)
            await this.deps.topicAnalysisModel.getSubjects(topicId);

            const phase3Time = Date.now() - phase3Start;
            MessageBus.send('debug', `Phase 3 complete (${phase3Time}ms) - caches warm for next message`);
          } catch (error) {
            // Non-blocking - don't fail if cache warming fails
            MessageBus.send('debug', 'Phase 3 cache warming skipped:', error);
          }
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
        createAI: { product: 'personIdHash', title: (r: any) => `Create AI: ${r.name}` },
        createLLM: { product: 'idHash', title: (r: any) => `Create LLM: ${r.name}` },
        setAIModel: { product: 'hash', entityId: 'idHash', title: 'Change AI Model' },
        updateModelId: { product: 'hash', entityId: 'idHash', title: 'Update AI Model' },
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

  // ============================================================
  // Default AI Topic Helpers (delegates to AITopicManager)
  // ============================================================

  /**
   * Check if a topic is the Hi default chat
   */
  isHiTopic(topicId: string): boolean {
    return this.topicManager.isHiTopic(topicId);
  }

  /**
   * Check if a topic is the LAMA (private memory) default chat
   */
  isLamaTopic(topicId: string): boolean {
    return this.topicManager.isLamaTopic(topicId);
  }

  /**
   * Check if a topic is a default AI topic (Hi or LAMA)
   */
  isDefaultAITopic(topicId: string): boolean {
    return this.topicManager.isDefaultAITopic(topicId);
  }

  /**
   * Get the Hi topic ID (null if not created yet)
   */
  getHiTopicId(): string | null {
    return this.topicManager.getHiTopicId();
  }

  /**
   * Get the LAMA topic ID (null if not created yet)
   */
  getLamaTopicId(): string | null {
    return this.topicManager.getLamaTopicId();
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
