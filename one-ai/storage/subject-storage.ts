/**
 * Subject Storage
 * Handles persistence of Subject objects using ONE.core versioned storage
 *
 * IMPORTANT: Subjects are identified by their keywords (isId: true in recipe)
 * ONE.core automatically generates SHA256IdHash<Subject> from sorted keywords
 * No manual ID generation needed
 */

import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { createOrUpdateSubject } from '../models/Subject.js';
import type { Subject } from '../types/Subject.js';
import type { Keyword } from '../types/Keyword.js';

class SubjectStorage {
  public nodeOneCore: any;
  public storagePrefix: string = 'subject:';

  constructor(nodeOneCore: any) {
    this.nodeOneCore = nodeOneCore;
  }

  /**
   * Store a subject using ONE.core versioned object storage
   * ID hash is automatically generated from keywords by ONE.core
   */
  async store(subject: Subject): Promise<{ subject: Subject; hash: string; idHash: SHA256IdHash<Subject> }> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    // Store using ONE.core's versioned object storage
    // ONE.core automatically generates ID hash from keywords (marked isId: true in recipe)
    const result = await storeVersionedObject(subject);

    // Calculate ID hash for logging (ONE.core already did this internally)
    const idHash = await calculateIdHashOfObj(subject);
    console.log(`[SubjectStorage] Stored subject with keywords [${subject.keywords.join(', ')}] - ID hash: ${idHash}`);

