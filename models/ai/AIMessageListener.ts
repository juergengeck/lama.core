/**
 * AIMessageListener
 *
 * Platform-agnostic message listener that monitors channel updates and triggers
 * AI responses when users send messages in AI topics.
 *
 * Responsibilities:
 * - Listen to channelManager.onUpdated() events
 * - Detect messages in AI topics based on Topic.aiParticipants settings
 * - Trigger AI response generation for responding AIs
 * - Debounce rapid updates
 *
 * This class is platform-agnostic and works on both browser and Node.js.
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import { getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
import type { ChannelInfo } from '@refinio/one.models/lib/recipes/ChannelRecipes.js';
import type { AIAssistantPlan } from '../../plans/AIAssistantPlan.js';
import { getRespondingAIs } from './AISettingsResolver.js';
import type { AI } from './AIManager.js';

export interface AIMessageListenerDeps {
    channelManager: ChannelManager;
    topicModel: TopicModel;
    aiPlan: AIAssistantPlan;
    ownerId?: SHA256IdHash<Person>;
}

/**
 * Listens for channel updates and triggers AI responses
 */
export class AIMessageListener {
    private deps: AIMessageListenerDeps;
    private unsubscribe: (() => void) | null = null;
    private debounceTimers: Map<string, any> = new Map();
    private readonly DEBOUNCE_MS = 0; // NO DELAYS - fail fast, process immediately
    // Track which AIs have responded to which user messages
    // Key: messageIdentifier, Value: Set of AI personIds that have responded
    private aiResponseTracking: Map<string, Set<string>> = new Map();

    constructor(deps: AIMessageListenerDeps) {
        this.deps = deps;
    }

