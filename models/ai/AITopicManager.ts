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
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('AITopicManager');
import { getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import { getWelcomeMessage } from '../../constants/welcome-messages.js';
import type { IAITopicManager } from './interfaces.js';
import type { AIMode, LLMModelInfo } from './types.js';

export class AITopicManager implements IAITopicManager {
  // Topic-to-AI mappings (topicId → AI personId)
  private _topicAIMap: Map<string, SHA256IdHash<Person>>;

  // Topic loading states (topicId → isLoading)
  private _topicLoadingState: Map<string, boolean>;

  // Topic display names (topicId → display name)
  private _topicDisplayNames: Record<string, string>;

  // Topic AI modes (topicId → mode)
  private topicAIModes: Map<string, AIMode>;

  // Topic priorities (topicId → priority level, 1-10 with 10 being highest)
  private topicPriorities: Map<string, number>;

  // Default model ID (kept for backwards compatibility, will be phased out)
  private defaultModelId: string | null;

  // Mutex to prevent concurrent ensureDefaultChats calls
  private ensuringDefaultChats: Promise<void> | null = null;

  constructor(
    private topicModel: TopicModel,
    private channelManager: ChannelManager,
    private leuteModel: LeuteModel,
    private llmManager: any, // LLMManager interface
    private topicGroupManager?: any, // Optional - for topic creation (Node.js only)
    private assemblyManager?: any, // Optional - for knowledge assembly creation
    private llmObjectManager?: any // Optional - for LLM storage object creation
  ) {
    this._topicAIMap = new Map();
    this._topicLoadingState = new Map();
    this._topicDisplayNames = {};
    this.topicAIModes = new Map();
    this.topicPriorities = new Map();
    this.defaultModelId = null;
  }

  // Readonly accessors for external access
  get topicAIMap(): ReadonlyMap<string, SHA256IdHash<Person>> {
    return this._topicAIMap;
  }

  // Backwards compatibility - deprecated
  get topicModelMap(): ReadonlyMap<string, string> {
    MessageBus.send('alert', 'topicModelMap is deprecated - use topicAIMap instead');
    return new Map();
  }

  get topicLoadingState(): ReadonlyMap<string, boolean> {
    return this._topicLoadingState;
  }

  get topicDisplayNames(): Readonly<Record<string, string>> {
    return this._topicDisplayNames;
  }

  /**
   * Register an AI topic with its AI Person
   */
  registerAITopic(topicId: string, aiPersonId: SHA256IdHash<Person>): void {
    MessageBus.send('debug', `Registered AI topic: ${topicId} with AI Person: ${aiPersonId.toString().substring(0, 8)}...`);
    this._topicAIMap.set(topicId, aiPersonId);
  }

  /**
   * Check if a topic is an AI topic
   */
  isAITopic(topicId: string): boolean {
    return this._topicAIMap.has(topicId);
  }

  /**
   * Get AI Person ID for a topic
   */
  getAIPersonForTopic(topicId: string): SHA256IdHash<Person> | null {
    return this._topicAIMap.get(topicId) || null;
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
    return Array.from(this._topicAIMap.keys());
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
   * Set priority for a topic (1-10, higher = more urgent)
   */
  setTopicPriority(topicId: string, priority: number): void {
    // Clamp priority to valid range
    const clampedPriority = Math.max(1, Math.min(10, priority));
    this.topicPriorities.set(topicId, clampedPriority);
    MessageBus.send('debug', `Set priority for topic ${topicId}: ${clampedPriority}`);
  }

  /**
   * Get priority for a topic (defaults to 5 if not set)
   */
  getTopicPriority(topicId: string): number {
    return this.topicPriorities.get(topicId) || 5;
  }

  /**
   * Set default AI model
   */
  setDefaultModel(modelId: string): void {
    this.defaultModelId = modelId;
  }

  /**
   * Switch/reassign the AI Person for an existing AI topic
   * Used for changing which AI assistant a conversation uses
   */
  switchTopicAI(topicId: string, newAIPersonId: SHA256IdHash<Person>): void {
    if (!this.isAITopic(topicId)) {
      throw new Error(`Cannot switch AI - topic ${topicId} is not an AI topic`);
    }

    const oldAIPersonId = this._topicAIMap.get(topicId);
    this._topicAIMap.set(topicId, newAIPersonId);

    MessageBus.send('debug', `Switched topic ${topicId} from AI Person ${oldAIPersonId?.toString().substring(0, 8)}... to ${newAIPersonId.toString().substring(0, 8)}...`);
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
    aiManager: any, // AIManager
    onTopicCreated?: (topicId: string, aiPersonId: SHA256IdHash<Person>) => Promise<void>
  ): Promise<void> {
    // If already ensuring, return the existing promise (prevents race condition)
    if (this.ensuringDefaultChats) {
      MessageBus.send('debug', 'ensureDefaultChats already in progress, waiting...');
      return this.ensuringDefaultChats;
    }

    // Create and store the promise
    this.ensuringDefaultChats = this.doEnsureDefaultChats(aiManager, onTopicCreated);

    try {
      await this.ensuringDefaultChats;
    } finally {
      // Clear the mutex when done
      this.ensuringDefaultChats = null;
    }
  }

  /**
   * Extract model family name from model ID for AI Person naming
   * Examples:
   * - "claude-sonnet-4-5" → "Claude"
   * - "gpt-4" → "GPT"
   * - "gpt-oss-20b" → "GPT"
   * - "llama-3" → "Llama"
   */
  private extractModelFamily(modelId: string): string {
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
   * Internal implementation of ensureDefaultChats (called by mutex wrapper)
   */
  private async doEnsureDefaultChats(
    aiManager: any,
    onTopicCreated?: (topicId: string, aiPersonId: SHA256IdHash<Person>) => Promise<void>
  ): Promise<void> {
    MessageBus.send('debug', 'Ensuring default AI chats...');

    if (!this.defaultModelId) {
      throw new Error('No default model set - cannot create default chats');
    }

    // Get existing AI Person ID - it MUST exist (ensureAIForModel creates it before this is called)
    // Don't call createLLM/createAI here - that's redundant and causes duplicate Assemblies
    const aiId = `started-as-${this.defaultModelId}`;
    const aiPersonId = aiManager.getPersonId(`ai:${aiId}`);
    if (!aiPersonId) {
      // Fail fast - AI Person should have been created by ensureAIForModel
      throw new Error(`[AITopicManager] AI Person not found for ${aiId} - ensureAIForModel must be called first`);
    }
    MessageBus.send('debug', `Using existing AI Person for ${this.defaultModelId}`);

    // Create Hi chat (static welcome message - no LLM generation)
    await this.ensureHiChat(this.defaultModelId, aiPersonId, onTopicCreated);

    // Create LAMA chat (LLM-generated welcome message)
    await this.ensureLamaChat(this.defaultModelId, aiPersonId, onTopicCreated);
  }

  /**
   * Check if a topic exists and register it if found
   * Returns true if the topic exists, false otherwise
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  /**
   * Ensure Hi chat exists with static welcome message
   * NOTE: Hi chat uses a STATIC welcome message - no LLM generation
   */
  private async ensureHiChat(
    modelId: string,
    aiPersonId: SHA256IdHash<Person>,
    _onTopicCreated?: (topicId: string, aiPersonId: SHA256IdHash<Person>) => Promise<void>
  ): Promise<void> {
    MessageBus.send('debug', 'Ensuring Hi chat...');

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
          MessageBus.send('debug', 'Creating Assembly for Hi chat');
          await this.assemblyManager.createChatAssembly(topicId, 'Hi');
        }
      } else {
        // Topic exists - ensure AI participant is in the group
        MessageBus.send('debug', 'Hi chat exists, ensuring AI participant is in group...');
        await this.topicGroupManager.addParticipantsToTopic(topicId, [aiPersonId]);
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
        const messages = await topicRoom.retrieveAllMessages();
        needsWelcome = messages.length === 0;
      }

      if (!topicRoom) {
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
      }

      // Register as AI topic
      this.registerAITopic(topicId, aiPersonId);
      this.setTopicDisplayName(topicId, 'Hi');

      // Post static welcome message directly (NO LLM generation for Hi chat)
      if (needsWelcome) {
        MessageBus.send('debug', 'Hi chat created, posting static welcome message');

        // Get model provider to determine welcome message
        let modelProvider: string | undefined;
        try {
          const model = this.llmManager?.getModel(modelId);
          if (model) {
            modelProvider = model.provider;
            MessageBus.send('debug', 'Model provider:', modelProvider);
          }
        } catch (error) {
          MessageBus.send('alert', 'Could not get model provider, using default message:', error);
        }

        const welcomeMessage = getWelcomeMessage(modelProvider);
        await topicRoom.sendMessage(welcomeMessage, aiPersonId, aiPersonId);
        MessageBus.send('debug', 'Static welcome message posted to Hi chat');
      } else {
        MessageBus.send('debug', 'Hi chat already exists');
      }
    } catch (error) {
      MessageBus.send('error', 'Failed to ensure Hi chat:', error);
      throw error;
    }
  }

  /**
   * Ensure LAMA chat exists (uses private model variant)
   * NOTE: LAMA chat generates DYNAMIC welcome message via LLM (unlike Hi chat)
   */
  private async ensureLamaChat(
    _privateModelId: string,
    privateAiPersonId: SHA256IdHash<Person>,
    onTopicCreated?: (topicId: string, aiPersonId: SHA256IdHash<Person>) => Promise<void>
  ): Promise<void> {
    MessageBus.send('debug', `Ensuring LAMA chat with AI Person: ${privateAiPersonId.toString().substring(0, 8)}...`);

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
          MessageBus.send('debug', 'Creating Assembly for LAMA chat');
          await this.assemblyManager.createChatAssembly(topicId, 'LAMA');
        }
      } else {
        // Topic exists - ensure AI participant is in the group
        MessageBus.send('debug', 'LAMA chat exists, ensuring AI participant is in group...');
        await this.topicGroupManager.addParticipantsToTopic(topicId, [privateAiPersonId]);
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
        const messages = await topicRoom.retrieveAllMessages();
        needsWelcome = messages.length === 0;
      }

      if (!topicRoom) {
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
      }

      // Register as AI topic
      this.registerAITopic(topicId, privateAiPersonId);
      this.setTopicDisplayName(topicId, 'LAMA');

      // Trigger LLM-generated welcome message via callback (fire and forget - don't block)
      if (needsWelcome && onTopicCreated) {
        MessageBus.send('debug', 'LAMA chat created, triggering LLM welcome message generation (background)');
        onTopicCreated(topicId, privateAiPersonId).catch(err => {
          MessageBus.send('error', 'Failed to generate LAMA welcome message:', err);
        });
      } else if (needsWelcome) {
        MessageBus.send('debug', 'LAMA chat created (no callback provided for welcome message)');
      } else {
        MessageBus.send('debug', 'LAMA chat already exists');
      }
    } catch (error) {
      MessageBus.send('error', 'Failed to create LAMA chat:', error);
      throw error;
    }
  }

  /**
   * Wait for ChannelManager to finish initialization
   *
   * IMPORTANT: On fresh login, there may be ZERO channels - this is valid!
   * We're checking if ChannelManager is ready, not if channels exist.
   *
   * @throws Error if ChannelManager fails to initialize after max attempts
   */
  private async waitForChannelsLoaded(maxAttempts = 10, initialDelayMs = 50): Promise<void> {
    let attempt = 0;
    let delay = initialDelayMs;

    while (attempt < maxAttempts) {
      try {
        // Check if ChannelManager is ready by calling getMatchingChannelInfos()
        // If it returns (even empty array), ChannelManager is initialized
        const channels = await this.channelManager.getMatchingChannelInfos();

        // SUCCESS: ChannelManager is ready (even if 0 channels on fresh login)
        MessageBus.send('debug', `ChannelManager ready (${channels.length} channels found)`);
        return;
      } catch (error) {
        // ChannelManager not ready yet - keep polling
        attempt++;
        MessageBus.send('debug', `ChannelManager not ready, polling... (attempt ${attempt}/${maxAttempts})`);

        // Wait with exponential backoff (proper async pattern, not arbitrary delay)
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 1000); // Cap at 1 second
      }
    }

    // Fail fast - no fallbacks
    throw new Error(`[AITopicManager] ChannelManager failed to initialize after ${maxAttempts} attempts`);
  }

  /**
   * Scan existing conversations for AI participants and register them
   * Uses channel participants as source of truth
   */
  async scanExistingConversations(aiManager: any): Promise<number> {
    MessageBus.send('debug', 'SCAN START - Scanning existing conversations for AI participants...');

    try {
      // CRITICAL: Wait for channels to actually load (not just init() to return)
      // ChannelManager.init() returns before channels are fully loaded asynchronously
      await this.waitForChannelsLoaded();

      // Get all channels (now guaranteed to have loaded)
      const allChannels = await this.channelManager.getMatchingChannelInfos();
      MessageBus.send('debug', `Found ${allChannels.length} total channels`);

      // Log existing registered topics
      const existingTopics = Array.from(this._topicAIMap.keys());
      MessageBus.send('debug', `Already registered topics: [${existingTopics.join(', ')}]`);

      // Log available AI Persons
      MessageBus.send('debug', 'Checking what AI Persons are available...');

      let registeredCount = 0;

      for (const channelInfo of allChannels) {
        try {
          // Channel ID is NOT the same as topic ID - we need to get the topic from the channel
          // For AI topics, the channel.id is the topic ID (channels created by createGroupTopic use topic.id as channel.id)
          const topicId = channelInfo.id;

          MessageBus.send('debug', `Checking channel/topic: ${topicId}`);

          // Skip if already registered
          if (this._topicAIMap.has(topicId)) {
            const registeredAI = this._topicAIMap.get(topicId);
            MessageBus.send('debug', `  SKIP - already registered with AI Person: ${registeredAI?.toString().substring(0, 8)}...`);
            continue;
          }

          // Try to enter the topic room to verify it exists
          let topic;
          try {
            await this.topicModel.enterTopicRoom(topicId);
            topic = await this.topicModel.topics.queryById(topicId);
          } catch (e) {
            // Topic doesn't exist or can't be accessed
            MessageBus.send('debug', `  SKIP - topic doesn't exist or can't be accessed`);
            continue;
          }

          if (!topic) {
            MessageBus.send('debug', `  SKIP - topic not found in collection`);
            continue;
          }

          let aiPersonId: SHA256IdHash<Person> | null = null;

          // Check if topic has a group - all AI topics are group topics
          // Use topicGroupManager to check if the topic is a group topic
          let groupIdHash: SHA256IdHash<Group> | null = null;
          try {
            groupIdHash = await this.topicGroupManager?.getGroupForTopic(topicId) || null;
          } catch (e) {
            // Not a group topic or error accessing group
          }

          if (groupIdHash) {
            MessageBus.send('debug', `  Topic is a group topic, checking participants...`);
            const groupResult = await getObjectByIdHash(groupIdHash);
            const group = groupResult.obj as Group;

            // NEW one.core structure: Group.hashGroup → HashGroup.person
            if (group.hashGroup) {
              const hashGroup = await getObject(group.hashGroup as SHA256Hash<HashGroup>) as HashGroup<Person>;
              if (hashGroup.person) {
                MessageBus.send('debug', `  Group has ${hashGroup.person.size} participants`);
                // Check each participant in the group to find AI Person
                for (const memberId of hashGroup.person) {
                  const aiId = await aiManager.getAIId(memberId);
                  MessageBus.send('debug', `    - Participant ${memberId.toString().substring(0, 8)}... → AI ID: ${aiId || 'NOT AI'}`);
                  if (aiId) {
                    aiPersonId = memberId;
                    MessageBus.send('debug', `  FOUND AI participant in ${topicId}: ${aiId}`);
                    break;
                  }
                }
              } else {
                MessageBus.send('debug', `  Group hashGroup has no participants`);
              }
            } else {
              MessageBus.send('debug', `  Group has no hashGroup`);
            }
          } else {
            MessageBus.send('debug', `  SKIP - topic has no group (not a group chat)`);
          }

          // Register if AI participant found
          if (aiPersonId) {
            this._topicAIMap.set(topicId, aiPersonId);
            registeredCount++;
            const aiId = await aiManager.getAIId(aiPersonId);
            MessageBus.send('debug', `  REGISTERED topic ${topicId} with AI Person ${aiId} (${aiPersonId.toString().substring(0, 8)}...)`);
          } else {
            MessageBus.send('debug', `  SKIP - no AI participant found in topic ${topicId}`);
          }
        } catch (error) {
          MessageBus.send('alert', `  ERROR scanning topic:`, error);
        }
      }

      MessageBus.send('debug', `SCAN COMPLETE - Registered ${registeredCount} new AI topics`);
      return registeredCount;
    } catch (error) {
      MessageBus.send('error', 'SCAN FAILED:', error);
      throw error;
    }
  }

}