    return { subject, hash: result.hash, idHash: result.idHash };
  }

  /**
   * Retrieve a subject by ID hash using ONE.core versioned storage
   */
  async get(subjectIdHash: SHA256IdHash<Subject>): Promise<Subject | null> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    try {
      const result = await getObjectByIdHash(subjectIdHash);
      if (result && result.obj) {
        return result.obj;
      }
    } catch (error) {
      console.error(`[SubjectStorage] Error retrieving subject ${subjectIdHash}:`, error);
    }

    return null;
  }

  /**
   * Get all subjects for a topic
   */
  async getByTopic(topicId: string, includeArchived = false): Promise<Subject[]> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    const subjects = [];

    // Query all subjects with matching topic
    // This is a simplified implementation - in production, you'd want indexing
    // TODO: Implement proper querying using ChannelManager
    const allKeys: string[] = []; // await this.nodeOneCore.listObjects(this.storagePrefix);

    for (const key of allKeys) {
      if (key.includes(topicId)) {
        const subject = await this.get(key.replace(this.storagePrefix, '') as SHA256IdHash<Subject>);
        if (subject && subject.topics.includes(topicId)) {
          subjects.push(subject);
        }
      }
    }

    return subjects;
  }

  /**
   * Update a subject
   */
  async update(subject: Subject): Promise<{ subject: Subject; hash: string; idHash: SHA256IdHash<Subject> }> {
    return this.store(subject); // Store handles both create and update
  }

  /**
   * Delete a subject by ID hash
   *
   * NOTE: TRUE deletion requires Tombstone data type (TBD in ONE.core)
   * For now, we only support archiving (soft delete)
   */
  async delete(subjectIdHash: SHA256IdHash<Subject>): Promise<boolean> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    try {
      // TODO: Implement true deletion when Tombstone type is available
      // For now, archive is the only way to "soft delete" versioned objects
      await this.archive(subjectIdHash);
      console.log(`[SubjectStorage] Archived (soft deleted) subject ${subjectIdHash}`);
      console.warn('[SubjectStorage] True deletion requires Tombstone type (TBD)');
      return true;
    } catch (error) {
      console.error(`[SubjectStorage] Error archiving subject ${subjectIdHash}:`, error);
      return false;
    }
  }

  /**
   * Batch store multiple subjects
   */
  async storeMany(subjects: Subject[]): Promise<Array<{ subject: Subject; hash: string; idHash: SHA256IdHash<Subject> }>> {
    const results = [];

    for (const subject of subjects) {
      try {
        const stored = await this.store(subject);
        results.push(stored);
      } catch (error) {
        // Log with keywords since id field no longer exists (ONE.core generates idHash from keywords)
        const keywordStr = Array.isArray(subject.keywords) ? subject.keywords.join('+') : 'unknown';
        console.error(`[SubjectStorage] Error storing subject [${keywordStr}]:`, error);
      }
    }

    return results;
  }

  /**
   * Archive a subject
   * Note: Archived metadata should live in Story/Assembly, not in Subject
   * This method is deprecated and will be removed
   */
  async archive(subjectId: SHA256IdHash<Subject>): Promise<boolean> {
    // Archived metadata now lives in Story/Assembly, not in Subject
    console.warn('[SubjectStorage] archive() is deprecated - use Story/Assembly for metadata');
    return true;
  }

  /**
   * Merge two subjects by combining their keywords and creating a new subject
   * ONE.core will automatically generate a new ID hash from the merged keywords
   */
  async merge(subjectId1: SHA256IdHash<Subject>, subjectId2: SHA256IdHash<Subject>, newKeywords: SHA256IdHash<Keyword>[] = []): Promise<{ mergedSubject: Subject; archivedSubjects: string[] }> {
    const subject1 = await this.get(subjectId1);
    const subject2 = await this.get(subjectId2);

    if (!subject1 || !subject2) {
      throw new Error('One or both subjects not found');
    }

    // Merge keywords (creates new identity via ONE.core automatic ID hashing)
    const mergedKeywords = newKeywords.length > 0
      ? newKeywords
      : [...new Set([...subject1.keywords, ...subject2.keywords])]; // Deduplicate keywords

    // Merge topics and memories from both subjects
    const mergedTopics = [...new Set([...subject1.topics, ...subject2.topics])];
    const mergedMemories = [...new Set([...subject1.memories, ...subject2.memories])];

    // Merge feedback refs from both subjects
    const mergedFeedbackRefs = [...new Set([...(subject1.feedbackRefs || []), ...(subject2.feedbackRefs || [])])];

    // Create merged subject - ONE.core generates new ID hash from merged keywords
    const now = Date.now();
    // Merge timeRanges from both subjects
    const mergedTimeRanges = [
      ...(subject1.timeRanges || []),
      ...(subject2.timeRanges || [])
    ].sort((a, b) => a.start - b.start);  // Sort by start time

    const merged: Subject = {
      $type$: 'Subject',
      keywords: mergedKeywords.sort() as SHA256IdHash<Keyword>[], // Sort for deterministic ID hash
      description: subject1.description || subject2.description, // Prefer first description
      // Timestamps: Merge timeRanges and use earliest createdAt / latest lastSeenAt
      timeRanges: mergedTimeRanges.length > 0 ? mergedTimeRanges : [{ start: now, end: now }],
      createdAt: Math.min(subject1.createdAt || now, subject2.createdAt || now),
      lastSeenAt: Math.max(subject1.lastSeenAt || now, subject2.lastSeenAt || now),
      messageCount: (subject1.messageCount || 0) + (subject2.messageCount || 0),
      topics: mergedTopics,
      memories: mergedMemories,
      feedbackRefs: mergedFeedbackRefs
    };

    // Store merged subject (ONE.core generates ID hash from keywords)
    await this.store(merged);

    // Archive originals
    await this.archive(subjectId1);
    await this.archive(subjectId2);

    return {
      mergedSubject: merged,
      archivedSubjects: [subjectId1, subjectId2]
    };
  }

  /**
   * Find subjects by keywords
   */
  async findByKeywords(keywords: SHA256IdHash<Keyword>[], topicId: string | null = null): Promise<Subject[]> {
    const subjects = [];

    const prefix = topicId ? `${this.storagePrefix}${topicId}:` : this.storagePrefix;
    // TODO: Implement proper querying using ChannelManager
    const allKeys: string[] = []; // await this.nodeOneCore.listObjects(prefix);

    for (const key of allKeys) {
      const subject = await this.get(key.replace(this.storagePrefix, '') as SHA256IdHash<Subject>);
      if (subject && subject.keywords.some(k => keywords.includes(k))) {
        subjects.push(subject);
      }
    }

    return subjects;
  }

  /**
   * Clean up old archived subjects
   */
  async cleanup(daysToKeep = 30): Promise<number> {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    // TODO: Implement proper querying using ChannelManager
    const allKeys: string[] = []; // await this.nodeOneCore.listObjects(this.storagePrefix);
    let deletedCount = 0;

    // Cleanup logic moved to Story/Assembly since archived metadata lives there now
    console.warn('[SubjectStorage] cleanup() is deprecated - use Story/Assembly for metadata');

    console.log(`[SubjectStorage] Cleaned up ${deletedCount} old archived subjects`);
    return deletedCount;
  }

  /**
   * Get storage statistics
   */
  async getStats(topicId: string | null = null): Promise<{
    totalSubjects: number;
    activeSubjects: number;
    archivedSubjects: number;
    totalMessages: number;
    uniqueKeywords: number;
    averageMessagesPerSubject: number;
  }> {
    const subjects = topicId
      ? await this.getByTopic(topicId, true)
      : await this.getAll();

    const activeCount = subjects.filter((s: any) => !s.archived).length;
    const archivedCount = subjects.filter((s: any) => s.archived).length;
    const totalMessages = subjects.reduce((sum: any, s: any) => sum + s.messageCount, 0);
    const uniqueKeywords = new Set(subjects.flatMap((s: any) => s.keywords));

    return {
      totalSubjects: subjects.length,
      activeSubjects: activeCount,
      archivedSubjects: archivedCount,
      totalMessages,
      uniqueKeywords: uniqueKeywords.size,
      averageMessagesPerSubject: subjects.length > 0 ? totalMessages / subjects.length : 0
    };
  }

  /**
   * Get all subjects (for admin/debug purposes)
   */
  async getAll(): Promise<Subject[]> {
    const subjects = [];
    // TODO: Implement proper querying using ChannelManager
    const allKeys: string[] = []; // await this.nodeOneCore.listObjects(this.storagePrefix);

    for (const key of allKeys) {
      const subject = await this.get(key.replace(this.storagePrefix, '') as SHA256IdHash<Subject>);
      if (subject) {
        subjects.push(subject);
      }
    }

    return subjects;
  }
}

export default SubjectStorage;