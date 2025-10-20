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
import type { IAIMessageProcessor, IAIPromptBuilder, IAITaskManager } from './interfaces.js';
import type { LLMModelInfo, MessageQueueEntry } from './types.js';
import type { LLMPlatform } from '../../services/llm-platform.js';

export class AIMessageProcessor implements IAIMessageProcessor {
  // Circular dependencies - injected via setters
  private promptBuilder?: IAIPromptBuilder;
  private taskManager?: IAITaskManager;

  // Message queues (topicId → queued messages)
  private pendingMessageQueues: Map<string, MessageQueueEntry[]>;

  // Welcome generation tracking (topicId → promise)
  private welcomeGenerationInProgress: Map<string, Promise<any>>;

  // Available LLM models
  private availableModels: LLMModelInfo[];

  constructor(
    private channelManager: ChannelManager,
    private llmManager: any, // LLMManager interface
    private leuteModel: LeuteModel,
    private topicManager: any, // AITopicManager
    private stateManager?: any, // Optional state manager for tracking
    private platform?: LLMPlatform // Optional platform for UI events
  ) {
    this.pendingMessageQueues = new Map();
    this.welcomeGenerationInProgress = new Map();
    this.availableModels = [];
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
    console.log(`[AIMessageProcessor] Processing message for topic ${topicId}: "${message}"`);

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
      const modelId = this.topicManager.getModelIdForTopic(topicId);
      if (!modelId) {
        console.log('[AIMessageProcessor] No AI model registered for this topic');
        return null;
      }

      // Get the AI person ID for this model (requires aiContactManager)
      const aiPersonId = await this.getAIPersonIdForModel(modelId);
      if (!aiPersonId) {
        console.error('[AIMessageProcessor] Could not get AI person ID');
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

      console.log(`[AIMessageProcessor] Sending ${history.length} messages to LLM`);

      // Generate message ID for streaming
      const messageId = `ai-${Date.now()}`;
      let fullResponse = '';

      // Emit thinking indicator via platform
      if (this.platform) {
        this.platform.emitProgress(topicId, 0);
      }

      // Get AI response with analysis in a single call
      const result: any = await this.llmManager?.chatWithAnalysis(
        history,
        modelId,
        {
          onStream: (chunk: string) => {
            fullResponse += chunk;

            // Send streaming updates via platform
            if (this.platform) {
              this.platform.emitMessageUpdate(topicId, messageId, fullResponse, 'streaming');
            }
          },
        },
        topicId // Pass topicId for analysis
      );

      const response = result?.response;

      // Process analysis in background (non-blocking)
      if (result?.analysis && this.taskManager) {
        setImmediate(async () => {
          try {
            console.log('[AIMessageProcessor] Processing analysis in background...');
            await this.processAnalysisResults(topicId, result.analysis);
          } catch (error) {
            console.error('[AIMessageProcessor] Analysis processing failed:', error);
          }
        });
      }

      // Emit completion via platform
      if (this.platform) {
        this.platform.emitMessageUpdate(topicId, messageId, response || fullResponse, 'complete');
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
    console.log(`[AIMessageProcessor] Generating welcome message for topic: ${topicId}`);

    try {
      // Emit thinking indicator
      if (this.platform) {
        this.platform.emitProgress(topicId, 0);
      }

      // Build welcome prompt
      const welcomePrompt = this.buildWelcomePrompt(topicId);

      const history = [
        {
          role: 'system' as const,
          content: 'You are a helpful AI assistant. Greet the user warmly and briefly.',
        },
        {
          role: 'user' as const,
          content: welcomePrompt,
        },
      ];

      // Generate welcome message
      const messageId = `welcome-${Date.now()}`;
      let fullResponse = '';

      const result = await this.llmManager?.chatWithAnalysis(
        history,
        modelId,
        {
          onStream: (chunk: string) => {
            fullResponse += chunk;

            // Send streaming updates
            if (this.platform) {
              this.platform.emitMessageUpdate(topicId, messageId, fullResponse, 'streaming');
            }
          },
        },
        topicId
      );

      const response = result?.response || fullResponse;

      // Emit completion
      if (this.platform) {
        this.platform.emitMessageUpdate(topicId, messageId, response, 'complete');
      }

      console.log(`[AIMessageProcessor] Generated welcome message for topic: ${topicId}`);
    } catch (error) {
      console.error('[AIMessageProcessor] Failed to generate welcome message:', error);

      // Emit error
      if (this.platform) {
        this.platform.emitError(topicId, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Build welcome prompt based on topic ID
   */
  private buildWelcomePrompt(topicId: string): string {
    if (topicId === 'hi') {
      return 'Please introduce yourself briefly and warmly.';
    } else if (topicId === 'lama') {
      return 'Welcome the user to LAMA (your private conversation space).';
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

    // Process subjects if present
    if (analysis.subjects && Array.isArray(analysis.subjects)) {
      console.log(`[AIMessageProcessor] Processing ${analysis.subjects.length} subjects...`);

      for (const subjectData of analysis.subjects) {
        try {
          await this.processSubject(topicId, subjectData);
        } catch (error) {
          console.warn('[AIMessageProcessor] Failed to process subject:', error);
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

    // This would delegate to TopicAnalysisModel if available
    // For now, just log the subject data
    console.log(`[AIMessageProcessor] Subject data:`, {
      name,
      description,
      isNew,
      keywordCount: subjectKeywords?.length || 0,
    });
  }

  /**
   * Get AI person ID for a model (requires AIContactManager)
   * This is a helper that would be injected or accessed via dependency
   */
  private async getAIPersonIdForModel(modelId: string): Promise<SHA256IdHash<Person> | null> {
    // Find the model in available models
    const model = this.availableModels.find(m => m.id === modelId);
    if (!model) {
      console.error(`[AIMessageProcessor] Model ${modelId} not found in available models`);
      return null;
    }

    // Return cached personId if available
    if (model.personId) {
      return model.personId;
    }

    // This would normally call aiContactManager.ensureAIContactForModel(modelId)
    // For now, return null - this will be wired up in AIHandler
    console.warn('[AIMessageProcessor] Model personId not cached, contact manager integration needed');
    return null;
  }

  /**
   * Optional callback for generation progress
   */
  onGenerationProgress?: (topicId: string, progress: number) => void;
}
