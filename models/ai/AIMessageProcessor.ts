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

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('AIMessageProcessor');
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type { IAIMessageProcessor, IAIPromptBuilder, IAITaskManager } from './interfaces.js';
import type { LLMModelInfo, MessageQueueEntry } from './types.js';
import type { LLMPlatform } from '../../services/llm-platform.js';
import OneObjectCache from '@refinio/one.models/lib/api/utils/caches/OneObjectCache.js';
import { formatForStandardAPI } from '../../services/context-budget-manager.js';
import { storeUTF8Clob } from '@refinio/one.core/lib/storage-blob.js';

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
      MessageBus.send('error', 'Person cache error:', error);
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
    MessageBus.send('debug', `Processing message for topic ${topicId}`);

    // Check if welcome generation is in progress for this topic
    const welcomeInProgress = this.welcomeGenerationInProgress.get(topicId);
    if (welcomeInProgress) {
      MessageBus.send('debug', `Welcome generation in progress for ${topicId}, queuing message`);
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
      const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
      if (!aiPersonId) {
        MessageBus.send('debug', 'No AI Person registered for this topic');
        return null;
      }

      // Resolve AI Person → Model ID (getLLMId handles delegation chain)
      const modelId = await this.aiManager.getLLMId(aiPersonId);
      if (!modelId) {
        MessageBus.send('error', 'Could not get LLM ID from AI Person');
        return null;
      }
      MessageBus.send('debug', `T+${Date.now() - t0}ms: Resolved to model: ${modelId}`);

      // Check if the message is from the AI itself
      if (senderId === aiPersonId) {
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
        throw new Error('PromptBuilder returned no promptParts');
      }

      MessageBus.send('debug', `T+${Date.now() - t0}ms: Prompt built - ${promptParts.totalTokens} tokens`);

      // Convert promptParts to messages array for chatWithAnalysis
      const { messages: history } = formatForStandardAPI(promptParts);

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
      MessageBus.send('debug', `T+${Date.now() - t0}ms: Calling chatWithAnalysis() (priority: ${topicPriority})`)

      // ✅ IMMEDIATE FEEDBACK: Inform user that AI is responding (before LLM processing starts)
      if (this.platform) {
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
              this.platform.emitThinkingUpdate(topicId, messageId, status);
            }
          },
          onStream: (chunk: string) => {
            fullResponse += chunk;

            // Send streaming updates via platform
            if (this.platform) {
              this.platform.emitMessageUpdate(topicId, messageId, fullResponse, 'streaming', modelId, modelName);
            } else {
              MessageBus.send('alert', 'No platform available for streaming');
            }
          },
          onThinkingStream: (chunk: string) => {
            // Reduced logging - only log significant events
            // console.log('[AIMessageProcessor] 🧠 THINKING CHUNK RECEIVED, length:', chunk.length, 'total:', fullThinking.length);
            fullThinking += chunk;

            // Send thinking stream updates via platform
            if (this.platform) {
              this.platform.emitThinkingUpdate(topicId, messageId, fullThinking);
            } else {
              MessageBus.send('error', 'NO PLATFORM - cannot emit thinking stream');
            }
          },
          onAnalysis: (analysis: { keywords: string[]; description?: string; summaryUpdate?: string }) => {
            // Phase 2 analytics callback - receives keywords, description, and summaryUpdate
            MessageBus.send('debug', `Phase 2 analytics received: ${analysis.keywords.length} keywords`);
            // Analysis will be included in onComplete callback
          },
          onComplete: async (completionResult: { response: string; thinking?: string; analysis?: any }) => {
            // ✅ CONSOLIDATED PERSISTENCE: Store message with analytics after Phase 2 completes
            MessageBus.send('debug', `onComplete - response: ${completionResult.response?.length || 0} chars, analysis: ${completionResult.analysis ? 'yes' : 'no'}`);

            const response = completionResult.response;
            const thinking = completionResult.thinking;
            const analysis = completionResult.analysis;

            // Emit completion via platform
            if (this.platform) {
              this.platform.emitMessageUpdate(topicId, messageId, response, 'complete', modelId, modelName);
            }

            // Process analysis in background (non-blocking)
            if (analysis && this.topicAnalysisModel) {
              setTimeout(async () => {
                try {
                  await this.processAnalysisResults(topicId, analysis);
                } catch (error) {
                  MessageBus.send('error', 'Analysis processing failed:', error);
                }
              }, 0);
            }

            // CRITICAL: Store the AI's response to the channel with analytics
            // This persists the message in ONE.core so it doesn't vanish after streaming
            try {
              const topicRoom = await this.topicModel.enterTopicRoom(topicId);
              if (topicRoom) {
                // Post the AI's response to the channel
                if (thinking) {
                  // Store thinking as CLOB attachment
                  const thinkingClob = await storeUTF8Clob(thinking);
                  await topicRoom.sendMessageWithAttachmentAsHash(response, [{
                    hash: thinkingClob.hash as unknown as SHA256Hash,
                    type: 'CLOB',
                    metadata: {
                      name: 'thinking.txt',
                      mimeType: 'text/plain',
                      size: new TextEncoder().encode(thinking).length
                    }
                  }], aiPersonId, aiPersonId);
                  MessageBus.send('debug', `Stored AI response with thinking to ${topicId}`);
                } else {
                  await topicRoom.sendMessage(response, aiPersonId, aiPersonId);
                  MessageBus.send('debug', `Stored AI response to ${topicId}`);
                }

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
                MessageBus.send('error', `Could not enter topic room ${topicId}`);
              }
            } catch (error) {
              MessageBus.send('error', 'Failed to store AI response:', error);
              // Don't throw - the response was already streamed to UI
            }
          }
        },
        topicId // NOTE: Moved to options object above
      );

      MessageBus.send('debug', `T+${Date.now() - t0}ms: chatWithAnalysis() returned`)

      // Return fullResponse for backwards compatibility
      // Actual persistence happens in onComplete callback after Phase 2
      return fullResponse;
    } catch (error) {
      MessageBus.send('error', 'Failed to process message:', error);

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
    MessageBus.send('debug', `Handling new topic: ${topicId}`);

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
    MessageBus.send('debug', `Starting welcome message generation for topic: ${topicId}`);

    // Resolve Person → Model ID (handles both AI Person → LLM Person delegation and direct LLM Person)
    const llmId = await this.aiManager.getLLMId(aiPersonId);
    if (!llmId) {
      throw new Error('Could not get LLM ID for Person');
    }
    const modelId = llmId; // llmId is already the model ID (e.g., "gpt-oss:20b")

    try {
      // Emit thinking indicator
      if (this.platform) {
        this.platform.emitProgress(topicId, 0);
      }

      // Check if this topic uses a hardcoded welcome message
      const hardcodedWelcome = this.getHardcodedWelcome(topicId);
      if (hardcodedWelcome) {
        MessageBus.send('debug', `Using hardcoded welcome for topic: ${topicId}`);

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
            try {
              await this.channelManager.createChannel(topicId, aiPersonId);
            } catch (channelError: any) {
              if (!channelError?.message?.includes('already exists')) {
                throw channelError;
              }
            }

            await topicRoom.sendMessage(hardcodedWelcome, aiPersonId, aiPersonId);
            MessageBus.send('debug', `Hardcoded welcome message stored for ${topicId}`);

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
          MessageBus.send('error', 'Failed to store hardcoded welcome:', storeError);
          throw storeError;  // Don't swallow errors
        }

        return;
      }

      // Build welcome prompt for generated messages
      const welcomePrompt = this.buildWelcomePrompt(topicId);

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

      // Extract content from structured response if needed
      const finalResponse = typeof response === 'object' && response.content
        ? response.content
        : response;

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
        const topicRoom = await this.topicModel.enterTopicRoom(topicId);

        if (topicRoom) {
          // CRITICAL: Create the AI's channel BEFORE posting
          // Channels are for transport, not storage. We must create the channel first.
          try {
            await this.channelManager.createChannel(topicId, aiPersonId);
          } catch (channelError: any) {
            // Channel might already exist - that's fine
            if (!channelError?.message?.includes('already exists')) {
              throw channelError;
            }
          }

          // Now send the message (topicRoom.sendMessage stores + posts to channel)
          await topicRoom.sendMessage(finalResponse, aiPersonId, aiPersonId);
          MessageBus.send('debug', `Welcome message stored for ${topicId}`);

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
          MessageBus.send('alert', 'Could not store welcome message - no topic room');
        }
      } catch (storeError) {
        // Expected error: Channel doesn't exist yet until user sends first message
        const errorMessage = storeError instanceof Error ? storeError.message : String(storeError);
        if (!errorMessage.includes('channel does not exist')) {
          MessageBus.send('error', 'Failed to store welcome message:', storeError);
        }
        // Don't throw - the message was generated and emitted, storage is secondary
      }

      MessageBus.send('log', `Welcome message generated for topic: ${topicId}`);
    } catch (error) {
      MessageBus.send('error', 'Failed to generate welcome message:', error);

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

    MessageBus.send('debug', `Processing ${pendingMessages.length} pending messages for topic: ${topicId}`);

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
        MessageBus.send('error', 'Failed to process pending message:', error);
      }
    }
  }

  /**
   * Process analysis results from LLM
   * New format: {keywords, description?}
   */
  private async processAnalysisResults(topicId: string, analysis: any): Promise<void> {
    if (!this.topicAnalysisModel) {
      return;
    }

    const keywords = analysis.keywords || [];
    const description = analysis.description;

    if (keywords.length === 0) {
      return;
    }

    MessageBus.send('debug', `Processing analysis: ${keywords.length} keywords`);

    let subjectCreated = false;

    // If description is present, subject has changed - create Summary for previous subject, then create new subject
    if (description) {
      MessageBus.send('debug', 'Subject changed - processing previous subject and creating new one');

      // Get existing subjects to find the previous one
      const existingSubjects = await this.topicAnalysisModel.getSubjects(topicId);
      const previousSubject = existingSubjects.length > 0 ? existingSubjects[existingSubjects.length - 1] : null;

      // Create Summary for previous subject if summaryUpdate is present
      const summaryUpdate = analysis.summaryUpdate;
      if (previousSubject && summaryUpdate) {
        MessageBus.send('debug', `Creating Summary for previous subject: ${previousSubject.keywordCombination}`);
        try {
          // Import storeVersionedObject for Summary storage
          const { storeVersionedObject } = await import('@refinio/one.core/lib/storage-versioned-objects.js');

          // Create Summary object (identity: subject + topic)
          const summaryData = {
            $type$: 'Summary' as const,
            subject: previousSubject.idHash,
            topic: topicId,
            prose: summaryUpdate
          };

          // Store Summary using ONE.core versioned storage
          const result = await storeVersionedObject(summaryData);
          MessageBus.send('debug', `Stored Summary for subject ${previousSubject.keywordCombination}`);

          // Memory integration - create Memory version from Summary
          // Get instance owner for Memory.author
          const { getInstanceOwnerIdHash } = await import('@refinio/one.core/lib/instance.js');
          const authorIdHash = getInstanceOwnerIdHash();

          if (authorIdHash) {
            // Create Memory object from Summary
            const memoryData = {
              $type$: 'Memory' as const,
              title: previousSubject.keywordCombination || previousSubject.description || 'Untitled',
              author: authorIdHash,
              facts: [],
              entities: [],
              relationships: [],
              prose: summaryUpdate,
              sourceSubjects: [previousSubject.idHash]
            };

            const memoryResult = await storeVersionedObject(memoryData);

            // Update Subject with Memory reference
            // Get fresh subject data to avoid stale state
            const { getObjectByIdHash } = await import('@refinio/one.core/lib/storage-versioned-objects.js');
            const subjectResult = await getObjectByIdHash(previousSubject.idHash);
            if (subjectResult?.obj) {
              const subjectObj = subjectResult.obj as any;
              const updatedSubject = {
                ...subjectObj,
                memories: [...(subjectObj.memories || []), memoryResult.idHash]
              };
              await storeVersionedObject(updatedSubject);
            }
          } else {
            MessageBus.send('alert', 'Could not get instance owner for Memory creation');
          }
        } catch (summaryError) {
          MessageBus.send('alert', 'Failed to create Summary:', summaryError);
          // Non-fatal - continue with subject creation
        }
      }

      // Now create the new subject
      try {
        const keywordCombination = keywords.sort().join('+');
        const subject = await this.topicAnalysisModel.createSubject(
          topicId,
          keywords,
          keywordCombination,
          description,
          1.0 // confidence
        );

        MessageBus.send('debug', `Created subject: ${keywordCombination}`);

        // Prime cache to avoid race condition
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
            MessageBus.send('alert', `Failed to link keyword "${keyword}":`, error);
          }
        }

        subjectCreated = true;
      } catch (error) {
        MessageBus.send('error', 'Failed to create subject:', error);
      }
    } else {
      // Subject unchanged - link keywords to existing subject or create first subject
      try {
        // Get existing subjects for this topic
        const subjects = await this.topicAnalysisModel.getSubjects(topicId);
        let targetSubject;

        if (subjects.length > 0) {
          // Use the most recent subject
          targetSubject = subjects[subjects.length - 1];
        } else {
          // No subjects yet - create the first one
          const keywordCombination = keywords.sort().join('+');
          targetSubject = await this.topicAnalysisModel.createSubject(
            topicId,
            keywords,
            keywordCombination,
            'Initial conversation topic', // Default description for first subject
            1.0
          );
          subjectCreated = true;
          MessageBus.send('debug', `Created first subject: ${keywordCombination}`);

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
            MessageBus.send('alert', `Failed to link keyword "${keyword}":`, error);
          }
        }
        MessageBus.send('debug', `Linked ${keywords.length} keywords to subject`);
      } catch (error) {
        MessageBus.send('alert', 'Failed to process keywords:', error);
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

    if (!this.topicAnalysisModel) {
      MessageBus.send('alert', 'TopicAnalysisModel not available - skipping subject creation');
      return;
    }

    try {
      // Extract keyword terms from keyword objects
      const keywordTerms = (subjectKeywords || []).map((kw: any) =>
        typeof kw === 'string' ? kw : kw.term
      );

      if (keywordTerms.length === 0) {
        MessageBus.send('alert', `No keywords for subject - skipping: ${name}`);
        return;
      }

      // Create subject with keyword combination as ID
      // The keyword combination is used as a unique identifier
      const keywordCombination = keywordTerms.sort().join('+');

      MessageBus.send('debug', `Creating subject "${name}" with keywords: ${keywordTerms.join(', ')}`);

      const subject = await this.topicAnalysisModel.createSubject(
        topicId,
        keywordTerms,
        keywordCombination,
        description,
        1.0 // confidence
      );

      // Create/update keywords and link them to this subject
      for (const keywordData of subjectKeywords || []) {
        try {
          const term = typeof keywordData === 'string' ? keywordData : keywordData.term;

          await this.topicAnalysisModel.addKeywordToSubject(
            topicId,
            term,
            subject.idHash
          );
        } catch (error) {
          MessageBus.send('alert', `Failed to link keyword to subject:`, error);
        }
      }
    } catch (error) {
      MessageBus.send('error', 'Failed to create subject:', error);
      throw error;
    }
  }

  /**
   * Optional callback for generation progress
   */
  onGenerationProgress?: (topicId: string, progress: number) => void;
}
