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
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
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
    private processedMessages: Map<string, Set<string>> = new Map(); // topicId -> Set of message hashes

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
            // Debounce frequent updates using channelInfoIdHash (stable identifier)
            const existingTimer = this.debounceTimers.get(channelInfoIdHash);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timerId = setTimeout(async () => {
                this.debounceTimers.delete(channelInfoIdHash);

                console.log(`[AIMessageListener] 🔔 Channel update received - channelInfoIdHash: ${channelInfoIdHash}`);

                // Find topic by matching channel ID hash (Topic.channel === channelInfoIdHash)
                const allTopics = await this.deps.topicModel.topics.all();
                const topic = allTopics.find(t => t.channel === channelInfoIdHash);

                if (!topic) {
                    console.log(`[AIMessageListener] ⏭️  No topic found for channelInfoIdHash: ${channelInfoIdHash}`);
                    return;
                }

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
                    const isAI = this.deps.aiPlan.isAITopic(topic.id);
                    console.log(`[AIMessageListener] 🤖 Is AI topic (legacy)? ${isAI} for topic.id: ${topic.id}`);
                    if (!isAI) {
                        console.log(`[AIMessageListener] ⏭️  Skipping non-AI topic: ${topic.id}`);
                        return;
                    }
                    // Legacy mode: single AI from _topicAIMap
                    const legacyAI = this.deps.aiPlan.getAIPersonForTopic?.(topic.id);
                    if (legacyAI) {
                        respondingAIPersonIds = [legacyAI as SHA256IdHash<Person>];
                    }
                } else {
                    console.log(`[AIMessageListener] 🤖 Settings-based: ${respondingAIPersonIds.length} AIs should respond for topic.id: ${topic.id}`);
                }

                if (respondingAIPersonIds.length === 0) {
                    console.log(`[AIMessageListener] ⏭️  No responding AIs for topic: ${topic.id}`);
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

        // Clear processed messages tracking
        this.processedMessages.clear();
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
        console.log(`[AIMessageListener] Processing channel update for topic.id: ${topic.id}`);

        try {
            // Enter the topic room to access messages
            const topicRoom = await this.deps.topicModel.enterTopicRoom(topic.id);
            if (!topicRoom) {
                console.error(`[AIMessageListener] Could not enter topic room ${topic.id}`);
                return;
            }

            // Get all messages from the topic
            const messages = await topicRoom.retrieveAllMessages();
            console.log(`[AIMessageListener] Found ${messages.length} messages in topic`);

            // If topic is empty, skip (welcome message handled elsewhere)
            if (messages.length === 0) {
                console.log(`[AIMessageListener] Empty topic ${topic.id} - skipping`);
                return;
            }

            // Get the last message
            const lastMessage = messages[messages.length - 1];
            const messageText = lastMessage.data?.text;
            const messageSender = lastMessage.data?.sender || lastMessage.author;

            // Check if message is from one of our responding AIs (skip if yes)
            const isFromRespondingAI = respondingAIPersonIds.some(
                aiId => aiId === messageSender
            );
            // Also check using legacy isAIPerson for backwards compatibility
            const isFromAnyAI = this.deps.aiPlan.isAIPerson(messageSender);

            console.log(`[AIMessageListener] Last message from ${messageSender?.toString().substring(0, 8)}...: isFromRespondingAI=${isFromRespondingAI}, isFromAnyAI=${isFromAnyAI}, text="${messageText?.substring(0, 50)}..."`);

            if (isFromRespondingAI || isFromAnyAI) {
                console.log(`[AIMessageListener] Ignoring AI message from ${messageSender?.toString().substring(0, 8)}...`);
                return;
            }

            // Check if message is recent (within last 10 seconds to avoid old messages)
            const messageAge = Date.now() - new Date(lastMessage.creationTime).getTime();
            const isRecent = messageAge < 10000;

            if (!isRecent) {
                console.log(`[AIMessageListener] Message too old (${messageAge}ms) - skipping`);
                return;
            }

            // Check if message has content
            if (!messageText || !messageText.trim()) {
                console.log(`[AIMessageListener] Empty message - skipping`);
                return;
            }

            // Create a unique identifier for this message (timestamp + sender + text hash)
            const messageIdentifier = `${lastMessage.creationTime}-${messageSender}-${messageText.substring(0, 50)}`;

            // Check if we've already processed this message
            if (!this.processedMessages.has(topic.id)) {
                this.processedMessages.set(topic.id, new Set());
            }
            const topicProcessedMessages = this.processedMessages.get(topic.id)!

            if (topicProcessedMessages.has(messageIdentifier)) {
                console.log(`[AIMessageListener] Already processed this message - skipping duplicate`);
                return;
            }

            // Mark message as processed
            topicProcessedMessages.add(messageIdentifier);

            // Clean up old entries (keep only last 100 per topic)
            if (topicProcessedMessages.size > 100) {
                const entries = Array.from(topicProcessedMessages);
                entries.slice(0, entries.length - 100).forEach(entry => topicProcessedMessages.delete(entry));
            }

            console.log(`[AIMessageListener] Processing user message for ${respondingAIPersonIds.length} AIs: "${messageText}"`);

            // Process message for each responding AI
            // In the future, this could be parallelized or have per-AI logic
            for (const aiPersonId of respondingAIPersonIds) {
                console.log(`[AIMessageListener] Triggering response from AI: ${aiPersonId.substring(0, 8)}...`);
                // Delegate to AIAssistantPlan for AI response generation
                // The plan will use the AI's settings to determine how to respond
                await this.deps.aiPlan.processMessage(topic.id, messageText, messageSender, aiPersonId);
            }

        } catch (error) {
            console.error(`[AIMessageListener] Error handling channel update:`, error);
        }
    }
}