    /**
     * Start listening for channel updates
     */
    async start(): Promise<void> {
        if (this.unsubscribe) {
            console.log('[AIMessageListener] Already started - skipping');
            return;
        }

        console.log('[AIMessageListener] Starting message listener...');
        console.log('[AIMessageListener] 🔍 DEBUG: Subscribing to channelManager:', this.deps.channelManager);
        console.log('[AIMessageListener] 🔍 DEBUG: channelManager.onUpdated is a function?', typeof this.deps.channelManager.onUpdated === 'function');

        // Register channel update listener
        this.unsubscribe = this.deps.channelManager.onUpdated(async (
            channelInfoIdHash,
            channelParticipants,
            channelOwner,
            timeOfEarliestChange,
            data
        ) => {
            // CRITICAL: Skip local channel updates - AI is triggered directly from ChatPlan.sendMessage()
            // This listener only handles REMOTE messages (from P2P sync)
            // Without this check, we'd get duplicate AI responses (one from IPC, one from listener)
            const isOurChannel = channelOwner === this.deps.ownerId;
            if (isOurChannel) {
                console.log(`[AIMessageListener] ⏭️ Ignoring local channel update (AI triggered directly): ${channelInfoIdHash.substring(0, 16)}`);
                return;
            }

            // CRITICAL: Ignore updates from AI channels (those are AI's own responses)
            const isAIChannel = channelOwner && this.deps.aiPlan.isAIPerson(channelOwner);
            if (isAIChannel) {
                console.log(`[AIMessageListener] ⏭️ Ignoring update from AI channel: ${channelInfoIdHash.substring(0, 16)}`);
                return;
            }

            // Debounce frequent updates using channelInfoIdHash (stable identifier)
            const existingTimer = this.debounceTimers.get(channelInfoIdHash);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timerId = setTimeout(async () => {
                this.debounceTimers.delete(channelInfoIdHash);

                console.log(`[AIMessageListener] 🔔 Channel update received - channelInfoIdHash: ${channelInfoIdHash}`);

                // Find topic by matching channel discriminator
                // In group chats, each participant has their own channel with a different channelInfoIdHash
                // but all channels in the same topic share the same discriminator
                const allTopics = await this.deps.topicModel.topics.all();

                // First try exact match (works for P2P and topic owner's channel)
                let topic = allTopics.find(t => t.channel === channelInfoIdHash);

                // If no exact match, look up by discriminator (group chat with multiple channels)
                if (!topic) {
                    try {
                        // Get incoming channel's discriminator
                        const incomingChannelResult = await getObjectByIdHash(channelInfoIdHash);
                        const incomingChannel = incomingChannelResult.obj as ChannelInfo;
                        const incomingDiscriminator = incomingChannel.discriminator;

                        console.log(`[AIMessageListener] 🔍 Looking up topic by discriminator: ${incomingDiscriminator?.substring(0, 16)}`);

                        // Find topic where Topic.channel has matching discriminator
                        for (const t of allTopics) {
                            const topicChannelResult = await getObjectByIdHash(t.channel);
                            const topicChannel = topicChannelResult.obj as ChannelInfo;
                            if (topicChannel.discriminator === incomingDiscriminator) {
                                topic = t;
                                console.log(`[AIMessageListener] ✅ Found topic by discriminator match`);
                                break;
                            }
                        }
                    } catch (err) {
                        console.error(`[AIMessageListener] Error looking up channel by discriminator:`, err);
                    }
                }

                if (!topic) {
                    console.log(`[AIMessageListener] ⏭️  No topic found for channelInfoIdHash: ${channelInfoIdHash}`);
                    return;
                }

                // Calculate topic ID hash once for all operations
                const topicIdHash = await calculateIdHashOfObj(topic);
                const topicDisplayName = topic.displayName ?? topic.originalName ?? topicIdHash.substring(0, 16);

                // Check if this topic has responding AIs based on settings
                // Priority: Check Topic.aiParticipants (new settings) → fallback to isAITopic (legacy)
                let respondingAIPersonIds: SHA256IdHash<Person>[] = [];

                if (topic.aiParticipants && topic.aiParticipants.size > 0) {
                    // New settings-based check
                    try {
                        const aiManager = this.deps.aiPlan.getAIManager?.();
                        if (aiManager) {
                            const getAI = async (personId: SHA256IdHash<Person>): Promise<AI | null> => {
                                return aiManager.getAI(personId);
                            };
                            respondingAIPersonIds = await getRespondingAIs(topic.aiParticipants, getAI);
                        }
                    } catch (err) {
                        console.log(`[AIMessageListener] Error checking AI settings, falling back to legacy:`, err);
                    }
                }

                // Fallback to legacy isAITopic check if no settings-based AIs found
                if (respondingAIPersonIds.length === 0) {
                    const isAI = this.deps.aiPlan.isAITopic(topicIdHash);
                    console.log(`[AIMessageListener] 🤖 Is AI topic (legacy)? ${isAI} for topic: ${topicDisplayName}`);
                    if (!isAI) {
                        console.log(`[AIMessageListener] ⏭️  Skipping non-AI topic: ${topicDisplayName}`);
                        return;
                    }
                    // Legacy mode: single AI from _topicAIMap
                    const legacyAI = this.deps.aiPlan.getAIPersonForTopic?.(topicIdHash);
                    if (legacyAI) {
                        respondingAIPersonIds = [legacyAI as SHA256IdHash<Person>];
                    }
                } else {
                    console.log(`[AIMessageListener] 🤖 Settings-based: ${respondingAIPersonIds.length} AIs should respond for topic: ${topicDisplayName}`);
                }

                if (respondingAIPersonIds.length === 0) {
                    console.log(`[AIMessageListener] ⏭️  No responding AIs for topic: ${topicDisplayName}`);
                    return;
                }

                try {
                    await this.handleChannelUpdate(topic, respondingAIPersonIds);
                } catch (error) {
                    console.error(`[AIMessageListener] Error processing channel update:`, error);
                }
            }, this.DEBOUNCE_MS);

            this.debounceTimers.set(channelInfoIdHash, timerId);
        });

        console.log('[AIMessageListener] Message listener started successfully');
    }

