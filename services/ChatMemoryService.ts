/**
 * Chat Memory Service
 * Manages automatic extraction of subjects from chat and storage as memories
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type {
  ChatMemoryConfig,
  ChatMemoryAssociation,
  ExtractedSubject,
  RelatedMemory,
  ExtractSubjectsRequest,
  ExtractSubjectsResponse,
  FindRelatedMemoriesRequest,
  FindRelatedMemoriesResponse
} from '../types/chat-memory-types.js';

export interface ChatMemoryServiceDependencies {
  nodeOneCore: any;
  topicAnalyzer?: any;            // From one-ai for subject extraction
  memoryHandler?: any;            // MemoryHandler for storing subjects
  storeVersionedObject?: any;     // For storing associations
  getObjectByIdHash?: any;        // For retrieving associations
}

/**
 * ChatMemoryService
 *
 * Automatically extracts subjects from chat messages and stores them as memories.
 * Provides keyword-based retrieval and association management.
 */
export class ChatMemoryService {
  private configs: Map<string, ChatMemoryConfig> = new Map();
  private associations: Map<string, ChatMemoryAssociation[]> = new Map();

  constructor(private deps: ChatMemoryServiceDependencies) {}

  /**
   * Enable memory extraction for a topic
   */
  async enableMemories(
    topicId: SHA256IdHash<any>,
    config: Partial<ChatMemoryConfig> = {}
  ): Promise<ChatMemoryConfig> {
    const memoryConfig: ChatMemoryConfig = {
      topicId,
      enabled: true,
      autoExtract: config.autoExtract ?? true,
      updateInterval: config.updateInterval ?? 60000, // 1 minute
      minConfidence: config.minConfidence ?? 0.5,
      keywords: config.keywords ?? []
    };

    this.configs.set(topicId, memoryConfig);

    // Store config in ONE.core
    if (this.deps.storeVersionedObject) {
      await this.deps.storeVersionedObject({
        $type$: 'ChatMemoryConfig',
        ...memoryConfig
      });
    }

    return memoryConfig;
  }

  /**
   * Disable memory extraction for a topic
   */
  async disableMemories(topicId: SHA256IdHash<any>): Promise<void> {
    const config = this.configs.get(topicId);
    if (config) {
      config.enabled = false;
      this.configs.set(topicId, config);

      // Update stored config
      if (this.deps.storeVersionedObject) {
        await this.deps.storeVersionedObject({
          $type$: 'ChatMemoryConfig',
          ...config
        });
      }
    }
  }

  /**
   * Check if memories are enabled for a topic
   */
  isEnabled(topicId: SHA256IdHash<any>): boolean {
    const config = this.configs.get(topicId);
    return config?.enabled ?? false;
  }

  /**
   * Get memory configuration for a topic
   */
  getConfig(topicId: SHA256IdHash<any>): ChatMemoryConfig | undefined {
    return this.configs.get(topicId);
  }

  /**
   * Extract subjects from messages and store as memories
   */
  async extractAndStoreSubjects(
    request: ExtractSubjectsRequest
  ): Promise<ExtractSubjectsResponse> {
    const startTime = Date.now();

    if (!this.isEnabled(request.topicId)) {
      throw new Error(`Memories not enabled for topic: ${request.topicId}`);
    }

    if (!this.deps.topicAnalyzer) {
      throw new Error('Topic analyzer not available');
    }

    if (!this.deps.memoryHandler) {
      throw new Error('Memory handler not available');
    }

    const config = this.getConfig(request.topicId);

    // Get messages to analyze
    const messages = await this.getMessages(request.topicId, request.messageIds, request.limit);

    // Extract keywords and subjects using TopicAnalyzer
    const extractedSubjects: ExtractedSubject[] = [];
    const allKeywords = new Map<string, number>(); // keyword -> frequency

    for (const message of messages) {
      try {
        // Extract keywords from message content
        const keywords = await this.deps.topicAnalyzer.extractKeywords(
          message.text || message.content,
          10 // max keywords per message
        );

        if (keywords && keywords.length > 0) {
          // Track keyword frequency
          for (const keyword of keywords) {
            const normalized = String(keyword).toLowerCase();
            allKeywords.set(normalized, (allKeywords.get(normalized) || 0) + 1);
          }

          // Create subject from message keywords
          // Use top 3 keywords as subject identifier
          const topKeywords = keywords.slice(0, 3);
          const subjectName = topKeywords.join(' ');

          // Calculate confidence based on keyword frequency
          const avgFreq = topKeywords.reduce((sum, kw) => {
            return sum + (allKeywords.get(String(kw).toLowerCase()) || 1);
          }, 0) / topKeywords.length;
          const confidence = Math.min(avgFreq / messages.length, 1.0);

          // Filter by minimum confidence
          if (confidence >= (config?.minConfidence ?? 0.5)) {
            extractedSubjects.push({
              name: subjectName,
              keywords: topKeywords.map(k => String(k)),
              confidence,
              description: this.getExcerpt(message.text || message.content, 150),
              messageExcerpt: this.getExcerpt(message.text || message.content, 200)
            });
          }
        }
      } catch (error) {
        console.error('[ChatMemoryService] Error extracting keywords from message:', error);
      }
    }

    // Store unique subjects as memories
    const uniqueSubjects = this.deduplicateSubjects(extractedSubjects);

    for (const subject of uniqueSubjects) {
      await this.storeSubjectAsMemory(request.topicId, subject);
    }

    return {
      subjects: extractedSubjects,
      totalMessages: messages.length,
      processingTime: Date.now() - startTime
    };
  }

