/**
 * AITopicManager
 *
 * Manages topic-to-model mappings and topic lifecycle for AI conversations.
 * This component tracks which topics are AI-enabled and which models they use.
 *
 * Responsibilities:
 * - Register AI topics with their associated models
 * - Track topic loading states
 * - Manage default AI model selection
 * - Create and register default chats (Hi and LAMA)
 * - Scan existing conversations for AI participants
 *
 * @deprecated Display name management is deprecated.
 * Use TopicV2.screenName instead (see TopicModelV2 in one.models).
 * The _topicDisplayNames, getTopicDisplayName(), and setTopicDisplayName()
 * will be removed after TopicV2 migration is complete.
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
  // @deprecated Use TopicV2.screenName instead
  private _topicDisplayNames: Record<string, string>;

  // Topic AI modes (topicId → mode)
  private topicAIModes: Map<string, AIMode>;

  // Topic priorities (topicId → priority level, 1-10 with 10 being highest)
  private topicPriorities: Map<string, number>;

  // Default model ID (kept for backwards compatibility, will be phased out)
  private defaultModelId: string | null;

  // Mutex to prevent concurrent ensureDefaultChats calls
  private ensuringDefaultChats: Promise<void> | null = null;

  // Default AI topic IDs (set when ensureDefaultChats creates them)
  // Format: owner:name (same as group chats)
  private _hiTopicId: string | null = null;
  private _lamaTopicId: string | null = null;

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

  // ============================================================
  // Default AI Topic Helpers
  // ============================================================

  /**
   * Check if a topic is the Hi default chat
   * Uses stable format: owner:Hi (not owner:aiPersonId)
   */
  isHiTopic(topicId: string): boolean {
    // Check cached ID first
    if (this._hiTopicId !== null && topicId === this._hiTopicId) {
      return true;
    }
    // Fallback: check stable format pattern
    return topicId.endsWith(':Hi');
  }

  /**
   * Check if a topic is the LAMA (private memory) default chat
   * Uses stable format: owner:LAMA (not owner:privateAiPersonId)
   */
  isLamaTopic(topicId: string): boolean {
    // Check cached ID first
    if (this._lamaTopicId !== null && topicId === this._lamaTopicId) {
      return true;
    }
    // Fallback: check stable format pattern
    return topicId.endsWith(':LAMA');
  }

  /**
   * Check if a topic is a default AI topic (Hi or LAMA)
   */
  isDefaultAITopic(topicId: string): boolean {
    return this.isHiTopic(topicId) || this.isLamaTopic(topicId);
  }

  /**
   * Get the Hi topic ID (null if not created yet)
   */
  getHiTopicId(): string | null {
    return this._hiTopicId;
  }

  /**
   * Get the LAMA topic ID (null if not created yet)
   */
  getLamaTopicId(): string | null {
    return this._lamaTopicId;
  }

  /**
   * Check if a topic uses the private AI (for memory/context isolation)
   * Currently only LAMA uses the private AI
   */
  isPrivateAITopic(topicId: string): boolean {
    return this.isLamaTopic(topicId);
  }

  /**
   * Get the default topic type for a topic ID
   * @returns 'hi' | 'lama' | null
   */
  getDefaultTopicType(topicId: string): 'hi' | 'lama' | null {
    if (this.isHiTopic(topicId)) return 'hi';
    if (this.isLamaTopic(topicId)) return 'lama';
    return null;
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
   * @deprecated Use TopicV2.screenName instead. This method will be removed after TopicV2 migration.
   */
  getTopicDisplayName(topicId: string): string | undefined {
    MessageBus.send('debug', '[DEPRECATED] getTopicDisplayName - use TopicV2.screenName instead');
    return this._topicDisplayNames[topicId];
  }

  /**
   * Set topic display name
   * @deprecated Use TopicModelV2.setScreenName() instead. This method will be removed after TopicV2 migration.
   */
  setTopicDisplayName(topicId: string, name: string): void {
    MessageBus.send('debug', '[DEPRECATED] setTopicDisplayName - use TopicModelV2.setScreenName() instead');
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
   *
   * @param aiPersonId - The AI Person ID for Hi chat (from AI creation)
   * @param privateAIPersonId - The AI Person ID for LAMA chat (with -private suffix)
   * @param onTopicCreated - Callback when a topic is created
   */
  async ensureDefaultChats(
    aiPersonId: SHA256IdHash<Person>,
    privateAIPersonId: SHA256IdHash<Person>,
    onTopicCreated?: (topicId: string, aiPersonId: SHA256IdHash<Person>) => Promise<void>
  ): Promise<void> {
    if (!aiPersonId) {
      throw new Error('[AITopicManager] ensureDefaultChats requires aiPersonId - AI creation must complete first');
    }
    if (!privateAIPersonId) {
      throw new Error('[AITopicManager] ensureDefaultChats requires privateAIPersonId - AI creation must complete first');
    }

    // If already ensuring, return the existing promise (prevents race condition)
    if (this.ensuringDefaultChats) {
      MessageBus.send('debug', 'ensureDefaultChats already in progress, waiting...');
      return this.ensuringDefaultChats;
    }

    // Create and store the promise
    this.ensuringDefaultChats = this.doEnsureDefaultChats(aiPersonId, privateAIPersonId, onTopicCreated);

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
   *
   * @param aiPersonId - The AI Person ID for Hi chat
   * @param privateAIPersonId - The AI Person ID for LAMA chat (with -private suffix)
   * @param onTopicCreated - Callback when a topic is created
   */
  private async doEnsureDefaultChats(
    aiPersonId: SHA256IdHash<Person>,
    privateAIPersonId: SHA256IdHash<Person>,
    onTopicCreated?: (topicId: string, aiPersonId: SHA256IdHash<Person>) => Promise<void>
  ): Promise<void> {
    MessageBus.send('debug', 'Ensuring default AI chats...');

    if (!this.defaultModelId) {
      throw new Error('No default model set - cannot create default chats');
    }

    // Two separate AI Persons for two separate chats (using owned channel format):
    // - Hi: owner=user, name="Hi" (stable topic ID)
    // - LAMA: owner=user, name="LAMA" (stable topic ID)
    // The AI person is tracked separately via registerAITopic() and can change on model switch
    console.log(`[AITopicManager] Hi chat AI Person: ${aiPersonId}`);
    console.log(`[AITopicManager] LAMA chat AI Person: ${privateAIPersonId}`);

    // Create Hi chat (static welcome message - no LLM generation)
    console.log('[AITopicManager] Creating Hi chat...');
    await this.ensureHiChat(this.defaultModelId, aiPersonId, onTopicCreated);
    console.log('[AITopicManager] Hi chat done');

    // Create LAMA chat (LLM-generated welcome message) - uses PRIVATE AI Person
    console.log('[AITopicManager] Creating LAMA chat...');
    await this.ensureLamaChat(this.defaultModelId, privateAIPersonId, onTopicCreated);
    console.log('[AITopicManager] LAMA chat done');
  }

  /**
   * Check if a topic exists and register it if found
   * Returns true if the topic exists, false otherwise
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  /**
   * Ensure Hi chat exists with static welcome message
   * NOTE: Hi chat uses a STATIC welcome message - no LLM generation
   *
   * Creates a topic with owned channel format (owner:name).
   * This allows natural conversion to group chat when participants are added.
   */
  private async ensureHiChat(
    modelId: string,
    aiPersonId: SHA256IdHash<Person>,
    _onTopicCreated?: (topicId: string, aiPersonId: SHA256IdHash<Person>) => Promise<void>
  ): Promise<void> {
    MessageBus.send('debug', 'Ensuring Hi chat...');

    try {
      // Get user's person ID
      const userPersonId = await this.leuteModel.myMainIdentity();

      // Use stable owned channel format: owner:name (name is "Hi", not aiPersonId)
      // This ensures the same topic is found even when AI person changes on model switch
      const topicId = `${userPersonId}:Hi`;

      MessageBus.send('debug', `Hi chat topic ID: ${topicId.substring(0, 30)}...`);

      let topicRoom: any;
      let needsWelcome = false;

      // Check if topic already exists
      let topic: any = await this.topicModel.findTopic(topicId);

      if (!topic) {
        // Create topic with owned channel - pass userPersonId as owner so posting works
        topic = await this.topicModel.createTopic('Hi', [userPersonId, aiPersonId], topicId, userPersonId);
        needsWelcome = true;

        // Create Group for this topic so ChatPlan can find participants
        if (this.topicGroupManager) {
          MessageBus.send('debug', 'Creating Group for Hi chat');
          await this.topicGroupManager.getOrCreateConversationGroup(topicId, aiPersonId);
        }

        // Create Assembly for this topic
        if (this.assemblyManager) {
          MessageBus.send('debug', 'Creating Assembly for Hi chat');
          await this.assemblyManager.createChatAssembly(topicId, 'Hi');
        }
      } else {
        // Topic exists - update AI person mapping (may have changed on model switch)
        MessageBus.send('debug', `Hi chat exists, updating AI person mapping to ${aiPersonId.substring(0, 8)}...`);
        topicRoom = await this.topicModel.enterTopicRoom(topic.id);
        const messages = await topicRoom.retrieveAllMessages();
        needsWelcome = messages.length === 0;
      }

      if (!topicRoom) {
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
      }

      // Register as AI topic with display name
      this.registerAITopic(topicId, aiPersonId);
      this.setTopicDisplayName(topicId, 'Hi');
      this._hiTopicId = topicId;  // Track as default Hi topic

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
        // Owned channels use current user as channel owner (default)
        await topicRoom.sendMessage(welcomeMessage, aiPersonId);
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
   *
   * Creates a topic with owned channel format (owner:name).
   * This allows natural conversion to group chat when participants are added.
   */
  private async ensureLamaChat(
    _privateModelId: string,
    privateAiPersonId: SHA256IdHash<Person>,
    onTopicCreated?: (topicId: string, aiPersonId: SHA256IdHash<Person>) => Promise<void>
  ): Promise<void> {
    MessageBus.send('debug', `Ensuring LAMA chat with AI Person: ${privateAiPersonId.toString().substring(0, 8)}...`);

    try {
      // Get user's person ID
      const userPersonId = await this.leuteModel.myMainIdentity();

      // Use stable owned channel format: owner:name (name is "LAMA", not privateAiPersonId)
      // This ensures the same topic is found even when AI person changes on model switch
      const topicId = `${userPersonId}:LAMA`;

      MessageBus.send('debug', `LAMA chat topic ID: ${topicId.substring(0, 30)}...`);

      let topicRoom: any;
      let needsWelcome = false;

      // Check if topic already exists
      let topic: any = await this.topicModel.findTopic(topicId);

      if (!topic) {
        // Create topic with owned channel - pass userPersonId as owner so posting works
        topic = await this.topicModel.createTopic('LAMA', [userPersonId, privateAiPersonId], topicId, userPersonId);
        needsWelcome = true;

        // Create Group for this topic so ChatPlan can find participants
        if (this.topicGroupManager) {
          MessageBus.send('debug', 'Creating Group for LAMA chat');
          await this.topicGroupManager.getOrCreateConversationGroup(topicId, privateAiPersonId);
        }

        // Create Assembly for this topic
        if (this.assemblyManager) {
          MessageBus.send('debug', 'Creating Assembly for LAMA chat');
          await this.assemblyManager.createChatAssembly(topicId, 'LAMA');
        }
      } else {
        // Topic exists - update AI person mapping (may have changed on model switch)
        MessageBus.send('debug', `LAMA chat exists, updating AI person mapping to ${privateAiPersonId.substring(0, 8)}...`);
        topicRoom = await this.topicModel.enterTopicRoom(topic.id);
        const messages = await topicRoom.retrieveAllMessages();
        needsWelcome = messages.length === 0;
      }

      if (!topicRoom) {
        topicRoom = await this.topicModel.enterTopicRoom(topicId);
      }

      // Register as AI topic with display name
      this.registerAITopic(topicId, privateAiPersonId);
      this.setTopicDisplayName(topicId, 'LAMA');
      this._lamaTopicId = topicId;  // Track as default LAMA topic

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
   * Uses Topic participants as source of truth
   */
  async scanExistingConversations(aiManager: any): Promise<number> {
    MessageBus.send('debug', 'SCAN START - Scanning existing conversations for AI participants...');

    try {
      // CRITICAL: Wait for channels to actually load (not just init() to return)
      // ChannelManager.init() returns before channels are fully loaded asynchronously
      await this.waitForChannelsLoaded();

      // Get all topics from TopicRegistry
      const allTopics = await this.topicModel.topics.all();
      MessageBus.send('debug', `Found ${allTopics.length} total topics`);

      // Log existing registered topics
      const existingTopics = Array.from(this._topicAIMap.keys());
      MessageBus.send('debug', `Already registered topics: [${existingTopics.join(', ')}]`);

      // Log available AI Persons
      MessageBus.send('debug', 'Checking what AI Persons are available...');

      let registeredCount = 0;

      for (const topic of allTopics) {
        try {
          // Get topicId from Topic object
          const topicId = topic.id;

          MessageBus.send('debug', `Checking topic: ${topicId}`);

          // Skip if already registered
          if (this._topicAIMap.has(topicId)) {
            const registeredAI = this._topicAIMap.get(topicId);
            MessageBus.send('debug', `  SKIP - already registered with AI Person: ${registeredAI?.toString().substring(0, 8)}...`);
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