    /**
     * Stop listening for channel updates
     */
    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
            console.log('[AIMessageListener] Message listener stopped');
        }

        // Clear all timers
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        // Clear AI response tracking
        this.aiResponseTracking.clear();
    }

    /**
     * Handle a channel update - check if AI should respond
     * @param topic - The topic where the update occurred
     * @param respondingAIPersonIds - Person IDs of AIs that should respond (from settings)
     */
    private async handleChannelUpdate(
        topic: Topic,
        respondingAIPersonIds: SHA256IdHash<Person>[]
    ): Promise<void> {
        // Calculate topic ID hash for all operations
        const topicIdHash = await calculateIdHashOfObj(topic);
        const topicDisplayName = topic.displayName ?? topic.originalName ?? topicIdHash.substring(0, 16);

        console.log(`[AIMessageListener] Processing channel update for topic: ${topicDisplayName}`);

        try {
            // Enter the topic room to access messages
            const topicRoom = await this.deps.topicModel.enterTopicRoom(topicIdHash as unknown as SHA256IdHash<Topic>);
            if (!topicRoom) {
                console.error(`[AIMessageListener] Could not enter topic room ${topicDisplayName}`);
                return;
            }

            // Get all messages from the topic
            const messages = await topicRoom.retrieveAllMessages();
            console.log(`[AIMessageListener] Found ${messages.length} messages in topic`);

            // If topic is empty, skip (welcome message handled elsewhere)
            if (messages.length === 0) {
                console.log(`[AIMessageListener] Empty topic ${topicDisplayName} - skipping`);
                return;
            }

            // Find the last USER message (non-AI) that needs responses
            // Walk backwards through messages to find it
            let lastUserMessage = null;
            for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                const sender = msg.data?.sender || msg.author;
                const isAI = this.deps.aiPlan.isAIPerson(sender);
                if (!isAI) {
                    lastUserMessage = msg;
                    break;
                }
            }

            if (!lastUserMessage) {
                console.log(`[AIMessageListener] No user message found in topic - skipping`);
                return;
            }

            const messageText = lastUserMessage.data?.text;
            const messageSender = lastUserMessage.data?.sender || lastUserMessage.author;

            console.log(`[AIMessageListener] Last user message from ${messageSender?.toString().substring(0, 8)}...: text="${messageText?.substring(0, 50)}..."`);

            // Check if message is recent (within last 30 seconds to allow for multi-AI responses)
            const messageAge = Date.now() - new Date(lastUserMessage.creationTime).getTime();
            const isRecent = messageAge < 30000;

            if (!isRecent) {
                console.log(`[AIMessageListener] User message too old (${messageAge}ms) - skipping`);
                return;
            }

            // Check if message has content
            if (!messageText || !messageText.trim()) {
                console.log(`[AIMessageListener] Empty message - skipping`);
                return;
            }

            // Create a unique identifier for this user message
            const messageIdentifier = `${topicIdHash}-${lastUserMessage.creationTime}-${messageSender}`;

            // Get or create tracking set for this message
            if (!this.aiResponseTracking.has(messageIdentifier)) {
                this.aiResponseTracking.set(messageIdentifier, new Set());
            }
            const respondedAIs = this.aiResponseTracking.get(messageIdentifier)!;

            // Find AIs that haven't responded yet
            const pendingAIs = respondingAIPersonIds.filter(
                aiId => !respondedAIs.has(aiId.toString())
            );

            if (pendingAIs.length === 0) {
                console.log(`[AIMessageListener] All ${respondingAIPersonIds.length} AIs have already responded to this message`);
                return;
            }

            console.log(`[AIMessageListener] ${pendingAIs.length}/${respondingAIPersonIds.length} AIs pending for message: "${messageText.substring(0, 30)}..."`);

            // Clean up old tracking entries (keep only last 50 messages)
            if (this.aiResponseTracking.size > 50) {
                const entries = Array.from(this.aiResponseTracking.keys());
                entries.slice(0, entries.length - 50).forEach(key => this.aiResponseTracking.delete(key));
            }

            // Process message for each pending AI independently
            for (const aiPersonId of pendingAIs) {
                // Mark this AI as having responded BEFORE triggering (prevents re-entry)
                respondedAIs.add(aiPersonId.toString());

                console.log(`[AIMessageListener] Triggering response from AI: ${aiPersonId.substring(0, 8)}...`);

                // CRITICAL: Register AI topic BEFORE processing message
                // This sets up HashGroup access for the AI's channel, enabling CHUM sync
                // Without this, AI messages won't sync to remote peers
                await this.deps.aiPlan.registerAITopic(topicIdHash, aiPersonId);

                // Delegate to AIAssistantPlan for AI response generation
                // Don't await - let AIs respond independently/in parallel
                this.deps.aiPlan.processMessage(topicIdHash, messageText, messageSender, aiPersonId)
                    .catch(err => console.error(`[AIMessageListener] AI ${aiPersonId.substring(0, 8)} failed:`, err));
            }

        } catch (error) {
            console.error(`[AIMessageListener] Error handling channel update:`, error);
        }
    }
}