  /**
   * Find related memories by keywords
   */
  async findRelatedMemories(
    request: FindRelatedMemoriesRequest
  ): Promise<FindRelatedMemoriesResponse> {
    if (!this.deps.memoryHandler) {
      throw new Error('Memory handler not available');
    }

    const allSubjectIds = await this.deps.memoryHandler.listSubjects();
    const relatedMemories: RelatedMemory[] = [];

    for (const idHash of allSubjectIds) {
      const subject = await this.deps.memoryHandler.getSubject(idHash);

      if (!subject) continue;

      // Calculate relevance score based on keyword overlap
      const subjectKeywords = this.extractKeywordsFromSubject(subject);
      const relevanceScore = this.calculateRelevance(
        request.keywords,
        subjectKeywords
      );

      if (relevanceScore >= (request.minRelevance ?? 0.3)) {
        relatedMemories.push({
          subjectIdHash: idHash,
          name: subject.name,
          keywords: subjectKeywords,
          relevanceScore,
          lastUpdated: subject.modified ?? subject.created
        });
      }
    }

    // Sort by relevance
    relatedMemories.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Limit results
    const limited = request.limit
      ? relatedMemories.slice(0, request.limit)
      : relatedMemories;

    return {
      memories: limited,
      searchKeywords: request.keywords,
      totalFound: relatedMemories.length
    };
  }

  /**
   * Get associations for a topic
   */
  async getAssociations(topicId: SHA256IdHash<any>): Promise<ChatMemoryAssociation[]> {
    return this.associations.get(topicId) || [];
  }

  /**
   * Update an existing memory with new information
   */
  async updateMemory(
    subjectIdHash: SHA256IdHash<any>,
    topicId: SHA256IdHash<any>,
    newKeywords: string[],
    additionalDescription?: string
  ): Promise<void> {
    if (!this.deps.memoryHandler) {
      throw new Error('Memory handler not available');
    }

    const subject = await this.deps.memoryHandler.getSubject(subjectIdHash);

    if (!subject) {
      throw new Error(`Subject not found: ${subjectIdHash}`);
    }

    // Merge keywords
    const existingKeywords = this.extractKeywordsFromSubject(subject);
    const mergedKeywords = [...new Set([...existingKeywords, ...newKeywords])];

    // Update description if provided
    let description = subject.description || '';
    if (additionalDescription) {
      description = description
        ? `${description}\n\n${additionalDescription}`
        : additionalDescription;
    }

    // Update metadata
    const metadata = subject.metadata || new Map();
    metadata.set('keywords', mergedKeywords.join(','));
    metadata.set('lastUpdatedFrom', topicId);
    metadata.set('lastUpdatedAt', Date.now().toString());

    // Store updated version
    await this.deps.memoryHandler.updateSubject(subjectIdHash, {
      description,
      metadata
    });

    // Update association
    await this.updateAssociation(topicId, subjectIdHash, mergedKeywords);
  }

  // Private helper methods

