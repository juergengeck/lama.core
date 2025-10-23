/**
 * ProposalCache - LRU cache for proposals
 *
 * Caches proposal results to avoid recomputation for the same topic/subjects combination.
 * Reference: /specs/019-above-the-chat/tasks.md T014
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';

interface CacheEntry {
  proposals: any[];
  timestamp: number;
}

export class ProposalCache {
  private cache: Map<string, CacheEntry>;
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = 50, ttlMs = 60000) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /**
   * Generate cache key from topic ID and subject hashes
   */
  private getCacheKey(topicId: string, subjectIdHashes: SHA256IdHash<any>[]): string {
    const sortedHashes = [...subjectIdHashes].sort();
    return `${topicId}:${sortedHashes.join(',')}`;
  }

  /**
   * Get cached proposals if available and not expired
   */
  get(topicId: string, subjectIdHashes: SHA256IdHash<any>[]): any[] | null {
    const key = this.getCacheKey(topicId, subjectIdHashes);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (now - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.proposals;
  }

  /**
   * Store proposals in cache
   */
  set(topicId: string, subjectIdHashes: SHA256IdHash<any>[], proposals: any[]): void {
    const key = this.getCacheKey(topicId, subjectIdHashes);

    // Enforce max entries (LRU eviction)
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      // Remove oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      proposals,
      timestamp: Date.now()
    });
  }

  /**
   * Clear all cached proposals
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Invalidate cache for a specific topic
   */
  invalidateTopic(topicId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${topicId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
