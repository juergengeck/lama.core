/**
 * Keyword Storage
 * Handles persistence and indexing of Keyword objects using ONE.core versioned storage
 */

import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { createKeyword, normalizeKeywordTerm, getWeight } from '../models/Keyword.js';

class KeywordStorage {
  public nodeOneCore: any;


  constructor(nodeOneCore: any) {
    this.nodeOneCore = nodeOneCore;
  }

  /**
   * Store a keyword using ONE.core versioned storage
   */
  async store(keyword: any): Promise<any> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    // Store using ONE.core versioned storage
    const result = await storeVersionedObject(keyword);

    console.log(`[KeywordStorage] Stored keyword "${keyword.term}" with hash ${result.hash}`);
    return { keyword, hash: result.hash, idHash: result.idHash };
  }

  /**
   * Retrieve a keyword by ID hash using ONE.core versioned storage
   */
  async get(keywordIdHash: any): Promise<any> {
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
  async findByText(text: any): Promise<any> {
    const normalized = normalizeKeywordTerm(text);

    // Query using ChannelManager or iterate through stored keywords
    // For now, return null as we need to implement proper querying
    console.log(`[KeywordStorage] Finding keyword by text: ${normalized}`);
    return null;
  }

  /**
   * Get or create keyword
   */
  async getOrCreate(text: any): Promise<any> {
    let keyword = await this.findByText(text);

    if (!keyword) {
      keyword = await createKeyword(text);
      await this.store(keyword);
    }

    return keyword;
  }

  /**
   * Update keyword frequency
   */
  async incrementFrequency(text: any): Promise<any> {
    const keyword = await this.getOrCreate(text);
    keyword.frequency++;
    keyword.lastSeen = Date.now();
    await this.store(keyword);
    return keyword;
  }

  /**
   * Get keywords for subjects
   */
  async getForSubjects(subjectIds: any): Promise<any> {
    // This needs to be implemented with proper ONE.core querying
    // For now, return empty array
    console.log(`[KeywordStorage] Getting keywords for subjects:`, subjectIds);
    return [];
  }

  /**
   * Get top keywords by frequency
   */
  async getTopKeywords(limit = 20, minFrequency = 2): Promise<unknown> {
    // This needs to be implemented with proper ONE.core querying
    // For now, return empty array
    console.log(`[KeywordStorage] Getting top keywords: limit=${limit}, minFrequency=${minFrequency}`);
    return [];
  }

  /**
   * Search keywords by partial match
   */
  async search(query: string, limit = 10): Promise<unknown> {
    const normalized = query.toLowerCase();
    // This needs to be implemented with proper ONE.core querying
    // For now, return empty array
    console.log(`[KeywordStorage] Searching keywords: ${normalized}, limit=${limit}`);
    return [];
  }

  /**
   * Merge two keywords
   */
  async merge(keyword1IdHash: any, keyword2IdHash: any): Promise<any> {
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
  async delete(keywordIdHash: any): Promise<any> {
    const keyword = await this.get(keywordIdHash);
    if (keyword) {
      keyword.deleted = true;
      await this.store(keyword);
      console.log(`[KeywordStorage] Marked keyword as deleted: ${keywordIdHash}`);
    }
  }
}

export default KeywordStorage;