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
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type { IAIPromptBuilder, IAIMessageProcessor } from './interfaces.js';
import type { PromptResult, RestartContext } from './types.js';
import {
  buildContextWithinBudget,
  formatForAnthropicWithCaching,
  formatForStandardAPI,
  type PromptParts
} from '../../services/context-budget-manager.js';
import { calculateAbstractionLevel } from '../../services/abstraction-level-calculator.js';
import type { SubjectForSummary } from '../../services/subject-summarizer.js';

export class AIPromptBuilder implements IAIPromptBuilder {
  // Circular dependency - injected via setter
  private messageProcessor?: IAIMessageProcessor;

  // Last restart points (topicId → message count)
  private lastRestartPoint: Map<string, number>;

  // Topic restart summaries
  private topicRestartSummaries: Map<string, any>;

  // Message cache: topicId → {messages, timestamp}
  // Caches retrieveAllMessages() results with 5-second TTL
  private messageCache: Map<string, { messages: any[]; timestamp: number }>;
  private readonly MESSAGE_CACHE_TTL = 5000; // 5 seconds

  constructor(
    _leuteModel: LeuteModel,
    _channelManager: ChannelManager,
    private topicModel: any, // Shared TopicModel instance
    private llmManager: any, // LLMManager interface
    private topicManager: any, // AITopicManager
    private aiManager: any, // AIManager for Person → LLM resolution
    private contextEnrichmentService?: any // Optional - for past conversation hints
  ) {
    this.lastRestartPoint = new Map();
    this.topicRestartSummaries = new Map();
    this.messageCache = new Map();
  }

  /**
   * Set message processor (circular dependency resolution)
   */
  setMessageProcessor(processor: IAIMessageProcessor): void {
    this.messageProcessor = processor;
  }

  /**
   * Build a prompt for a message with conversation history
   * Now uses abstraction-based context management with prompt caching
   */
  async buildPrompt(
    topicId: string,
    newMessage: string,
    _senderId: SHA256IdHash<Person>
  ): Promise<PromptResult> {
    console.log(`[AIPromptBuilder] Building prompt for topic: ${topicId} (abstraction-based)`);

    try {
      // Get model context window by resolving AI Person → Model ID
      const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
      let modelId: string | null = null;
      if (aiPersonId) {
        try {
          modelId = await this.aiManager.getLLMId(aiPersonId);
        } catch (error) {
          console.warn(`[AIPromptBuilder] Could not resolve model ID for topic ${topicId}, using defaults:`, error);
        }
      }

      const model = await this.getModelById(modelId);
      const contextWindow = model?.contextLength || 8192; // Default to Ollama-scale (most local models)

      // Get system prompt (will be Part 1)
      const systemPrompt = await this.buildSystemPrompt(topicId);

      // Get past subjects from other topics (will be Part 2)
      const pastSubjects = await this.getPastSubjectsWithAbstraction(topicId);
      console.log(`[AIPromptBuilder] Retrieved ${pastSubjects.length} past subjects`);

      // Get messages from current topic (will be Part 3)
      const allMessages = await this.getCachedMessages(topicId);
      const currentSubjectMessages = this.formatMessagesForContext(allMessages);

      // Build context using budget manager with abstraction-based compression
      const promptParts = buildContextWithinBudget({
        modelId: modelId || 'unknown',
        modelContextWindow: contextWindow,
        systemPrompt,
        pastSubjects,
        currentSubjectMessages,
        currentMessage: newMessage,
        targetPastSubjectCount: 20,
        targetMessageLimit: 30
      });

      // Log budget info
      console.log(`[AIPromptBuilder] Context budget:`, {
        total: promptParts.totalTokens,
        part1: promptParts.part1.tokens,
        part2: promptParts.part2.tokens,
        part3: promptParts.part3.tokens,
        part4: promptParts.part4.tokens,
        compression: promptParts.budget.compressionMode,
        pastSubjects: promptParts.budget.pastSubjectCount,
        messages: promptParts.budget.currentMessageLimit
      });

      // Return prompt parts directly
      // llm-manager will handle provider-specific formatting
      return {
        messages: [], // Deprecated - use promptParts instead
        needsRestart: false,
        restartContext: undefined,
        promptParts // LLM manager uses this for provider-specific formatting
      };
    } catch (error) {
      console.error('[AIPromptBuilder] Failed to build prompt:', error);
      throw error;
    }
  }

