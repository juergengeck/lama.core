/**
 * Chat Memory Handler
 * Platform-agnostic handler for chat-memory integration
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { ChatMemoryService } from '../services/ChatMemoryService.js';
import type {
  ChatMemoryConfig,
  ChatMemoryAssociation,
  ExtractSubjectsRequest,
  ExtractSubjectsResponse,
  FindRelatedMemoriesRequest,
  FindRelatedMemoriesResponse
} from '../types/chat-memory-types.js';

export interface ChatMemoryHandlerDependencies {
  chatMemoryService: ChatMemoryService;
}

/**
 * ChatMemoryHandler
 *
 * Provides handler methods for chat-memory operations:
 * - Enable/disable memories per topic
 * - Extract subjects from chat messages
 * - Find related memories by keywords
 * - Manage memory updates
 */
export class ChatMemoryHandler {
  constructor(private deps: ChatMemoryHandlerDependencies) {}

  /**
   * Enable memory extraction for a chat topic
   */
  async enableMemories(
    topicId: SHA256IdHash<any>,
    autoExtract = true,
    keywords: string[] = []
  ): Promise<ChatMemoryConfig> {
    return await this.deps.chatMemoryService.enableMemories(topicId, {
      autoExtract,
      keywords
    });
  }

  /**
   * Disable memory extraction for a chat topic
   */
  async disableMemories(topicId: SHA256IdHash<any>): Promise<void> {
    await this.deps.chatMemoryService.disableMemories(topicId);
  }

  /**
   * Toggle memory extraction for a chat topic
   */
  async toggleMemories(topicId: SHA256IdHash<any>): Promise<boolean> {
    const isEnabled = this.deps.chatMemoryService.isEnabled(topicId);

    if (isEnabled) {
      await this.disableMemories(topicId);
      return false;
    } else {
      await this.enableMemories(topicId);
      return true;
    }
  }

  /**
   * Get memory status for a chat topic
   */
  getMemoryStatus(topicId: SHA256IdHash<any>): {
    enabled: boolean;
    config?: ChatMemoryConfig;
  } {
    const enabled = this.deps.chatMemoryService.isEnabled(topicId);
    const config = this.deps.chatMemoryService.getConfig(topicId);

    return { enabled, config };
  }

  /**
   * Extract subjects from chat messages and store as memories
   */
  async extractSubjects(
    request: ExtractSubjectsRequest
  ): Promise<ExtractSubjectsResponse> {
    return await this.deps.chatMemoryService.extractAndStoreSubjects(request);
  }

  /**
   * Find related memories for a chat topic
   */
  async findRelatedMemories(
    topicId: SHA256IdHash<any>,
    keywords: string[],
    limit = 10
  ): Promise<FindRelatedMemoriesResponse> {
    return await this.deps.chatMemoryService.findRelatedMemories({
      topicId,
      keywords,
      limit,
      minRelevance: 0.3
    });
  }

  /**
   * Get all memory associations for a chat topic
   */
  async getAssociations(topicId: SHA256IdHash<any>): Promise<ChatMemoryAssociation[]> {
    return await this.deps.chatMemoryService.getAssociations(topicId);
  }

  /**
   * Update a memory with new information from chat
   */
  async updateMemoryFromChat(
    subjectIdHash: SHA256IdHash<any>,
    topicId: SHA256IdHash<any>,
    newKeywords: string[],
    additionalDescription?: string
  ): Promise<void> {
    await this.deps.chatMemoryService.updateMemory(
      subjectIdHash,
      topicId,
      newKeywords,
      additionalDescription
    );
  }

  /**
   * Auto-extract subjects from recent messages in a topic
   *
   * This is typically called:
   * - When memories are first enabled
   * - Periodically for active chats
   * - On demand from UI
   */
  async autoExtractFromTopic(
    topicId: SHA256IdHash<any>,
    messageLimit = 50
  ): Promise<ExtractSubjectsResponse> {
    if (!this.deps.chatMemoryService.isEnabled(topicId)) {
      throw new Error(`Memories not enabled for topic: ${topicId}`);
    }

    return await this.extractSubjects({
      topicId,
      limit: messageLimit,
      includeContext: true
    });
  }

  /**
   * Get memory suggestions for current chat context
   *
   * Returns relevant memories based on recent message keywords
   */
  async getMemorySuggestions(
    topicId: SHA256IdHash<any>,
    recentKeywords: string[],
    limit = 5
  ): Promise<FindRelatedMemoriesResponse> {
    return await this.findRelatedMemories(topicId, recentKeywords, limit);
  }
}
