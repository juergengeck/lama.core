/**
 * Keyword Storage
 * Handles persistence and indexing of Keyword objects using ONE.core versioned storage
 */

import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { createKeyword, normalizeKeywordTerm, getWeight } from '../models/Keyword.js';
import type { Keyword } from '../types/Keyword.js';
import type { Subject } from '../types/Subject.js';

class KeywordStorage {
  public nodeOneCore: any;


  constructor(nodeOneCore: any) {
    this.nodeOneCore = nodeOneCore;
  }

  /**
   * Store a keyword using ONE.core versioned storage
   */
  async store(keyword: Keyword): Promise<{ keyword: Keyword; hash: string; idHash: SHA256IdHash<Keyword> }> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    // Store using ONE.core versioned storage
    const result = await storeVersionedObject(keyword);

    console.log(`[KeywordStorage] Stored keyword "${keyword.term}" with hash ${result.hash}`);
    return { keyword, hash: result.hash, idHash: result.idHash as SHA256IdHash<Keyword> };
  }

  /**
   * Retrieve a keyword by ID hash using ONE.core versioned storage
   */
  async get(keywordIdHash: SHA256IdHash<Keyword>): Promise<Keyword | null> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    try {
      const result = await getObjectByIdHash(keywordIdHash);
      if (result && result.obj) {
        return result.obj;
      }
    } catch (error) {
      console.error(`[KeywordStorage] Error retrieving keyword ${keywordIdHash}:`, error);
    }

    return null;
  }

  /**
   * Find keyword by text
   */
  async findByText(text: string): Promise<Keyword | null> {
    const normalized = normalizeKeywordTerm(text);

    // Query using ChannelManager or iterate through stored keywords
    // For now, return null as we need to implement proper querying
    console.log(`[KeywordStorage] Finding keyword by text: ${normalized}`);
    return null;
  }

  /**
   * Get or create keyword
   */
  async getOrCreate(text: string): Promise<Keyword> {
    let keyword = await this.findByText(text);

    if (!keyword) {
      const result = await createKeyword(text);
      keyword = result.obj as Keyword;
      await this.store(keyword);
    }

    return keyword;
  }

  /**
   * Update keyword frequency
   */
  async incrementFrequency(text: string): Promise<Keyword> {
    const keyword = await this.getOrCreate(text);
    keyword.frequency++;
    keyword.lastSeen = Date.now();
    await this.store(keyword);
    return keyword;
  }

  /**
   * Get keywords for subjects
   */
  async getForSubjects(subjectIds: SHA256IdHash<Subject>[]): Promise<Keyword[]> {
    // This needs to be implemented with proper ONE.core querying
    // For now, return empty array
    console.log(`[KeywordStorage] Getting keywords for subjects:`, subjectIds);
    return [];
  }

  /**
   * Get top keywords by frequency
   */
  async getTopKeywords(limit = 20, minFrequency = 2): Promise<Keyword[]> {
    // This needs to be implemented with proper ONE.core querying
    // For now, return empty array
    console.log(`[KeywordStorage] Getting top keywords: limit=${limit}, minFrequency=${minFrequency}`);
    return [];
  }

  /**
   * Search keywords by partial match
   */
  async search(query: string, limit = 10): Promise<Keyword[]> {
    const normalized = query.toLowerCase();
    // This needs to be implemented with proper ONE.core querying
    // For now, return empty array
    console.log(`[KeywordStorage] Searching keywords: ${normalized}, limit=${limit}`);
    return [];
  }

  /**
   * Merge two keywords
   */
  async merge(keyword1IdHash: SHA256IdHash<Keyword>, keyword2IdHash: SHA256IdHash<Keyword>): Promise<Keyword> {
    const kw1 = await this.get(keyword1IdHash);
    const kw2 = await this.get(keyword2IdHash);

    if (!kw1 || !kw2) {
      throw new Error('One or both keywords not found');
    }

    // Combine frequencies
    kw1.frequency += kw2.frequency;

    // Combine subjects (deduplicate)
    const combinedSubjects = new Set([...kw1.subjects, ...kw2.subjects]);
    kw1.subjects = Array.from(combinedSubjects);

    // Average scores
    kw1.score = (kw1.score + kw2.score) / 2;

    // Use most recent last seen
    kw1.lastSeen = Math.max(kw1.lastSeen, kw2.lastSeen);

    // Store updated keyword
    await this.store(kw1);

    console.log(`[KeywordStorage] Merged keywords: "${kw1.term}" and "${kw2.term}"`);
    return kw1;
  }

  /**
   * Delete keyword (by marking as deleted)
   */
  async delete(keywordIdHash: SHA256IdHash<Keyword>): Promise<void> {
    const keyword = await this.get(keywordIdHash);
    if (keyword) {
      // Mark as deleted by setting frequency to 0 (Keyword interface doesn't have deleted property)
      const deletedKeyword: Keyword = { ...keyword, frequency: 0 };
      await this.store(deletedKeyword);
      console.log(`[KeywordStorage] Marked keyword as deleted: ${keywordIdHash}`);
    }
  }
}

export default KeywordStorage;