  /**
   * Build system prompt (Part 1)
   * Uses Phase 1 prompt (natural language) - Phase 2 analytics happens separately
   */
  private async buildSystemPrompt(topicId: string): Promise<string> {
    // Import Phase 1 system prompt (natural language, no JSON structure)
    const { PHASE1_SYSTEM_PROMPT } = await import('../../constants/system-prompts.js');
    let systemPrompt = PHASE1_SYSTEM_PROMPT;

    // Add context enrichment if available
    if (this.contextEnrichmentService) {
      try {
        const messages = await this.getCachedMessages(topicId);
        const contextHints = await this.contextEnrichmentService.buildEnhancedContext(topicId, messages);
        if (contextHints) {
          systemPrompt += `\n\n${contextHints}`;
        }
      } catch (error) {
        console.warn('[AIPromptBuilder] Context enrichment failed:', error);
      }
    }

    return systemPrompt;
  }

  /**
   * Format messages for context (Part 3)
   */
  private formatMessagesForContext(messages: any[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const formatted: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    for (const msg of messages) {
      const text = (msg as any).data?.text || (msg as any).text;
      const msgSender = (msg as any).data?.sender || (msg as any).author;
      const isAI = this.isAIMessage(msgSender);

      if (text && text.trim()) {
        formatted.push({
          role: (isAI ? 'assistant' : 'user') as 'system' | 'user' | 'assistant',
          content: text
        });
      }
    }

    return formatted;
  }


  /**
   * Check if context window restart is needed
   */
  async checkContextWindowAndPrepareRestart(
    topicId: string,
    messages: any[]
  ): Promise<RestartContext> {
    // Get the model's context window size by resolving AI Person → LLM Person → Model ID
    const aiPersonId = this.topicManager.getAIPersonForTopic(topicId);
    let modelId: string | null = null;
    if (aiPersonId && this.aiManager.isAI(aiPersonId)) {
      try {
        const llmPersonId = await this.aiManager.resolveLLMPerson(aiPersonId);
        const llmId = this.aiManager.getEntityId(llmPersonId);
        if (llmId && llmId.startsWith('llm:')) {
          modelId = llmId.replace(/^llm:/, '');
        }
      } catch (error) {
        console.error(`[AIPromptBuilder] Failed to resolve model ID for topic ${topicId}:`, error);
      }
    }

    const model = await this.getModelById(modelId);

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
        words.filter((w: string) => w.length > 5).forEach((w: string) => topics.add(w));

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
    const topicRoom = await this.topicModel.enterTopicRoom(topicId);
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
  private async getModelById(modelId: string | null): Promise<any> {
    if (!modelId) {
      return null;
    }

    const models = await this.llmManager?.getAvailableModels();
    return models?.find((m: any) => m.id === modelId);
  }

  /**
   * Check if a message is from an AI (requires messageProcessor)
   */
  private async isAIMessage(personId: SHA256IdHash<Person> | string): Promise<boolean> {
    if (!this.messageProcessor) {
      console.warn('[AIPromptBuilder] MessageProcessor not set, cannot check if AI message');
      return false;
    }

    return await this.messageProcessor.isAIContact(personId);
  }

  /**
   * Get topic analysis model (if available)
   */
  private get topicAnalysisModel(): any {
    // This would be injected if needed - for now return undefined
    return undefined;
  }

  /**
   * Retrieve past subjects from all topics with abstraction levels
   */
  private async getPastSubjectsWithAbstraction(currentTopicId: string): Promise<SubjectForSummary[]> {
    if (!this.topicAnalysisModel) {
      return [];
    }

    try {
      // Get all topics
      const allTopics = await this.topicAnalysisModel.getAllTopics?.();
      if (!allTopics || allTopics.length === 0) {
        return [];
      }

      const pastSubjects: SubjectForSummary[] = [];

      // Get subjects from all topics except current
      for (const topic of allTopics) {
        if (topic.id === currentTopicId) continue; // Skip current topic

        try {
          const subjects = await this.topicAnalysisModel.getSubjects(topic.id);
          if (!subjects) continue;

          for (const subject of subjects) {
            if (subject.archived) continue;

            // Calculate abstraction level if not set
            let abstractionLevel = subject.abstractionLevel;
            if (!abstractionLevel) {
              const keywords = subject.keywords || [];
              const keywordTerms = await this.resolveKeywordTerms(keywords);
              const analysis = calculateAbstractionLevel({
                keywords: keywordTerms,
                description: subject.description,
                messageCount: subject.messageCount
              });
              abstractionLevel = analysis.level;
            }

            pastSubjects.push({
              id: subject.id,
              description: subject.description || subject.keywordCombination || subject.id,
              keywords: await this.resolveKeywordTerms(subject.keywords || []),
              messageCount: subject.messageCount || 0,
              abstractionLevel,
              created: subject.createdAt,
              lastSeenAt: subject.lastSeenAt
            });
          }
        } catch (error) {
          console.warn(`[AIPromptBuilder] Failed to get subjects for topic ${topic.id}:`, error);
        }
      }

      // Sort by recency (last seen)
      pastSubjects.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));

      return pastSubjects;
    } catch (error) {
      console.error('[AIPromptBuilder] Failed to retrieve past subjects:', error);
      return [];
    }
  }

