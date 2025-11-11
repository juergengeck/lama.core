/**
 * AIMessageListener
 *
 * Platform-agnostic message listener that monitors channel updates and triggers
 * AI responses when users send messages in AI topics.
 *
 * Responsibilities:
 * - Listen to channelManager.onUpdated() events
 * - Detect messages in AI topics
 * - Trigger AI response generation via AIAssistantPlan
 * - Debounce rapid updates
 *
 * This class is platform-agnostic and works on both browser and Node.js.
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type { AIAssistantPlan } from '../../plans/AIAssistantPlan.js';

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

        // Register channel update listener
        this.unsubscribe = this.deps.channelManager.onUpdated(async (
            channelInfoIdHash,
            channelId,
            channelOwner,
            timeOfEarliestChange,
            data
        ) => {
            // Debounce frequent updates
            const existingTimer = this.debounceTimers.get(channelId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timerId = setTimeout(async () => {
                this.debounceTimers.delete(channelId);

                console.log(`[AIMessageListener] 🔔 Channel update received for: ${channelId}`);

                // Check if this is an AI topic
                const isAI = this.deps.aiPlan.isAITopic(channelId);
                console.log(`[AIMessageListener] 🤖 Is AI topic? ${isAI} for channel: ${channelId}`);

                if (!isAI) {
                    console.log(`[AIMessageListener] ⏭️  Skipping non-AI topic: ${channelId}`);
                    return;
                }

                try{
                    await this.handleChannelUpdate(channelId);
                } catch (error) {
                    console.error(`[AIMessageListener] Error processing channel update:`, error);
                }
            }, this.DEBOUNCE_MS);

            this.debounceTimers.set(channelId, timerId);
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
     */
    private async handleChannelUpdate(channelId: string): Promise<void> {
        console.log(`[AIMessageListener] Processing channel update for ${channelId}`);

        try {
            // Enter the topic room to access messages
            const topicRoom = await this.deps.topicModel.enterTopicRoom(channelId);
            if (!topicRoom) {
                console.error(`[AIMessageListener] Could not enter topic room ${channelId}`);
                return;
            }

            // Get all messages from the topic
            const messages = await topicRoom.retrieveAllMessages();
            console.log(`[AIMessageListener] Found ${messages.length} messages in topic`);

            // If topic is empty, skip (welcome message handled elsewhere)
            if (messages.length === 0) {
                console.log(`[AIMessageListener] Empty topic ${channelId} - skipping`);
                return;
            }

            // Get the last message
            const lastMessage = messages[messages.length - 1];
            const messageText = lastMessage.data?.text;
            const messageSender = lastMessage.data?.sender || lastMessage.author;

            // Check if message is from AI (skip if yes)
            const isFromAI = this.deps.aiPlan.isAIPerson(messageSender);
            console.log(`[AIMessageListener] Last message from ${messageSender?.toString().substring(0, 8)}...: isAI=${isFromAI}, text="${messageText?.substring(0, 50)}..."`);

            if (isFromAI) {
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
            if (!this.processedMessages.has(channelId)) {
                this.processedMessages.set(channelId, new Set());
            }
            const topicProcessedMessages = this.processedMessages.get(channelId)!;

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

            console.log(`[AIMessageListener] Processing user message: "${messageText}"`);

            // Delegate to AIAssistantPlan for AI response generation
            await this.deps.aiPlan.processMessage(channelId, messageText, messageSender);

        } catch (error) {
            console.error(`[AIMessageListener] Error handling channel update:`, error);
        }
    }
}
