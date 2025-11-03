/**
 * Types for Chat-Memory Integration
 * Platform-agnostic types for connecting chat topics with memory subjects
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';

/**
 * Chat memory configuration stored per topic
 */
export interface ChatMemoryConfig {
  topicId: SHA256IdHash<any>;
  enabled: boolean;
  autoExtract: boolean;          // Automatically extract subjects from messages
  updateInterval?: number;        // How often to update memories (ms)
  minConfidence?: number;         // Minimum confidence for subject extraction
  keywords?: string[];            // Additional keywords to track
}

/**
 * Association between a chat topic and a memory subject
 */
export interface ChatMemoryAssociation {
  $type$: 'ChatMemoryAssociation';
  id: string;                     // Unique ID for this association
  topicId: SHA256IdHash<any>;    // Chat topic
  subjectIdHash: SHA256IdHash<any>; // Memory subject
  keywords: string[];             // Keywords that link them
  confidence: number;             // Confidence score (0-1)
  created: number;
  lastUpdated: number;
  messageCount: number;           // Number of messages that contributed
}

/**
 * Memory context for a chat message
 */
export interface MessageMemoryContext {
  messageId: SHA256Hash<any>;
  extractedSubjects: ExtractedSubject[];
  relatedMemories: RelatedMemory[];
  timestamp: number;
}

/**
 * Subject extracted from a message
 */
export interface ExtractedSubject {
  name: string;
  keywords: string[];
  confidence: number;
  description?: string;
  messageExcerpt?: string;      // Relevant excerpt from message
}

/**
 * Related memory for context
 */
export interface RelatedMemory {
  subjectIdHash: SHA256IdHash<any>;
  name: string;
  keywords: string[];
  relevanceScore: number;       // How relevant to current context
  lastUpdated: number;
}

/**
 * Memory update event
 */
export interface MemoryUpdateEvent {
  type: 'created' | 'updated' | 'linked';
  topicId: SHA256IdHash<any>;
  subjectIdHash: SHA256IdHash<any>;
  subjectName: string;
  keywords: string[];
  timestamp: number;
}

/**
 * Request to extract subjects from messages
 */
export interface ExtractSubjectsRequest {
  topicId: SHA256IdHash<any>;
  messageIds?: SHA256Hash<any>[]; // Specific messages, or all recent
  limit?: number;
  includeContext?: boolean;
}

/**
 * Response with extracted subjects
 */
export interface ExtractSubjectsResponse {
  subjects: ExtractedSubject[];
  totalMessages: number;
  processingTime: number;
}

/**
 * Request to find related memories
 */
export interface FindRelatedMemoriesRequest {
  topicId?: SHA256IdHash<any>;
  keywords: string[];
  limit?: number;
  minRelevance?: number;
}

/**
 * Response with related memories
 */
export interface FindRelatedMemoriesResponse {
  memories: RelatedMemory[];
  searchKeywords: string[];
  totalFound: number;
}