  /**
   * Resolve keyword ID hashes to terms
   */
  private async resolveKeywordTerms(keywordIds: any[]): Promise<string[]> {
    if (!this.topicAnalysisModel || !keywordIds || keywordIds.length === 0) {
      return [];
    }

    try {
      const terms: string[] = [];
      for (const keywordId of keywordIds) {
        const keyword = await this.topicAnalysisModel.getKeywordById?.(keywordId);
        if (keyword && keyword.term) {
          terms.push(keyword.term);
        }
      }
      return terms;
    } catch (error) {
      console.warn('[AIPromptBuilder] Failed to resolve keyword terms:', error);
      return [];
    }
  }

  /**
   * Get cached messages or load fresh if cache miss/expired
   */
  private async getCachedMessages(topicId: string): Promise<any[]> {
    const now = Date.now();
    const cached = this.messageCache.get(topicId);

    // Cache hit and still valid
    if (cached && (now - cached.timestamp) < this.MESSAGE_CACHE_TTL) {
      console.log(`[AIPromptBuilder] Message cache HIT for topic ${topicId}`);
      return cached.messages;
    }

    // Cache miss or expired - load fresh
    console.log(`[AIPromptBuilder] Message cache MISS for topic ${topicId} - loading from channel`);
    const topicRoom = await this.topicModel.enterTopicRoom(topicId);
    const messages = await topicRoom.retrieveAllMessages();

    // Store in cache
    this.messageCache.set(topicId, {
      messages,
      timestamp: now
    });

    return messages;
  }

  /**
   * Add a new message to the cache (updates cache instead of invalidating)
   */
  public addMessageToCache(topicId: string, message: any): void {
    const cached = this.messageCache.get(topicId);

    if (cached) {
      // Append to existing cache
      cached.messages.push(message);
      cached.timestamp = Date.now(); // Refresh timestamp
      console.log(`[AIPromptBuilder] Added message to cache for topic ${topicId} (now ${cached.messages.length} messages)`);
    } else {
      // No cache exists - create new cache with this message
      this.messageCache.set(topicId, {
        messages: [message],
        timestamp: Date.now()
      });
      console.log(`[AIPromptBuilder] Created cache with 1 message for topic ${topicId}`);
    }
  }

  /**
   * Invalidate message cache for a topic (call when cache is unreliable)
   */
  public invalidateMessageCache(topicId: string): void {
    this.messageCache.delete(topicId);
    console.log(`[AIPromptBuilder] Invalidated message cache for topic ${topicId}`);
  }

  /**
   * Clear all message caches
   */
  public clearMessageCache(): void {
    this.messageCache.clear();
    console.log('[AIPromptBuilder] Cleared all message caches');
  }
}
