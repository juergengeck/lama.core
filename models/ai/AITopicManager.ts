/**
 * AITopicManager
 *
 * Manages topic-to-model mappings and topic lifecycle for AI conversations.
 * This component tracks which topics are AI-enabled and which models they use.
 *
 * Responsibilities:
 * - Register AI topics with their associated models
 * - Track topic loading states and display names
 * - Manage default AI model selection
 * - Create and register default chats (Hi and LAMA)
 * - Scan existing conversations for AI participants
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, Group } from '@refinio/one.core/lib/recipes.js';
import { getIdObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import { HI_WELCOME_MESSAGE } from '../../constants/welcome-messages.js';
import type { IAITopicManager } from './interfaces.js';
import type { AIMode, LLMModelInfo } from './types.js';

export class AITopicManager implements IAITopicManager {
  // Topic-to-model mappings (topicId → modelId)
  private _topicModelMap: Map<string, string>;

  // Topic loading states (topicId → isLoading)
  private _topicLoadingState: Map<string, boolean>;

  // Topic display names (topicId → display name)
  private _topicDisplayNames: Record<string, string>;

  // Topic AI modes (topicId → mode)
  private topicAIModes: Map<string, AIMode>;

  // Default model ID
  private defaultModelId: string | null;

  // Mutex to prevent concurrent ensureDefaultChats calls
  private ensuringDefaultChats: Promise<void> | null = null;

  constructor(
    private topicModel: TopicModel,
    private channelManager: ChannelManager,
    private leuteModel: LeuteModel,
    private llmManager: any, // LLMManager interface
    private topicGroupManager?: any // Optional - for topic creation (Node.js only)
  ) {
    this._topicModelMap = new Map();
    this._topicLoadingState = new Map();
    this._topicDisplayNames = {};
    this.topicAIModes = new Map();
    this.defaultModelId = null;
  }

  // Readonly accessors for external access
  get topicModelMap(): ReadonlyMap<string, string> {
    return this._topicModelMap;
  }

  get topicLoadingState(): ReadonlyMap<string, boolean> {
    return this._topicLoadingState;
  }

  get topicDisplayNames(): Readonly<Record<string, string>> {
    return this._topicDisplayNames;
  }

  /**
   * Register an AI topic with its model
   */
  registerAITopic(topicId: string, modelId: string): void {
    console.log(`[AITopicManager] Registered AI topic: ${topicId} with model: ${modelId}`);
    this._topicModelMap.set(topicId, modelId);
  }

  /**
   * Check if a topic is an AI topic
   */
  isAITopic(topicId: string): boolean {
    return this._topicModelMap.has(topicId);
  }

  /**
   * Get model ID for a topic
   */
  getModelIdForTopic(topicId: string): string | null {
    return this._topicModelMap.get(topicId) || null;
  }

  /**
   * Set loading state for a topic
   */
  setTopicLoadingState(topicId: string, isLoading: boolean): void {
    this._topicLoadingState.set(topicId, isLoading);
  }

  /**
   * Check if topic is loading
   */
  isTopicLoading(topicId: string): boolean {
    return this._topicLoadingState.get(topicId) || false;
  }

  /**
   * Get topic display name
   */
  getTopicDisplayName(topicId: string): string | undefined {
    return this._topicDisplayNames[topicId];
  }

  /**
   * Set topic display name
   */
  setTopicDisplayName(topicId: string, name: string): void {
    this._topicDisplayNames[topicId] = name;
  }

  /**
   * Get all AI topic IDs
   */
  getAllAITopicIds(): string[] {
    return Array.from(this._topicModelMap.keys());
  }

  /**
   * Set AI mode for a topic
   */
  setTopicAIMode(topicId: string, mode: AIMode): void {
    this.topicAIModes.set(topicId, mode);
  }

  /**
   * Get AI mode for a topic
   */
  getTopicAIMode(topicId: string): AIMode | undefined {
    return this.topicAIModes.get(topicId);
  }

  /**
   * Set default AI model
   */
  setDefaultModel(modelId: string): void {
    this.defaultModelId = modelId;
  }

  /**
   * Get default AI model
   */
  getDefaultModel(): string | null {
    return this.defaultModelId;
  }

  /**
   * Ensure default AI chats exist (Hi and LAMA)
   * This is called during initialization and when default model changes
   */
  async ensureDefaultChats(
    aiContactManager: any, // IAIContactManager
    onTopicCreated?: (topicId: string, modelId: string) => Promise<void>
  ): Promise<void> {
    // If already ensuring, return the existing promise (prevents race condition)
    if (this.ensuringDefaultChats) {
      console.log('[AITopicManager] ensureDefaultChats already in progress, waiting...');
      return this.ensuringDefaultChats;
    }

    // Create and store the promise
    this.ensuringDefaultChats = this.doEnsureDefaultChats(aiContactManager, onTopicCreated);

    try {
      await this.ensuringDefaultChats;
    } finally {
      // Clear the mutex when done
      this.ensuringDefaultChats = null;
    }
  }

  /**
   * Internal implementation of ensureDefaultChats (called by mutex wrapper)
   */
  private async doEnsureDefaultChats(
    aiContactManager: any,
    onTopicCreated?: (topicId: string, modelId: string) => Promise<void>
  ): Promise<void> {
    console.log('[AITopicManager] Ensuring default AI chats...');

    // FIRST: Try to register existing topics even without a default model
    const hiExists = await this.checkAndRegisterExistingTopic('hi', aiContactManager);
    const lamaExists = await this.checkAndRegisterExistingTopic('lama', aiContactManager);

    // SECOND: Create missing topics OR generate welcome messages for existing empty topics (requires default model)
    if (!this.defaultModelId) {
      throw new Error('No default model set - cannot create default chats');
    }

    // Get model info for display name
    const models = this.llmManager?.getAvailableModels() || [];
    const model = models.find((m: any) => m.id === this.defaultModelId);
    const displayName = model?.displayName || model?.name || this.defaultModelId;

    const aiPersonId = await aiContactManager.ensureAIContactForModel(this.defaultModelId, displayName);
    if (!aiPersonId) {
      throw new Error(`Could not create AI contact for model: ${this.defaultModelId}`);
    }

    // Create Hi or ensure it has a welcome message (Hi always needs to be ensured for welcome message)
    await this.ensureHiChat(this.defaultModelId, aiPersonId, onTopicCreated);

    // Create LAMA or ensure it has a welcome message (LAMA always needs to be ensured)
    {
      const privateModelId = this.defaultModelId + '-private';

      // Register the private variant with llmManager
      try {
        this.llmManager.registerPrivateVariant(this.defaultModelId);
      } catch (error) {
        console.error('[AITopicManager] Failed to register private model variant:', error);
        throw new Error(`Failed to register private model variant for ${this.defaultModelId}: ${error instanceof Error ? error.message : String(error)}`);
      }

      // For private model, use the base model's display name
      const privateDisplayName = `${displayName} (Private)`;
      const privateAiPersonId = await aiContactManager.ensureAIContactForModel(privateModelId, privateDisplayName);
      if (!privateAiPersonId) {
        throw new Error(`Could not create AI contact for private model: ${privateModelId}`);
      }
      await this.ensureLamaChat(privateModelId, privateAiPersonId, onTopicCreated);
    } // End LAMA creation block
  }

  /**
   * Check if a topic exists and register it if found
   * Returns true if the topic exists, false otherwise
   */
  private async checkAndRegisterExistingTopic(
    topicId: string,
    aiContactManager: any
  ): Promise<boolean> {
    try {
      const topic = await this.topicModel.topics.queryById(topicId);
      if (topic && (topic as any).group) {
        // Verify topic is actually in storage (not just in collection cache)
        try {
          await this.topicModel.enterTopicRoom(topicId);
        } catch (error) {
          console.warn(`[AITopicManager] Topic '${topicId}' in collection but not in storage - will recreate`, error);
          return false;
        }

        // Topic exists in storage - try to determine its model from group members
        const group = await getIdObject((topic as any).group) as Group;

        // CRITICAL: OLD one.core structure has 'person' array directly on Group
        if (group.person) {
          for (const memberId of group.person) {
            const modelId = aiContactManager.getModelIdForPersonId(memberId);

            if (modelId) {
              // Found the AI participant - register the topic
              this.registerAITopic(topicId, modelId);
              console.log(`[AITopicManager] Registered existing topic '${topicId}' with model: ${modelId}`);
              return true;
            }
          }
        }

        // Topic exists but no AI participant found
        // Register with default model if available
        if (this.defaultModelId) {
          const finalModelId = topicId === 'lama' ? `${this.defaultModelId}-private` : this.defaultModelId;
          this.registerAITopic(topicId, finalModelId);
          console.log(`[AITopicManager] Registered orphaned topic '${topicId}' with default model: ${finalModelId}`);
          return true;
        }
      }
    } catch (error) {
      // Topic doesn't exist or error during check
      console.log(`[AITopicManager] Topic '${topicId}' does not exist or check failed:`, error instanceof Error ? error.message : String(error));
    }
    return false;
  }

  /**
   * Ensure Hi chat exists with static welcome message
   * NOTE: Hi chat uses a STATIC welcome message - no LLM generation
   */
  private async ensureHiChat(
    modelId: string,
    aiPersonId: SHA256IdHash<Person>,
    onTopicCreated?: (topicId: string, modelId: string) => Promise<void>
  ): Promise<void> {
    console.log('[AITopicManager] Ensuring Hi chat...');

    if (!this.topicGroupManager) {
      throw new Error('topicGroupManager not initialized - cannot create topics');
    }

    try {
      const topicId = 'hi';
      let topicRoom: any;
      let needsWelcome = false;

      // Check if topic already exists
      try {
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
        const messages = await topicRoom.retrieveAllMessages();
        needsWelcome = messages.length === 0;
      } catch (e) {
        // Topic doesn't exist, create it
        await this.topicGroupManager.createGroupTopic('Hi', topicId, [aiPersonId]);
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
        needsWelcome = true;
      }

      // Register as AI topic
      this.registerAITopic(topicId, modelId);
      this.setTopicDisplayName(topicId, 'Hi');

      // Post static welcome message directly (NO LLM generation for Hi chat)
      if (needsWelcome) {
        console.log('[AITopicManager] ✅ Hi chat created, posting static welcome message');
        await topicRoom.sendMessage(HI_WELCOME_MESSAGE, aiPersonId, aiPersonId);
        console.log('[AITopicManager] ✅ Static welcome message posted to Hi chat');
      } else {
        console.log('[AITopicManager] ✅ Hi chat already exists');
      }
    } catch (error) {
      console.error('[AITopicManager] Failed to ensure Hi chat:', error);
      throw error;
    }
  }

  /**
   * Ensure LAMA chat exists (uses private model variant)
   * NOTE: LAMA chat generates DYNAMIC welcome message via LLM (unlike Hi chat)
   */
  private async ensureLamaChat(
    privateModelId: string,
    privateAiPersonId: SHA256IdHash<Person>,
    onTopicCreated?: (topicId: string, modelId: string) => Promise<void>
  ): Promise<void> {
    console.log(`[AITopicManager] Ensuring LAMA chat with private model: ${privateModelId}`);

    if (!this.topicGroupManager) {
      throw new Error('topicGroupManager not initialized - cannot create topics');
    }

    try {
      const topicId = 'lama';
      let topicRoom: any;
      let needsWelcome = false;

      // Check if topic already exists
      try {
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
        const messages = await topicRoom.retrieveAllMessages();
        needsWelcome = messages.length === 0;
      } catch (e) {
        // Topic doesn't exist, create it with the PRIVATE AI contact
        await this.topicGroupManager.createGroupTopic('LAMA', topicId, [privateAiPersonId]);
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
        needsWelcome = true;
      }

      // Register as AI topic with the PRIVATE model ID
      this.registerAITopic(topicId, privateModelId);
      this.setTopicDisplayName(topicId, 'LAMA');

      // Trigger LLM-generated welcome message via callback (fire and forget - don't block)
      if (needsWelcome && onTopicCreated) {
        console.log('[AITopicManager] ✅ LAMA chat created, triggering LLM welcome message generation (background)');
        onTopicCreated(topicId, privateModelId).catch(err => {
          console.error('[AITopicManager] Failed to generate LAMA welcome message:', err);
        });
      } else if (needsWelcome) {
        console.log('[AITopicManager] ✅ LAMA chat created (no callback provided for welcome message)');
      } else {
        console.log('[AITopicManager] ✅ LAMA chat already exists');
      }
    } catch (error) {
      console.error('[AITopicManager] Failed to create LAMA chat:', error);
      throw error;
    }
  }

  /**
   * Scan existing conversations for AI participants and register them
   * Uses channel participants as source of truth
   */
  async scanExistingConversations(aiContactManager: any): Promise<number> {
    console.log('[AITopicManager] Scanning existing conversations for AI participants...');

    try {
      // Get all channels
      const allChannels = await this.channelManager.getMatchingChannelInfos();
      console.log(`[AITopicManager] Found ${allChannels.length} total channels`);

      let registeredCount = 0;

      for (const channelInfo of allChannels) {
        try {
          const topicId = channelInfo.id;

          // Skip if already registered
          if (this._topicModelMap.has(topicId)) {
            continue;
          }

          // Get the topic object
          const topic = await this.topicModel.topics.queryById(topicId);
          if (!topic) {
            continue;
          }

          let aiModelId = null;

          // Check if topic has a group (3+ participants including AI)
          if ((topic as any).group) {
            const group = await getIdObject((topic as any).group);

            if ((group as any).members) {
              for (const memberId of (group as any).members) {
                const modelId = aiContactManager.getModelIdForPersonId(memberId);
                if (modelId) {
                  aiModelId = modelId;
                  console.log(`[AITopicManager] Found AI participant in ${topicId} (via Group): ${modelId}`);
                  break;
                }
              }
            }
          }

          // If not found via group, check messages for AI sender (P2P conversations)
          if (!aiModelId && !((topic as any).group)) {
            const topicRoom = await this.topicModel.enterTopicRoom(topicId);
            const messages = await topicRoom.retrieveAllMessages(); // Check messages

            for (const msg of messages) {
              const msgSender = (msg as any).sender;
              if (msgSender) {
                const modelId = aiContactManager.getModelIdForPersonId(msgSender);
                if (modelId) {
                  aiModelId = modelId;
                  console.log(`[AITopicManager] Found AI participant in ${topicId} (via messages): ${modelId}`);
                  break;
                }
              }
            }
          }

          // Register if AI participant found
          if (aiModelId) {
            this.registerAITopic(topicId, aiModelId);
            registeredCount++;
          }
        } catch (error) {
          console.warn(`[AITopicManager] Error scanning topic:`, error);
        }
      }

      console.log(`[AITopicManager] ✅ Registered ${registeredCount} existing AI topics`);
      return registeredCount;
    } catch (error) {
      console.error('[AITopicManager] Failed to scan conversations:', error);
      throw error;
    }
  }

  /**
   * Get model information for a topic's model
   */
  getModelInfoForTopic(topicId: string): LLMModelInfo | null {
    const modelId = this._topicModelMap.get(topicId);
    if (!modelId) {
      return null;
    }

    const models = this.llmManager?.getAvailableModels();
    return models?.find((m: any) => m.id === modelId) || null;
  }
}
