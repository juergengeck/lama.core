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
import { DEFAULT_SYSTEM_PROMPT } from '../../constants/system-prompts.js';

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
    private leuteModel: LeuteModel,
    private topicManager: any, // AITopicManager
    private contactManager: any, // AIContactManager
    private topicModel: TopicModel, // For storing messages in ONE.core
    private stateManager?: any, // Optional state manager for tracking
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
   * Get system prompt for a specific model
   * Returns model-specific prompt from LLM object, or default if not set
   */
  private getSystemPromptForModel(modelId: string): string {
    const model = this.llmManager?.getModel(modelId);

    if (model?.systemPrompt) {
      console.log(`[AIMessageProcessor] Using custom system prompt for model: ${modelId}`);
      return model.systemPrompt;
    }

    console.log(`[AIMessageProcessor] Using default system prompt for model: ${modelId}`);
    return DEFAULT_SYSTEM_PROMPT;
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
      this.pendingMessageQueues.get(topicId)!.push({
        topicId,
        text: message,
        senderId,
        queuedAt: Date.now(),
      });
      return null; // Don't process now, will be processed after welcome
    }

    try {
      // Get the model ID for this topic
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Getting model ID for topic ${topicId}`);
      const modelId = this.topicManager.getModelIdForTopic(topicId);
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Model ID: ${modelId}`);
      if (!modelId) {
        console.log('[AIMessageProcessor] ❌ No AI model registered for this topic');
        return null;
      }

      // Get the AI person ID for this model (requires aiContactManager)
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Getting AI person ID for model ${modelId}`);
      const aiPersonId = await this.getAIPersonIdForModel(modelId);
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: AI person ID: ${aiPersonId}`);
      if (!aiPersonId) {
        console.error('[AIMessageProcessor] ❌ Could not get AI person ID');
        return null;
      }

      // Check if the message is from the AI itself
      if (senderId === aiPersonId) {
        console.log('[AIMessageProcessor] Message is from AI, skipping response');
        return null;
      }

      // Build prompt using AIPromptBuilder
      if (!this.promptBuilder) {
        throw new Error('[AIMessageProcessor] PromptBuilder not set - cannot build prompt');
      }

      const { messages: history } = await this.promptBuilder.buildPrompt(topicId, message, senderId);

      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Prompt built - sending ${history.length} messages to LLM`);

      // Generate message ID for streaming
      const messageId = `ai-${Date.now()}`;
      let fullResponse = '';
      let fullThinking = '';

      // Emit thinking indicator via platform
      if (this.platform) {
        this.platform.emitProgress(topicId, 0);
      }

      // Get AI response with analysis in a single call
      // CRITICAL: Call through aiAssistant handler (if set) instead of llmManager directly
      // This allows handler to add middleware, logging, etc.
      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Calling chatWithAnalysis()`)
      const chatInterface = this.aiAssistant || this.llmManager;
      const result: any = await chatInterface?.chatWithAnalysis(
        history,
        modelId,
        {
          onStream: (chunk: string) => {
            fullResponse += chunk;

            // Send streaming updates via platform
            if (this.platform) {
              console.log('[AIMessageProcessor] 📡 Emitting streaming update, fullResponse length:', fullResponse.length);
              this.platform.emitMessageUpdate(topicId, messageId, fullResponse, 'streaming');
            } else {
              console.warn('[AIMessageProcessor] ⚠️  No platform available for streaming!');
            }
          },
          onThinkingStream: (chunk: string) => {
            fullThinking += chunk;

            // Send thinking stream updates via platform
            if (this.platform) {
              console.log('[AIMessageProcessor] 🧠 Emitting thinking stream update, length:', fullThinking.length);
              this.platform.emitThinkingUpdate(topicId, messageId, fullThinking);
            }
          },
        },
        topicId // Pass topicId for analysis
      );

      console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: chatWithAnalysis() completed`)
      const response = result?.response;
      const thinking = result?.thinking || fullThinking;

      // Process analysis in background (non-blocking)
      // Use setTimeout for browser compatibility (setImmediate is Node.js only)
      if (result?.analysis && this.taskManager) {
        setTimeout(async () => {
          try {
            console.log('[AIMessageProcessor] Processing analysis in background...');
            await this.processAnalysisResults(topicId, result.analysis);
          } catch (error) {
            console.error('[AIMessageProcessor] Analysis processing failed:', error);
          }
        }, 0);
      }

      // Emit completion via platform
      if (this.platform) {
        this.platform.emitMessageUpdate(topicId, messageId, response || fullResponse, 'complete');
      }

      // CRITICAL: Store the AI's response to the channel
      // This persists the message in ONE.core so it doesn't vanish after streaming
      try {
        const topicRoom = await this.topicModel.enterTopicRoom(topicId);
        if (topicRoom) {
          // Post the AI's response to the channel
          // - response: the AI's message text
          // - aiPersonId: the author (AI's person ID)
          // - aiPersonId: the channel owner (AI posts to its own channel)
          // - thinking: optional reasoning trace (for models like DeepSeek R1)
          await topicRoom.sendMessage(response || fullResponse, aiPersonId, aiPersonId, thinking);
          console.log(`[AIMessageProcessor] ✅ Stored AI response to channel ${topicId}${thinking ? ' (with thinking trace)' : ''}`);

          // Add message to cache so next buildPrompt() doesn't reload all messages
          if (this.promptBuilder) {
            const messageObj = {
              data: {
                text: response || fullResponse,
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

      return response || fullResponse;
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
  isAIMessage(message: any): boolean {
    const senderId = (message as any).data?.sender || (message as any).author;
    if (!senderId) {
      return false;
    }
    return this.isAIContact(senderId);
  }

  /**
   * Check if a person/profile ID is an AI contact
   */
  isAIContact(personId: SHA256IdHash<Person> | string): boolean {
    // This requires access to AIContactManager
    // For now, check if personId exists in available models
    return this.availableModels.some(m => m.personId === personId);
  }

  /**
   * Handle new topic creation by generating welcome message
   */
  async handleNewTopic(topicId: string, modelId: string): Promise<void> {
    console.log(`[AIMessageProcessor] Handling new topic: ${topicId} with model: ${modelId}`);

    // Mark this topic as having welcome generation in progress
    const welcomePromise = this.generateWelcomeMessage(topicId, modelId);
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
   */
  private async generateWelcomeMessage(topicId: string, modelId: string): Promise<void> {
    const t0 = Date.now();
    console.log(`[AIMessageProcessor] ⏱️  T+0ms: Starting welcome message generation for topic: ${topicId}`);

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
          const aiPersonId = await this.getAIPersonIdForModel(modelId);
          if (aiPersonId && topicRoom) {
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

      // Use regular chat (not chatWithAnalysis) - simple streaming with no special parsing
      // IMPORTANT: Disable MCP tools for welcome messages to avoid confusing the LLM
      const response = await this.llmManager?.chat(
        history,
        modelId,
        {
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
        const aiPersonId = await this.getAIPersonIdForModel(modelId);
        console.log(`[AIMessageProcessor] 🔍 aiPersonId:`, aiPersonId ? aiPersonId.toString().substring(0, 16) + '...' : 'NULL');

        if (aiPersonId && topicRoom) {
          // Send message as the AI (channelOwner = aiPersonId for AI's channel)
          // Store the extracted response (without thinking tags)
          await topicRoom.sendMessage(finalResponse, aiPersonId, aiPersonId);
          console.log(`[AIMessageProcessor] ⏱️  T+${Date.now() - t0}ms: Welcome message stored in ONE.core`);

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
  private getHardcodedWelcome(topicId: string): string | null {
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
   */
  private async processPendingMessages(topicId: string): Promise<void> {
    const pendingMessages = this.pendingMessageQueues.get(topicId);
    if (!pendingMessages || pendingMessages.length === 0) {
      return;
    }

    console.log(`[AIMessageProcessor] Processing ${pendingMessages.length} pending messages for topic: ${topicId}`);

    // Clear the queue
    this.pendingMessageQueues.delete(topicId);

    // Process each message in order
    for (const entry of pendingMessages) {
      try {
        await this.processMessage(entry.topicId, entry.text, entry.senderId);
      } catch (error) {
        console.error('[AIMessageProcessor] Failed to process pending message:', error);
      }
    }
  }

  /**
   * Process analysis results from LLM
   */
  private async processAnalysisResults(topicId: string, analysis: any): Promise<void> {
    if (!this.taskManager) {
      return;
    }

    console.log('[AIMessageProcessor] Processing analysis results...');

    let subjectsProcessed = false;
    let keywordsProcessed = false;

    // Process subjects if present
    if (analysis.subjects && Array.isArray(analysis.subjects)) {
      console.log(`[AIMessageProcessor] Processing ${analysis.subjects.length} subjects...`);

      for (const subjectData of analysis.subjects) {
        try {
          await this.processSubject(topicId, subjectData);
          subjectsProcessed = true;
          // processSubject also creates keywords, so mark those as processed too
          if (subjectData.keywords && subjectData.keywords.length > 0) {
            keywordsProcessed = true;
          }
        } catch (error) {
          console.warn('[AIMessageProcessor] Failed to process subject:', error);
        }
      }

      // Emit analysis update events using platform abstraction
      if (this.platform?.emitAnalysisUpdate) {
        if (subjectsProcessed && keywordsProcessed) {
          this.platform.emitAnalysisUpdate(topicId, 'both');
          console.log(`[AIMessageProcessor] Emitted 'both' analysis update for topic ${topicId}`);
        } else if (subjectsProcessed) {
          this.platform.emitAnalysisUpdate(topicId, 'subjects');
          console.log(`[AIMessageProcessor] Emitted 'subjects' analysis update for topic ${topicId}`);
        } else if (keywordsProcessed) {
          this.platform.emitAnalysisUpdate(topicId, 'keywords');
          console.log(`[AIMessageProcessor] Emitted 'keywords' analysis update for topic ${topicId}`);
        }
      }
    }

    // Process summary update if present
    if (analysis.summaryUpdate) {
      console.log('[AIMessageProcessor] Processing summary update...');
      // Summary update would be handled by TopicAnalysisModel
      // This is a placeholder for future implementation
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
   * Get AI person ID for a model (requires AIContactManager)
   * This is a helper that would be injected or accessed via dependency
   */
  private async getAIPersonIdForModel(modelId: string): Promise<SHA256IdHash<Person> | null> {
    // Use AIContactManager to get the person ID
    // The contact should already exist (created by AITopicManager)
    try {
      // Get display name from llmManager for fallback contact creation
      const models = this.llmManager?.getAvailableModels() || [];
      // Strip -private suffix to find base model for display name
      const baseModelId = modelId.replace(/-private$/, '');
      const model = models.find((m: any) => m.id === baseModelId);
      const displayName = model?.displayName || model?.name || modelId;
      const fullDisplayName = modelId.endsWith('-private') ? `${displayName} (Private)` : displayName;

      // Get person ID from contact manager (will use cache if available)
      const personId = await this.contactManager.ensureAIContactForModel(modelId, fullDisplayName);
      return personId;
    } catch (error) {
      console.error(`[AIMessageProcessor] Failed to get AI person ID for ${modelId}:`, error);
      return null;
    }
  }

  /**
   * Optional callback for generation progress
   */
  onGenerationProgress?: (topicId: string, progress: number) => void;
}
