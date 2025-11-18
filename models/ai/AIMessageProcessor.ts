/**
 * AIMessageProcessor
 *
 * Handles message queuing and processing for AI conversations.
 * Orchestrates LLM invocation, streaming responses, and analysis.
 *
 * Responsibilities:
 * - Queue messages when topics are initializing
 * - Process messages and generate AI responses
 * - Invoke LLM with streaming support
 * - Handle analysis results (subjects/keywords via AITaskManager)
 * - Emit platform-agnostic events for UI updates
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type { IAIMessageProcessor, IAIPromptBuilder, IAITaskManager } from './interfaces.js';
import type { LLMModelInfo, MessageQueueEntry } from './types.js';
import type { LLMPlatform } from '../../services/llm-platform.js';
import OneObjectCache from '@refinio/one.models/lib/api/utils/caches/OneObjectCache.js';
import { formatForStandardAPI } from '../../services/context-budget-manager.js';

export class AIMessageProcessor implements IAIMessageProcessor {
  // Circular dependencies - injected via setters
  private promptBuilder?: IAIPromptBuilder;
  private taskManager?: IAITaskManager;
  private aiAssistant?: any; // AIAssistantHandler (circular dependency)

  // Message queues (topicId → queued messages)
  private pendingMessageQueues: Map<string, MessageQueueEntry[]>;

  // Welcome generation tracking (topicId → promise)
  private welcomeGenerationInProgress: Map<string, Promise<any>>;

  // Available LLM models
  private availableModels: LLMModelInfo[];

  // Person object cache for performance
  private personCache: OneObjectCache<Person>;

  constructor(
    private channelManager: ChannelManager,
    private llmManager: any, // LLMManager interface
    _leuteModel: LeuteModel,
    private topicManager: any, // AITopicManager
    private aiManager: any, // AIManager (replaces AIContactManager)
    private topicModel: TopicModel, // For storing messages in ONE.core
    _stateManager?: any, // Optional state manager for tracking
    private platform?: LLMPlatform, // Optional platform for UI events
    private topicAnalysisModel?: any // Optional topic analysis model for subject/keyword creation
  ) {
    this.pendingMessageQueues = new Map();
    this.welcomeGenerationInProgress = new Map();
    this.availableModels = [];
    this.personCache = new OneObjectCache<Person>(['Person']);

    // Handle cache errors
    this.personCache.onError((error) => {
      console.error('[AIMessageProcessor] Person cache error:', error);
    });
  }

  /**
   * Set AI assistant handler (circular dependency resolution)
   * CRITICAL: MessageProcessor should call through AIAssistantHandler, not llmManager directly
   */
  setAIAssistant(assistant: any): void {
    this.aiAssistant = assistant;
  }

  /**
   * Set prompt builder (circular dependency resolution)
   */
  setPromptBuilder(builder: IAIPromptBuilder): void {
    this.promptBuilder = builder;
  }

  /**
   * Set task manager (for IoM analysis)
   */
  setTaskManager(manager: IAITaskManager): void {
    this.taskManager = manager;
  }

  /**
   * Set available LLM models
   */
  setAvailableLLMModels(models: LLMModelInfo[]): void {
    this.availableModels = models;
  }


  /**
   * Handle a new topic message
   * Called when a message is posted to a topic channel
   */
  async handleTopicMessage(topicId: string, message: any): Promise<void> {
    // Extract message details
    const text = (message as any).data?.text || (message as any).text;
    const senderId = (message as any).data?.sender || (message as any).author;

    if (!text || !senderId) {
      return;
    }

    // Check if this is an AI topic
    if (!this.topicManager.isAITopic(topicId)) {
      return;
    }

    // Process the message
    await this.processMessage(topicId, text, senderId);
  }

  /**
   * Process a message and generate AI response
   */
  async processMessage(
    topicId: string,
    message: string,
    senderId: SHA256IdHash<Person>
  ): Promise<string | null> {
    const t0 = Date.now()
    console.log(`[AIMessageProcessor] ⏱️  T+0ms: Processing message for topic ${topicId}: "${message}"`);

    // Check if welcome generation is in progress for this topic
    const welcomeInProgress = this.welcomeGenerationInProgress.get(topicId);
    if (welcomeInProgress) {
      console.log(`[AIMessageProcessor] Welcome generation in progress for ${topicId}, queuing message`);
      // Queue this message to be processed after welcome is complete
      if (!this.pendingMessageQueues.has(topicId)) {
        this.pendingMessageQueues.set(topicId, []);
      }
      // Get topic priority from AITopicManager
      const priority = this.topicManager.getTopicPriority(topicId);
      this.pendingMessageQueues.get(topicId)!.push({
        topicId,
        text: message,
        senderId,
        queuedAt: Date.now(),
        priority,
      });
      return null; // Don't process now, will be processed after welcome
    }

    try {
      // Get the AI Person ID for this topic
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Getting AI Person for topic ${topicId}`);
      const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: AI Person ID: ${aiPersonId?.toString().substring(0, 8)}...`);
      if (!aiPersonId) {
        console.log('[AIMessageProcessor] ❌ No AI Person registered for this topic');
        return null;
      }

      // Resolve AI Person → Model ID (getLLMId handles delegation chain)
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Resolving AI Person to LLM`);
      const modelId = await this.aiManager.getLLMId(aiPersonId);
      if (!modelId) {
        console.error('[AIMessageProcessor] ❌ Could not get LLM ID from AI Person');
        return null;
      }
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Resolved to model: ${modelId}`);

      // Check if the message is from the AI itself
      if (senderId === aiPersonId) {
        console.log('[AIMessageProcessor] Message is from AI, skipping response');
        return null;
      }

      // Build prompt using AIPromptBuilder
      if (!this.promptBuilder) {
        throw new Error('[AIMessageProcessor] PromptBuilder not set - cannot build prompt');
      }

      const { promptParts } = await this.promptBuilder.buildPrompt(topicId, message, senderId);

      // CRITICAL: Use promptParts instead of deprecated messages field
      // promptParts contains: {part1: systemPrompt, part2: pastSubjects, part3: messages, part4: newMessage}
      if (!promptParts) {
        throw new Error('[AIMessageProcessor] PromptBuilder returned no promptParts');
      }

      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Prompt built - ${promptParts.totalTokens} tokens (system: ${promptParts.part1.tokens}, pastSubjects: ${promptParts.part2.tokens}, messages: ${promptParts.part3.tokens}, new: ${promptParts.part4.tokens})`);

      // Convert promptParts to messages array for chatWithAnalysis
      const { messages: history } = formatForStandardAPI(promptParts);
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Converted to ${history.length} messages for LLM`);

      // Generate message ID for streaming
      const messageId = `ai-${Date.now()}`;
      let fullResponse = '';
      let fullThinking = '';

      // Get model info for event emission
      const model = this.llmManager?.getModel(modelId);
      const modelName = model?.name || model?.displayName;

      // Emit thinking indicator via platform
      if (this.platform) {
        this.platform.emitProgress(topicId, 0);
      }

      // Get topic priority for LLM concurrency management
      const topicPriority = this.topicManager.getTopicPriority(topicId);

      // Get AI response with analysis in a single call
      // CRITICAL: Call through aiAssistant handler (if set) instead of llmManager directly
      // This allows handler to add middleware, logging, etc.
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Calling chatWithAnalysis() (priority: ${topicPriority})`)

      // ✅ IMMEDIATE FEEDBACK: Inform user that AI is responding (before LLM processing starts)
      if (this.platform) {
        console.log(`[AIMessageProcessor] 💬 Emitting immediate 'responding' status to UI`);
        this.platform.emitMessageUpdate(topicId, messageId, '', 'responding', modelId, modelName);
      }

      const chatInterface = this.aiAssistant || this.llmManager;
      const result: any = await chatInterface?.chatWithAnalysis(
        history,
        modelId,
        {
          topicId,  // Pass topicId for analysis
          priority: topicPriority,  // Pass priority for concurrency management
          onProgress: (status: string) => {
            // Send Phase 0 progress updates to UI
            if (this.platform) {
              console.log(`[AIMessageProcessor] 🔧 Phase 0 progress: ${status}`);
              this.platform.emitThinkingUpdate(topicId, messageId, status);
            }
          },
          onStream: (chunk: string) => {
            fullResponse += chunk;

            // Send streaming updates via platform
            if (this.platform) {
              // Reduced logging - only log every 100 chunks or final update
              // console.log('[AIMessageProcessor] 📡 Emitting streaming update, fullResponse length:', fullResponse.length);
              this.platform.emitMessageUpdate(topicId, messageId, fullResponse, 'streaming', modelId, modelName);
            } else {
              console.warn('[AIMessageProcessor] ⚠️  No platform available for streaming!');
            }
          },
          onThinkingStream: (chunk: string) => {
            // Reduced logging - only log significant events
            // console.log('[AIMessageProcessor] 🧠 THINKING CHUNK RECEIVED, length:', chunk.length, 'total:', fullThinking.length);
            fullThinking += chunk;

            // Send thinking stream updates via platform
            if (this.platform) {
              // console.log('[AIMessageProcessor] 🧠 Emitting thinking stream update to platform, total length:', fullThinking.length);
              this.platform.emitThinkingUpdate(topicId, messageId, fullThinking);
            } else {
              console.error('[AIMessageProcessor] ❌ NO PLATFORM - cannot emit thinking stream!');
            }
          },
          onAnalysis: (analysis: { keywords: string[]; description?: string }) => {
            // Phase 2 analytics callback - receives keywords and description
            console.log(`[AIMessageProcessor] 📊 Phase 2 analytics received: ${analysis.keywords.length} keywords`);
            // Analysis will be included in onComplete callback
          },
          onComplete: async (completionResult: { response: string; thinking?: string; analysis?: any }) => {
            // ✅ CONSOLIDATED PERSISTENCE: Store message with analytics after Phase 2 completes
            console.log(`[AIMessageProcessor] 🎯 onComplete called - response: ${completionResult.response?.length || 0} chars, thinking: ${completionResult.thinking?.length || 0} chars, analysis: ${completionResult.analysis ? 'yes' : 'no'}`);

            const response = completionResult.response;
            const thinking = completionResult.thinking;
            const analysis = completionResult.analysis;

            // Emit completion via platform
            if (this.platform) {
              this.platform.emitMessageUpdate(topicId, messageId, response, 'complete', modelId, modelName);
            }

            // Process analysis in background (non-blocking)
            if (analysis && this.taskManager) {
              setTimeout(async () => {
                try {
                  console.log('[AIMessageProcessor] Processing analysis in background...');
                  await this.processAnalysisResults(topicId, analysis);
                } catch (error) {
                  console.error('[AIMessageProcessor] Analysis processing failed:', error);
                }
              }, 0);
            }

            // CRITICAL: Store the AI's response to the channel with analytics
            // This persists the message in ONE.core so it doesn't vanish after streaming
            try {
              const topicRoom = await this.topicModel.enterTopicRoom(topicId);
              if (topicRoom) {
                console.log(`[AIMessageProcessor] 💾 STORING CONSOLIDATED STATE - response: ${response?.length || 0} chars, thinking: ${thinking?.length || 0} chars, analysis keywords: ${analysis?.keywords?.length || 0}`);
                console.log(`[AIMessageProcessor] 📝 Response preview: ${response?.substring(0, 100)}...`);

                // Post the AI's response to the channel
                // - response: the AI's message text
                // - aiPersonId: the author (AI's person ID)
                // - aiPersonId: the channel owner (AI posts to its own channel)
                // - thinking: optional reasoning trace (for models like DeepSeek R1)
                // TODO: Attach analysis as structured data for signing
                await topicRoom.sendMessage(response, aiPersonId, aiPersonId, thinking);
                console.log(`[AIMessageProcessor] ✅ Stored AI response to channel ${topicId}${thinking ? ' (with thinking)' : ''}${analysis ? ' (with analytics)' : ''}`);

                // Add message to cache so next buildPrompt() doesn't reload all messages
                if (this.promptBuilder) {
                  const messageObj = {
                    data: {
                      text: response,
                      sender: aiPersonId
                    },
                    timestamp: Date.now()
                  };
                  this.promptBuilder.addMessageToCache(topicId, messageObj);
                }
              } else {
                console.error(`[AIMessageProcessor] Could not enter topic room ${topicId}`);
              }
            } catch (error) {
              console.error('[AIMessageProcessor] Failed to store AI response:', error);
              // Don't throw - the response was already streamed to UI
            }
          }
        },
        topicId // NOTE: Moved to options object above
      );

      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: chatWithAnalysis() returned (non-blocking, persistence will happen in onComplete)`)

      // Return fullResponse for backwards compatibility
      // Actual persistence happens in onComplete callback after Phase 2
      return fullResponse;
    } catch (error) {
      console.error('[AIMessageProcessor] Failed to process message:', error);

      // Emit error via platform
      if (this.platform) {
        this.platform.emitError(topicId, error instanceof Error ? error : new Error(String(error)));
      }

      throw error;
    }
  }

  /**
   * Check if a message is from an AI
   */
  async isAIMessage(message: any): Promise<boolean> {
    const senderId = (message as any).data?.sender || (message as any).author;
    if (!senderId) {
      return false;
    }
    return await this.isAIContact(senderId);
  }

  /**
   * Check if a person/profile ID is an AI contact (AI Person or LLM Person)
   */
  async isAIContact(personId: SHA256IdHash<Person> | string): Promise<boolean> {
    // Check if personId is an AI Person or LLM Person using AIManager
    const aiId = await this.aiManager.getAIId(personId);
    const llmId = await this.aiManager.getLLMId(personId);
    return aiId !== null || llmId !== null;
  }

  /**
   * Handle new topic creation by generating welcome message
   */
  async handleNewTopic(topicId: string, aiPersonId: SHA256IdHash<Person>): Promise<void> {
    console.log(`[AIMessageProcessor] Handling new topic: ${topicId} with AI Person: ${aiPersonId.toString().substring(0, 8)}...`);

    // Mark this topic as having welcome generation in progress
    const welcomePromise = this.generateWelcomeMessage(topicId, aiPersonId);
    this.welcomeGenerationInProgress.set(topicId, welcomePromise);

    try {
      await welcomePromise;
    } finally {
      // Clean up
      this.welcomeGenerationInProgress.delete(topicId);

      // Process any queued messages
      await this.processPendingMessages(topicId);
    }
  }

  /**
   * Generate welcome message for a new topic
   * @param topicId - The topic ID
   * @param aiPersonId - The AI Person ID for this topic
   */
  private async generateWelcomeMessage(topicId: string, aiPersonId: SHA256IdHash<Person>): Promise<void> {
    const t0 = Date.now();
    console.log(`[AIMessageProcessor] ⏱️  T+0ms: Starting welcome message generation for topic: ${topicId}`);

    // Resolve Person → Model ID (handles both AI Person → LLM Person delegation and direct LLM Person)
    const llmId = await this.aiManager.getLLMId(aiPersonId);
    if (!llmId) {
      throw new Error('[AIMessageProcessor] Could not get LLM ID for Person');
    }
    const modelId = llmId; // llmId is already the model ID (e.g., "gpt-oss:20b")

    try {
      // Emit thinking indicator
      if (this.platform) {
        this.platform.emitProgress(topicId, 0);
      }
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Progress indicator emitted`);

      // Check if this topic uses a hardcoded welcome message
      const hardcodedWelcome = this.getHardcodedWelcome(topicId);
      console.log(`[AIMessageProcessor] getHardcodedWelcome("${topicId}") returned:`, hardcodedWelcome ? 'HARDCODED MESSAGE' : 'null');
      if (hardcodedWelcome) {
        console.log(`[AIMessageProcessor] Using hardcoded welcome for topic: ${topicId}`);

        // Emit the hardcoded message
        const messageId = `welcome-${Date.now()}`;
        if (this.platform) {
          this.platform.emitMessageUpdate(topicId, messageId, hardcodedWelcome, 'complete');
        }

        // Store the hardcoded message in ONE.core
        try {
          const topicRoom = await this.topicModel.enterTopicRoom(topicId);
          if (aiPersonId && topicRoom) {
            // Create the AI's channel first
            console.log(`[AIMessageProcessor] 🔍 Creating AI channel for hardcoded welcome - topic: ${topicId}, owner: ${aiPersonId.toString().substring(0, 16)}...`);
            try {
              await this.channelManager.createChannel(topicId, aiPersonId);
              console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: AI channel created for hardcoded welcome`);
            } catch (channelError: any) {
              if (channelError?.message?.includes('already exists')) {
                console.log(`[AIMessageProcessor] ℹ️  AI channel already exists`);
              } else {
                throw channelError;
              }
            }

            await topicRoom.sendMessage(hardcodedWelcome, aiPersonId, aiPersonId);
            console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Hardcoded welcome message stored`);

            // Add to cache
            if (this.promptBuilder) {
              const messageObj = {
                data: {
                  text: hardcodedWelcome,
                  sender: aiPersonId
                },
                timestamp: Date.now()
              };
              this.promptBuilder.addMessageToCache(topicId, messageObj);
            }
          }
        } catch (storeError) {
          console.error('[AIMessageProcessor] Failed to store hardcoded welcome:', storeError);
          throw storeError;  // Don't swallow errors
        }

        console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: ✅ Hardcoded welcome complete for topic: ${topicId}`);
        return;
      }

      // Build welcome prompt for generated messages
      const welcomePrompt = this.buildWelcomePrompt(topicId);
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Welcome prompt built`);

      // Use simple system prompt for welcome messages (no structured output instructions)
      // Combine base prompt with specific welcome instructions
      const simpleSystemPrompt = 'You are LAMA, a helpful local AI assistant. Respond naturally and warmly.';
      const combinedSystemPrompt = `${simpleSystemPrompt}\n\n${welcomePrompt}`;

      const history = [
        {
          role: 'system' as const,
          content: combinedSystemPrompt,
        },
        {
          role: 'user' as const,
          content: 'Please introduce yourself and welcome me to this conversation.',
        },
      ];

      // Generate welcome message
      const messageId = `welcome-${Date.now()}`;
      let fullResponse = '';
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Calling LLM...`);

      // Get topic priority for LLM concurrency management
      const topicPriority = this.topicManager.getTopicPriority(topicId);

      // Use regular chat (not chatWithAnalysis) - simple streaming with no special parsing
      // IMPORTANT: Disable MCP tools for welcome messages to avoid confusing the LLM
      const response = await this.llmManager?.chat(
        history,
        modelId,
        {
          topicId,  // Pass topicId for concurrency tracking
          priority: topicPriority,  // Pass priority for concurrency management
          onStream: (chunk: string) => {
            fullResponse += chunk;

            // Send streaming updates directly (no parsing needed)
            if (this.platform) {
              this.platform.emitMessageUpdate(
                topicId,
                messageId,
                fullResponse,
                'streaming'
              );
            }
          },
          disableTools: true, // Disable MCP tools for welcome messages
        }
      );

      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: LLM response received`);

      // Extract content from structured response if needed
      const finalResponse = typeof response === 'object' && response.content
        ? response.content
        : response;

      // Log full response for debugging
      console.log(`[AIMessageProcessor] Welcome response (raw):`, response);
      console.log(`[AIMessageProcessor] Welcome response (extracted):`, finalResponse);

      // Emit completion
      if (this.platform) {
        this.platform.emitMessageUpdate(
          topicId,
          messageId,
          finalResponse,
          'complete'
        );
      }

      // CRITICAL: Store the welcome message in ONE.core so it persists
      try {
        console.log(`[AIMessageProcessor] 🔍 About to store welcome message for topic: ${topicId}`);
        const topicRoom = await this.topicModel.enterTopicRoom(topicId);
        console.log(`[AIMessageProcessor] 🔍 topicRoom:`, topicRoom ? 'EXISTS' : 'NULL');
        console.log(`[AIMessageProcessor] 🔍 aiPersonId:`, aiPersonId ? aiPersonId.toString().substring(0, 16) + '...' : 'NULL');

        if (topicRoom) {
          // CRITICAL: Create the AI's channel BEFORE posting
          // Channels are for transport, not storage. We must create the channel first.
          console.log(`[AIMessageProcessor] 🔍 Creating AI channel for topic: ${topicId}, owner: ${aiPersonId.toString().substring(0, 16)}...`);
          try {
            await this.channelManager.createChannel(topicId, aiPersonId);
            console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: AI channel created`);
          } catch (channelError: any) {
            // Channel might already exist - that's fine
            if (channelError?.message?.includes('already exists')) {
              console.log(`[AIMessageProcessor] ℹ️  AI channel already exists`);
            } else {
              throw channelError;
            }
          }

          // Now send the message (topicRoom.sendMessage stores + posts to channel)
          await topicRoom.sendMessage(finalResponse, aiPersonId, aiPersonId);
          console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Welcome message stored and posted to channel`);

          // Add welcome message to cache
          if (this.promptBuilder) {
            const messageObj = {
              data: {
                text: finalResponse,
                sender: aiPersonId
              },
              timestamp: Date.now()
            };
            this.promptBuilder.addMessageToCache(topicId, messageObj);
          }
        } else {
          console.warn(`[AIMessageProcessor] ⚠️ Could not store welcome message - aiPersonId: ${aiPersonId ? 'EXISTS' : 'NULL'}, topicRoom: ${topicRoom ? 'EXISTS' : 'NULL'}`);
        }
      } catch (storeError) {
        // Expected error: Channel doesn't exist yet until user sends first message
        const errorMessage = storeError instanceof Error ? storeError.message : String(storeError);
        if (errorMessage.includes('channel does not exist')) {
          console.log('[AIMessageProcessor] ℹ️  Channel not created yet - welcome message will be added after first user message');
        } else {
          console.error('[AIMessageProcessor] ❌ Failed to store welcome message in ONE.core:');
          console.error('[AIMessageProcessor] Error details:', storeError);
          console.error('[AIMessageProcessor] Error stack:', storeError instanceof Error ? storeError.stack : 'No stack trace');
        }
        // Don't throw - the message was generated and emitted, storage is secondary
      }

      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: ✅ Welcome message generation complete for topic: ${topicId}`);
    } catch (error) {
      console.error(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: ❌ Failed to generate welcome message:`, error);

      // Emit error
      if (this.platform) {
        this.platform.emitError(topicId, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Build welcome prompt based on topic ID
   */
  /**
   * Get hardcoded welcome message for topics that don't need AI generation
   * NOTE: "hi" topic welcome is handled by the app layer (lama.cube)
   */
  private getHardcodedWelcome(_topicId: string): string | null {
    // No hardcoded welcomes in infrastructure layer
    // App-specific welcome messages belong in lama.cube
    return null;
  }

  private buildWelcomePrompt(topicId: string): string {
    if (topicId === 'hi') {
      return 'Please introduce yourself briefly and warmly as LAMA, a local AI assistant.';
    } else if (topicId === 'lama') {
      return `Welcome the user to LAMA, explaining that this is your private memory space. Explain that:
- This is your personal memory where you store context from all conversations
- Everything you learn gets stored here for transparency
- Nobody else can see this content - it's completely private
- The user can configure visibility in Settings
Ask what you can help them with today.`;
    } else {
      return 'Greet the user and offer to help.';
    }
  }

  /**
   * Process pending messages after welcome generation
   * Messages are processed in priority order (highest priority first)
   */
  private async processPendingMessages(topicId: string): Promise<void> {
    const pendingMessages = this.pendingMessageQueues.get(topicId);
    if (!pendingMessages || pendingMessages.length === 0) {
      return;
    }

    console.log(`[AIMessageProcessor] Processing ${pendingMessages.length} pending messages for topic: ${topicId}`);

    // Sort messages by priority (highest first), then by queuedAt (oldest first) for same priority
    const sortedMessages = [...pendingMessages].sort((a, b) => {
      const priorityA = a.priority || 5;
      const priorityB = b.priority || 5;

      // Higher priority comes first
      if (priorityA !== priorityB) {
        return priorityB - priorityA;
      }

      // Same priority: older message comes first
      return a.queuedAt - b.queuedAt;
    });

    // Clear the queue
    this.pendingMessageQueues.delete(topicId);

    // Process each message in priority order
    for (const entry of sortedMessages) {
      try {
        await this.processMessage(entry.topicId, entry.text, entry.senderId);
      } catch (error) {
        console.error('[AIMessageProcessor] Failed to process pending message:', error);
      }
    }
  }

  /**
   * Process analysis results from LLM
   * New format: {keywords, description?}
   */
  private async processAnalysisResults(topicId: string, analysis: any): Promise<void> {
    if (!this.topicAnalysisModel) {
      console.log('[AIMessageProcessor] No TopicAnalysisModel - skipping analysis processing');
      return;
    }

    console.log('[AIMessageProcessor] Processing analysis:', {
      keywords: analysis.keywords?.length || 0,
      hasDescription: !!analysis.description
    });

    const keywords = analysis.keywords || [];
    const description = analysis.description;

    if (keywords.length === 0) {
      console.log('[AIMessageProcessor] No keywords to process');
      return;
    }

    let subjectCreated = false;

    // If description is present, subject has changed - create new subject
    if (description) {
      console.log('[AIMessageProcessor] Subject changed - creating new subject');
      try {
        const keywordCombination = keywords.sort().join('+');
        const subject = await this.topicAnalysisModel.createSubject(
          topicId,
          keywords,
          keywordCombination,
          description,
          1.0 // confidence
        );

        console.log(`[AIMessageProcessor] ✅ Created subject: ${keywordCombination}`);

        // Prime cache to avoid race condition
        const existingSubjects = await this.topicAnalysisModel.getSubjects(topicId);
        this.topicAnalysisModel.setCachedSubjects(topicId, [...existingSubjects, subject]);

        // Link keywords to subject
        for (const keyword of keywords) {
          try {
            await this.topicAnalysisModel.addKeywordToSubject(
              topicId,
              keyword,
              subject.idHash
            );
          } catch (error) {
            console.warn(`[AIMessageProcessor] Failed to link keyword "${keyword}":`, error);
          }
        }

        subjectCreated = true;
      } catch (error) {
        console.error('[AIMessageProcessor] Failed to create subject:', error);
      }
    } else {
      // Subject unchanged - link keywords to existing subject or create first subject
      console.log('[AIMessageProcessor] Subject unchanged - finding current subject');
      try {
        // Get existing subjects for this topic
        const subjects = await this.topicAnalysisModel.getSubjects(topicId);
        let targetSubject;

        if (subjects.length > 0) {
          // Use the most recent subject
          targetSubject = subjects[subjects.length - 1];
          console.log(`[AIMessageProcessor] Linking keywords to existing subject: ${targetSubject.keywordCombination}`);
        } else {
          // No subjects yet - create the first one
          console.log('[AIMessageProcessor] No subjects exist - creating first subject');
          const keywordCombination = keywords.sort().join('+');
          targetSubject = await this.topicAnalysisModel.createSubject(
            topicId,
            keywords,
            keywordCombination,
            'Initial conversation topic', // Default description for first subject
            1.0
          );
          subjectCreated = true;
          console.log(`[AIMessageProcessor] ✅ Created first subject: ${keywordCombination}`);

          // Prime cache to avoid race condition with channel propagation
          this.topicAnalysisModel.setCachedSubjects(topicId, [targetSubject]);
        }

        // Link keywords to the target subject
        for (const keyword of keywords) {
          try {
            await this.topicAnalysisModel.addKeywordToSubject(
              topicId,
              keyword,
              targetSubject.idHash
            );
          } catch (error) {
            console.warn(`[AIMessageProcessor] Failed to link keyword "${keyword}":`, error);
          }
        }
        console.log(`[AIMessageProcessor] ✅ Linked ${keywords.length} keywords to subject`);
      } catch (error) {
        console.warn('[AIMessageProcessor] Failed to process keywords:', error);
      }
    }

    // Emit analysis update event
    if (this.platform?.emitAnalysisUpdate) {
      if (subjectCreated) {
        this.platform.emitAnalysisUpdate(topicId, 'both');
      } else {
        this.platform.emitAnalysisUpdate(topicId, 'keywords');
      }
    }
  }

  /**
   * Process a single subject from analysis
   */
  private async processSubject(topicId: string, subjectData: any): Promise<void> {
    const { name, description, isNew, keywords: subjectKeywords } = subjectData;

    console.log(`[AIMessageProcessor] Processing subject: ${name} (isNew: ${isNew})`);

    if (!this.topicAnalysisModel) {
      console.warn('[AIMessageProcessor] TopicAnalysisModel not available - skipping subject creation');
      return;
    }

    try {
      // Extract keyword terms from keyword objects
      const keywordTerms = (subjectKeywords || []).map((kw: any) =>
        typeof kw === 'string' ? kw : kw.term
      );

      if (keywordTerms.length === 0) {
        console.warn('[AIMessageProcessor] No keywords for subject - skipping:', name);
        return;
      }

      // Create subject with keyword combination as ID
      // The keyword combination is used as a unique identifier
      const keywordCombination = keywordTerms.sort().join('+');

      console.log(`[AIMessageProcessor] Creating subject "${name}" with keywords: ${keywordTerms.join(', ')}`);

      const subject = await this.topicAnalysisModel.createSubject(
        topicId,
        keywordTerms,
        keywordCombination,
        description,
        1.0 // confidence
      );

      console.log(`[AIMessageProcessor] ✅ Created subject with idHash: ${subject.idHash}`);

      // Create/update keywords and link them to this subject
      for (const keywordData of subjectKeywords || []) {
        try {
          const term = typeof keywordData === 'string' ? keywordData : keywordData.term;

          await this.topicAnalysisModel.addKeywordToSubject(
            topicId,
            term,
            subject.idHash
          );

          console.log(`[AIMessageProcessor] ✅ Linked keyword "${term}" to subject "${name}"`);
        } catch (error) {
          console.warn(`[AIMessageProcessor] Failed to link keyword to subject:`, error);
        }
      }
    } catch (error) {
      console.error('[AIMessageProcessor] Failed to create subject:', error);
      throw error;
    }
  }

  /**
   * Optional callback for generation progress
   */
  onGenerationProgress?: (topicId: string, progress: number) => void;
}
