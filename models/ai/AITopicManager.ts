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

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, Group, HashGroup } from '@refinio/one.core/lib/recipes.js';
import { getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import { getWelcomeMessage } from '../../constants/welcome-messages.js';
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
    private topicGroupManager?: any, // Optional - for topic creation (Node.js only)
    private assemblyManager?: any // Optional - for knowledge assembly creation
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
   * Switch/reassign the model for an existing AI topic
   * Used for error recovery when primary model fails
   */
  switchTopicModel(topicId: string, newModelId: string): void {
    if (!this.isAITopic(topicId)) {
      throw new Error(`Cannot switch model - topic ${topicId} is not an AI topic`);
    }

    const oldModelId = this._topicModelMap.get(topicId);
    this._topicModelMap.set(topicId, newModelId);

    console.log(`[AITopicManager] Switched topic ${topicId} from model ${oldModelId} to ${newModelId}`);
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

    // Create Hi chat (or ensure it has a welcome message if it exists)
    await this.ensureHiChat(this.defaultModelId, aiPersonId, onTopicCreated);

    // Create LAMA chat (or ensure it has a welcome message if it exists)
    {
      const privateModelId = this.defaultModelId + '-private';

      // Register the private variant with llmManager
      try {
        this.llmManager.registerPrivateVariant(this.defaultModelId);
      } catch (error) {
        console.error('[AITopicManager] Failed to register private model variant:', error);
        throw new Error(`Failed to register private model variant for ${this.defaultModelId}: ${error instanceof Error ? error.message : String(error)}`);
      }

      // CRITICAL: -private is an alias/additional ID for the SAME model/person
      // Create an LLM alias that maps the privateModelId to the same Person
      await aiContactManager.createLLMAlias(
        privateModelId,
        this.defaultModelId,
        `${displayName} (Private)`
      );

      // Use the same person ID as the base model
      const privateAiPersonId = aiPersonId;

      await this.ensureLamaChat(privateModelId, privateAiPersonId, onTopicCreated);
    } // End LAMA creation block
  }

  /**
   * Check if a topic exists and register it if found
   * Returns true if the topic exists, false otherwise
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _checkAndRegisterExistingTopic(
    topicId: string,
    aiContactManager: any
  ): Promise<boolean> {
    try {
      const topic = await this.topicModel.topics.queryById(topicId);
      if (!topic) {
        console.log(`[AITopicManager] Topic '${topicId}' does not exist`);
        return false;
      }

      // Verify topic is actually in storage (not just in collection cache)
      try {
        await this.topicModel.enterTopicRoom(topicId);
      } catch (error) {
        console.warn(`[AITopicManager] Topic '${topicId}' in collection but not in storage - will recreate`, error);
        return false;
      }

      // Check if topic has a group (3+ participants)
      if ((topic as any).group) {
        // Topic exists in storage - try to determine its model from group members
        const groupResult = await getObjectByIdHash((topic as any).group);
        const group = groupResult.obj as Group;

        // NEW one.core structure: Group.hashGroup → HashGroup.person
        if (group.hashGroup) {
          const hashGroup = await getObject(group.hashGroup as SHA256Hash<HashGroup>) as HashGroup<Person>;
          if (hashGroup.person) {
            for (const memberId of hashGroup.person) {
              const modelId = aiContactManager.getModelIdForPersonId(memberId);

              if (modelId) {
                // Found the AI participant - register the topic
                this.registerAITopic(topicId, modelId);
                console.log(`[AITopicManager] Registered existing topic '${topicId}' with model: ${modelId}`);
                return true;
              }
            }
          }
        }
      }

      // Topic exists but no AI participant found (either no group or group with no AI)
      // Register with default model if available
      if (this.defaultModelId) {
        const finalModelId = topicId === 'lama' ? `${this.defaultModelId}-private` : this.defaultModelId;
        this.registerAITopic(topicId, finalModelId);
        console.log(`[AITopicManager] Registered orphaned topic '${topicId}' with default model: ${finalModelId}`);
        return true;
      }
    } catch (error) {
      // Topic doesn't exist or error during check
      console.log(`[AITopicManager] Topic '${topicId}' check failed:`, error instanceof Error ? error.message : String(error));
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
    _onTopicCreated?: (topicId: string, modelId: string) => Promise<void>
  ): Promise<void> {
    console.log('[AITopicManager] Ensuring Hi chat...');

    if (!this.topicGroupManager) {
      throw new Error('topicGroupManager not initialized - cannot create topics');
    }

    try {
      const topicId = 'hi';
      let topicRoom: any;
      let needsWelcome = false;

      // Check if topic already exists in storage (not just collection cache)
      let topicExists = false;
      try {
        await this.topicModel.enterTopicRoom(topicId);
        topicExists = true;
      } catch (e) {
        // Topic doesn't exist in storage
      }

      if (!topicExists) {
        // Topic doesn't exist, create it
        // CRITICAL: Include BOTH user and AI in participants so both get channels
        const userPersonId = await this.leuteModel.myMainIdentity();
        await this.topicGroupManager.createGroupTopic('Hi', topicId, [userPersonId, aiPersonId]);
        needsWelcome = true;

        // Create Assembly for this topic
        if (this.assemblyManager) {
          console.log('[AITopicManager] Creating Assembly for Hi chat');
          await this.assemblyManager.createChatAssembly(topicId, 'Hi');
        }
      } else {
        // Topic exists - ensure AI participant is in the group
        console.log('[AITopicManager] Hi chat exists, ensuring AI participant is in group...');
        await this.topicGroupManager.addParticipantsToTopic(topicId, [aiPersonId]);
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
        const messages = await topicRoom.retrieveAllMessages();
        needsWelcome = messages.length === 0;
      }

      if (!topicRoom) {
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
      }

      // Register as AI topic
      this.registerAITopic(topicId, modelId);
      this.setTopicDisplayName(topicId, 'Hi');

      // Post static welcome message directly (NO LLM generation for Hi chat)
      if (needsWelcome) {
        console.log('[AITopicManager] ✅ Hi chat created, posting static welcome message');

        // Get model provider to determine welcome message
        let modelProvider: string | undefined;
        try {
          const model = this.llmManager?.getModel(modelId);
          if (model) {
            modelProvider = model.provider;
            console.log('[AITopicManager] Model provider:', modelProvider);
          }
        } catch (error) {
          console.warn('[AITopicManager] Could not get model provider, using default message:', error);
        }

        const welcomeMessage = getWelcomeMessage(modelProvider);
        await topicRoom.sendMessage(welcomeMessage, aiPersonId, aiPersonId);
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

      // Check if topic already exists in storage (not just collection cache)
      let topicExists = false;
      try {
        await this.topicModel.enterTopicRoom(topicId);
        topicExists = true;
      } catch (e) {
        // Topic doesn't exist in storage
      }

      if (!topicExists) {
        // Topic doesn't exist, create it with the PRIVATE AI contact
        // CRITICAL: Include BOTH user and AI in participants so both get channels
        const userPersonId = await this.leuteModel.myMainIdentity();
        await this.topicGroupManager.createGroupTopic('LAMA', topicId, [userPersonId, privateAiPersonId]);
        needsWelcome = true;

        // Create Assembly for this topic
        if (this.assemblyManager) {
          console.log('[AITopicManager] Creating Assembly for LAMA chat');
          await this.assemblyManager.createChatAssembly(topicId, 'LAMA');
        }
      } else {
        // Topic exists - ensure AI participant is in the group
        console.log('[AITopicManager] LAMA chat exists, ensuring AI participant is in group...');
        await this.topicGroupManager.addParticipantsToTopic(topicId, [privateAiPersonId]);
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
        const messages = await topicRoom.retrieveAllMessages();
        needsWelcome = messages.length === 0;
      }

      if (!topicRoom) {
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
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
    console.log('[AITopicManager] 🔍 SCAN START - Scanning existing conversations for AI participants...');

    try {
      // Get all channels
      const allChannels = await this.channelManager.getMatchingChannelInfos();
      console.log(`[AITopicManager] 🔍 Found ${allChannels.length} total channels`);

      // Log existing registered topics
      const existingTopics = Array.from(this._topicModelMap.keys());
      console.log(`[AITopicManager] 🔍 Already registered topics: [${existingTopics.join(', ')}]`);

      // Log available AI contacts
      console.log(`[AITopicManager] 🔍 Checking what AI contacts are available...`);

      let registeredCount = 0;

      for (const channelInfo of allChannels) {
        try {
          // Channel ID is NOT the same as topic ID - we need to get the topic from the channel
          // For AI topics, the channel.id is the topic ID (channels created by createGroupTopic use topic.id as channel.id)
          const topicId = channelInfo.id;

          console.log(`[AITopicManager] 🔍 Checking channel/topic: ${topicId}`);

          // Skip if already registered
          if (this._topicModelMap.has(topicId)) {
            console.log(`[AITopicManager]   ↳ SKIP - already registered with model: ${this._topicModelMap.get(topicId)}`);
            continue;
          }

          // Try to enter the topic room to verify it exists
          let topic;
          try {
            await this.topicModel.enterTopicRoom(topicId);
            topic = await this.topicModel.topics.queryById(topicId);
          } catch (e) {
            // Topic doesn't exist or can't be accessed
            console.log(`[AITopicManager]   ↳ SKIP - topic doesn't exist or can't be accessed`);
            continue;
          }

          if (!topic) {
            console.log(`[AITopicManager]   ↳ SKIP - topic not found in collection`);
            continue;
          }

          let aiModelId = null;

          // Check if topic has a group - all AI topics are group topics
          // Use topicGroupManager to check if the topic is a group topic
          let groupIdHash: SHA256IdHash<Group> | null = null;
          try {
            groupIdHash = await this.topicGroupManager?.getGroupForTopic(topicId) || null;
          } catch (e) {
            // Not a group topic or error accessing group
          }

          if (groupIdHash) {
            console.log(`[AITopicManager]   ↳ Topic is a group topic, checking participants...`);
            const groupResult = await getObjectByIdHash(groupIdHash);
            const group = groupResult.obj as Group;

            // NEW one.core structure: Group.hashGroup → HashGroup.person
            if (group.hashGroup) {
              const hashGroup = await getObject(group.hashGroup as SHA256Hash<HashGroup>) as HashGroup<Person>;
              if (hashGroup.person) {
                console.log(`[AITopicManager]   ↳ Group has ${hashGroup.person.size} participants`);
                // Check each participant in the group to find AI
                for (const memberId of hashGroup.person) {
                  const modelId = aiContactManager.getModelIdForPersonId(memberId);
                  console.log(`[AITopicManager]      - Participant ${memberId.substring(0, 8)}... → model: ${modelId || 'NOT AI'}`);
                  if (modelId) {
                    aiModelId = modelId;
                    console.log(`[AITopicManager]   ↳ ✅ FOUND AI participant in ${topicId}: ${modelId}`);
                    break;
                  }
                }
              } else {
                console.log(`[AITopicManager]   ↳ Group hashGroup has no participants`);
              }
            } else {
              console.log(`[AITopicManager]   ↳ Group has no hashGroup`);
            }
          } else {
            console.log(`[AITopicManager]   ↳ SKIP - topic has no group (not a group chat)`);
          }

          // Register if AI participant found
          if (aiModelId) {
            this.registerAITopic(topicId, aiModelId);
            registeredCount++;
            console.log(`[AITopicManager]   ↳ ✅ REGISTERED topic ${topicId} with model ${aiModelId}`);
          } else {
            console.log(`[AITopicManager]   ↳ SKIP - no AI participant found in topic ${topicId}`);
          }
        } catch (error) {
          console.warn(`[AITopicManager]   ↳ ERROR scanning topic:`, error);
        }
      }

      console.log(`[AITopicManager] 🔍 SCAN COMPLETE - Registered ${registeredCount} new AI topics`);
      return registeredCount;
    } catch (error) {
      console.error('[AITopicManager] 🔍 SCAN FAILED:', error);
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
