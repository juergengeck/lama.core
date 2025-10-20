/**
 * AIPromptBuilder
 *
 * Constructs prompts with conversation context for LLM generation.
 * Handles context window management, conversation summarization, and
 * context enrichment from past conversations.
 *
 * Responsibilities:
 * - Build message history with proper role detection (user/assistant)
 * - Check context window limits and trigger restarts
 * - Generate conversation summaries for context continuity
 * - Enrich context with hints from past conversations
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type { IAIPromptBuilder, IAIMessageProcessor } from './interfaces.js';
import type { PromptResult, RestartContext } from './types.js';

export class AIPromptBuilder implements IAIPromptBuilder {
  // Circular dependency - injected via setter
  private messageProcessor?: IAIMessageProcessor;

  // Last restart points (topicId → message count)
  private lastRestartPoint: Map<string, number>;

  // Topic restart summaries
  private topicRestartSummaries: Map<string, any>;

  constructor(
    private channelManager: ChannelManager,
    private llmManager: any, // LLMManager interface
    private topicManager: any, // AITopicManager
    private contextEnrichmentService?: any // Optional - for past conversation hints
  ) {
    this.lastRestartPoint = new Map();
    this.topicRestartSummaries = new Map();
  }

  /**
   * Set message processor (circular dependency resolution)
   */
  setMessageProcessor(processor: IAIMessageProcessor): void {
    this.messageProcessor = processor;
  }

  /**
   * Build a prompt for a message with conversation history
   */
  async buildPrompt(
    topicId: string,
    newMessage: string,
    senderId: SHA256IdHash<Person>
  ): Promise<PromptResult> {
    console.log(`[AIPromptBuilder] Building prompt for topic: ${topicId}`);

    try {
      // Get topic room and retrieve messages
      const TopicModel = (await import('@refinio/one.models/lib/models/Chat/TopicModel.js')).default;
      const topicModel = new TopicModel(this.channelManager as any);
      const topicRoom = await topicModel.enterTopicRoom(topicId);
      const messages = await topicRoom.retrieveAllMessages();

      // Check if context window restart is needed
      const { needsRestart, restartContext } = await this.checkContextWindowAndPrepareRestart(
        topicId,
        messages
      );

      // Build message history with proper role detection
      const history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

      if (needsRestart && restartContext) {
        // Use summary-based restart context
        history.push({
          role: 'system',
          content: restartContext,
        });
        console.log('[AIPromptBuilder] Using summary-based restart context');

        // Only include very recent messages (last 3) after restart
        const veryRecentMessages = messages.slice(-3);
        for (const msg of veryRecentMessages) {
          const text = (msg as any).data?.text || (msg as any).text;
          const msgSender = (msg as any).data?.sender || (msg as any).author;
          const isAI = this.isAIMessage(msgSender);

          if (text && text.trim()) {
            history.push({
              role: isAI ? 'assistant' : 'user',
              content: text,
            });
          }
        }
      } else {
        // Normal context enrichment flow
        if (this.contextEnrichmentService) {
          try {
            const contextHints = await this.contextEnrichmentService.buildEnhancedContext(
              topicId,
              messages
            );
            if (contextHints) {
              history.push({
                role: 'system',
                content: contextHints,
              });
              console.log(`[AIPromptBuilder] Added context hints: ${String(contextHints).substring(0, 100)}...`);
            }
          } catch (error) {
            console.warn('[AIPromptBuilder] Context enrichment failed:', error);
          }
        }

        // Get last 10 messages for context
        const recentMessages = messages.slice(-10);
        for (const msg of recentMessages) {
          const text = (msg as any).data?.text || (msg as any).text;
          const msgSender = (msg as any).data?.sender || (msg as any).author;
          const isAI = this.isAIMessage(msgSender);

          if (text && text.trim()) {
            history.push({
              role: isAI ? 'assistant' : 'user',
              content: text,
            });
          }
        }
      }

      // Add the new message if not already in history
      const lastHistoryMsg = history[history.length - 1];
      if (!lastHistoryMsg || lastHistoryMsg.content !== newMessage) {
        history.push({
          role: 'user',
          content: newMessage,
        });
      }

      console.log(`[AIPromptBuilder] Built prompt with ${history.length} messages`);

      return {
        messages: history,
        needsRestart,
        restartContext: restartContext || undefined,
      };
    } catch (error) {
      console.error('[AIPromptBuilder] Failed to build prompt:', error);
      throw error;
    }
  }

  /**
   * Check if context window restart is needed
   */
  async checkContextWindowAndPrepareRestart(
    topicId: string,
    messages: any[]
  ): Promise<RestartContext> {
    // Get the model's context window size
    const modelId = this.topicManager.getModelIdForTopic(topicId);
    const model = this.getModelById(modelId);

    // Get context window from model definition, default to conservative 4k
    const contextWindow = model?.contextLength || 4096;

    // Reserve 25% for response and system prompts
    const usableContext = Math.floor(contextWindow * 0.75);

    // Estimate token count (rough: 1 token ≈ 4 chars for English)
    const estimatedTokens = messages.reduce((total, msg) => {
      const text = (msg as any).data?.text || (msg as any).text || '';
      return total + Math.ceil(text.length / 4);
    }, 0);

    // Add estimated system prompt tokens
    const systemPromptTokens = 200; // Typical system prompt overhead
    const totalTokens = estimatedTokens + systemPromptTokens;

    if (totalTokens < usableContext) {
      return { needsRestart: false, restartContext: null };
    }

    console.log(
      `[AIPromptBuilder] Context window filling (${totalTokens}/${contextWindow} tokens for ${model?.name || modelId}), preparing restart`
    );

    // Generate or retrieve summary for restart
    const restartContext = await this.generateConversationSummaryForRestart(topicId, messages);

    if (restartContext) {
      // Store restart point for potential recovery
      this.lastRestartPoint.set(topicId, messages.length);
    }

    return { needsRestart: true, restartContext };
  }

  /**
   * Generate conversation summary for restart
   */
  async generateConversationSummaryForRestart(topicId: string, messages: any[]): Promise<string> {
    try {
      // Try to use existing Summary objects from TopicAnalysisModel
      if (this.topicAnalysisModel) {
        const currentSummary = await this.topicAnalysisModel.getCurrentSummary(topicId);

        if (currentSummary && currentSummary.content) {
          // Get subjects and keywords for additional context
          const subjects = await this.topicAnalysisModel.getSubjects(topicId);
          const keywords = await this.topicAnalysisModel.getKeywords(topicId);

          // Build comprehensive restart context
          let restartContext = `[Conversation Continuation]\n\n`;
          restartContext += `Previous Summary:\n${currentSummary.content}\n\n`;

          if (subjects && subjects.length > 0) {
            const activeSubjects = subjects.filter((s: any) => !s.archived).slice(0, 5);
            if (activeSubjects.length > 0) {
              restartContext += `Active Themes:\n`;
              activeSubjects.forEach((s: any) => {
                restartContext += `• ${s.keywordCombination}: ${s.description || 'Ongoing discussion'}\n`;
              });
              restartContext += '\n';
            }
          }

          if (keywords && keywords.length > 0) {
            const topKeywords = keywords
              .sort((a: any, b: any) => (b?.frequency || 0) - (a?.frequency || 0))
              .slice(0, 12)
              .map((k: any) => k.term);
            restartContext += `Key Concepts: ${topKeywords.join(', ')}\n\n`;
          }

          restartContext += `Maintain continuity with the established context. The conversation has ${messages.length} prior messages.`;

          console.log(`[AIPromptBuilder] Using existing Summary object (v${currentSummary.version}) for restart`);
          return restartContext;
        }

        // If no summary exists yet, trigger analysis to create one
        console.log('[AIPromptBuilder] No summary found, triggering topic analysis...');
        const analysis = await this.topicAnalysisModel.analyzeMessages(topicId, messages.slice(-50));

        if (analysis && analysis.summary) {
          // Recursive call with new summary
          return this.generateConversationSummaryForRestart(topicId, messages);
        }
      }

      // Fallback: Create basic summary from messages
      const messageSample = messages.slice(-20); // Last 20 messages
      const topics = new Set<string>();
      const participants = new Set<string>();

      for (const msg of messageSample) {
        const text = (msg as any).data?.text || (msg as any).text || '';
        const sender = (msg as any).data?.sender || (msg as any).author;

        // Extract potential topics (simple keyword extraction)
        const words = text.toLowerCase().split(/\s+/);
        words.filter(w => w.length > 5).forEach(w => topics.add(w));

        if (sender && !this.isAIMessage(sender)) {
          participants.add('User');
        }
      }

      const topicList = Array.from(topics).slice(0, 8).join(', ');
      const messageCount = messages.length;

      return `Continuing conversation #${String(topicId).substring(0, 8)}. Previous ${messageCount} messages discussed: ${topicList}. Maintain context and continuity.`;
    } catch (error) {
      console.error('[AIPromptBuilder] Failed to generate restart summary:', error);
      return `Continuing previous conversation. Maintain context and natural flow.`;
    }
  }

  /**
   * Manually trigger conversation restart with summary
   */
  async restartConversationWithSummary(topicId: string): Promise<string | null> {
    const TopicModel = (await import('@refinio/one.models/lib/models/Chat/TopicModel.js')).default;
    const topicModel = new TopicModel(this.channelManager as any);
    const topicRoom = await topicModel.enterTopicRoom(topicId);
    const messages = await topicRoom.retrieveAllMessages();

    const summary = await this.generateConversationSummaryForRestart(topicId, messages);

    if (summary) {
      console.log(`[AIPromptBuilder] Conversation restarted with summary for topic ${topicId}`);

      // Store the summary as metadata for the topic
      this.topicRestartSummaries.set(topicId, {
        summary,
        timestamp: Date.now(),
        messageCountAtRestart: messages.length,
      });

      return summary;
    }

    return null;
  }

  /**
   * Get model by ID (helper method)
   */
  private getModelById(modelId: string | null): any {
    if (!modelId) {
      return null;
    }

    const models = this.llmManager?.getAvailableModels();
    return models?.find((m: any) => m.id === modelId);
  }

  /**
   * Check if a message is from an AI (requires messageProcessor)
   */
  private isAIMessage(personId: SHA256IdHash<Person> | string): boolean {
    if (!this.messageProcessor) {
      console.warn('[AIPromptBuilder] MessageProcessor not set, cannot check if AI message');
      return false;
    }

    return this.messageProcessor.isAIContact(personId);
  }

  /**
   * Get topic analysis model (if available)
   */
  private get topicAnalysisModel(): any {
    // This would be injected if needed - for now return undefined
    return undefined;
  }
}