  private async getMessages(
    topicId: SHA256IdHash<any>,
    messageIds?: SHA256Hash<any>[],
    limit?: number
  ): Promise<any[]> {
    if (!this.deps.nodeOneCore?.channelManager) {
      throw new Error('ChannelManager not available');
    }

    try {
      // Get channel entries for this topic
      const entries = await this.deps.nodeOneCore.channelManager.getChannelEntries(topicId);

      // Filter to messages only (exclude MessageAttestation, etc.)
      let messages = entries
        .filter((entry: any) => entry.data && entry.data.$type$ !== 'MessageAttestation')
        .map((entry: any) => ({
          hash: entry.hash,
          id: entry.hash,
          content: entry.data.content || entry.data.text || '',
          text: entry.data.text || entry.data.content || '',
          timestamp: entry.timestamp || entry.data.timestamp,
          author: entry.author || entry.data.sender
        }));

      // Filter by specific message IDs if provided
      if (messageIds && messageIds.length > 0) {
        const idSet = new Set(messageIds);
        messages = messages.filter((m: any) => idSet.has(m.hash));
      }

      // Sort by timestamp (newest first)
      messages.sort((a: any, b: any) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeB - timeA;
      });

      // Apply limit if specified
      if (limit && limit > 0) {
        messages = messages.slice(0, limit);
      }

      return messages;
    } catch (error) {
      console.error('[ChatMemoryService] Error retrieving messages:', error);
      throw error;
    }
  }

  private getExcerpt(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }

  private deduplicateSubjects(subjects: ExtractedSubject[]): ExtractedSubject[] {
    const seen = new Map<string, ExtractedSubject>();

    for (const subject of subjects) {
      const key = subject.name.toLowerCase();
      const existing = seen.get(key);

      if (!existing || subject.confidence > existing.confidence) {
        seen.set(key, subject);
      }
    }

    return Array.from(seen.values());
  }

  private async storeSubjectAsMemory(
    topicId: SHA256IdHash<any>,
    subject: ExtractedSubject
  ): Promise<SHA256IdHash<any>> {
    const metadata = new Map<string, string>();
    metadata.set('keywords', subject.keywords.join(','));
    metadata.set('confidence', subject.confidence.toString());
    metadata.set('extractedFrom', topicId);
    metadata.set('extractedAt', Date.now().toString());

    if (subject.messageExcerpt) {
      metadata.set('excerpt', subject.messageExcerpt);
    }

    const result = await this.deps.memoryHandler.createSubject({
      id: `chat-${topicId}-${subject.name.toLowerCase().replace(/\s+/g, '-')}`,
      name: subject.name,
      description: subject.description || subject.messageExcerpt,
      metadata,
      sign: false,
      theme: 'auto'
    });

    // Create association
    await this.createAssociation(
      topicId,
      result.idHash as SHA256IdHash<any>,
      subject.keywords,
      subject.confidence
    );

    return result.idHash as SHA256IdHash<any>;
  }

  private extractKeywordsFromSubject(subject: any): string[] {
    if (subject.metadata?.get) {
      const keywordsStr = subject.metadata.get('keywords');
      if (keywordsStr) {
        return keywordsStr.split(',').map((k: string) => k.trim());
      }
    }
    return [];
  }

  private calculateRelevance(keywords1: string[], keywords2: string[]): number {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;

    const set1 = new Set(keywords1.map(k => k.toLowerCase()));
    const set2 = new Set(keywords2.map(k => k.toLowerCase()));

    let overlap = 0;
    for (const k of set1) {
      if (set2.has(k)) overlap++;
    }

    // Jaccard similarity
    const union = new Set([...set1, ...set2]).size;
    return overlap / union;
  }

  private async createAssociation(
    topicId: SHA256IdHash<any>,
    subjectIdHash: SHA256IdHash<any>,
    keywords: string[],
    confidence: number
  ): Promise<void> {
    const association: ChatMemoryAssociation = {
      $type$: 'ChatMemoryAssociation',
      id: `${topicId}-${subjectIdHash}`,
      topicId,
      subjectIdHash,
      keywords,
      confidence,
      created: Date.now(),
      lastUpdated: Date.now(),
      messageCount: 1
    };

    // Store association
    if (this.deps.storeVersionedObject) {
      await this.deps.storeVersionedObject(association);
    }

    // Add to local cache
    const existing = this.associations.get(topicId) || [];
    existing.push(association);
    this.associations.set(topicId, existing);
  }

  private async updateAssociation(
    topicId: SHA256IdHash<any>,
    subjectIdHash: SHA256IdHash<any>,
    keywords: string[]
  ): Promise<void> {
    const associations = this.associations.get(topicId) || [];
    const existing = associations.find(a => a.subjectIdHash === subjectIdHash);

    if (existing) {
      existing.keywords = keywords;
      existing.lastUpdated = Date.now();
      existing.messageCount++;

      // Update in storage
      if (this.deps.storeVersionedObject) {
        await this.deps.storeVersionedObject(existing);
      }
    }
  }
}
