/**
 * Subject Storage
 * Handles persistence of Subject objects using ONE.core versioned storage
 */

import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';

import { createSubject } from '../models/Subject.js';

class SubjectStorage {
  public nodeOneCore: any;
  public storagePrefix: string = 'subject:';

  constructor(nodeOneCore: any) {
    this.nodeOneCore = nodeOneCore;
  }

  /**
   * Store a subject using ONE.core versioned object storage
   */
  async store(subject: any): Promise<any> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    const objectData = subject.toObject();

    // Store using ONE.core's versioned object storage
    // This will work with the SubjectRecipe we defined
    const result = await storeVersionedObject(objectData);

    console.log(`[SubjectStorage] Stored subject ${subject.id} with hash ${result.hash}`);
    return { subject, hash: result.hash, idHash: result.idHash };
  }

  /**
   * Retrieve a subject by ID hash using ONE.core versioned storage
   */
  async get(subjectIdHash: any): Promise<any> {
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
  async getByTopic(topicId: any, includeArchived = false): Promise<unknown> {
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
        const subject = await this.get(key.replace(this.storagePrefix, ''));
        if (subject && subject.topic === topicId) {
          if (includeArchived || !subject.archived) {
            subjects.push(subject);
          }
        }
      }
    }

    return subjects.sort((a, b) => b.messageCount - a.messageCount);
  }

  /**
   * Update a subject
   */
  async update(subject: any): Promise<any> {
    return this.store(subject); // Store handles both create and update
  }

  /**
   * Delete a subject
   */
  async delete(subjectId: any): Promise<any> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    const storageKey = this.storagePrefix + subjectId;

    try {
      await this.nodeOneCore.deleteObject(storageKey);
      console.log(`[SubjectStorage] Deleted subject ${subjectId}`);
      return true;
    } catch (error) {
      console.error(`[SubjectStorage] Error deleting subject ${subjectId}:`, error);
      return false;
    }
  }

  /**
   * Batch store multiple subjects
   */
  async storeMany(subjects: any): Promise<any> {
    const results = [];

    for (const subject of subjects) {
      try {
        const stored = await this.store(subject);
        results.push(stored);
      } catch (error) {
        console.error(`[SubjectStorage] Error storing subject ${subject.id}:`, error);
      }
    }

    return results;
  }

  /**
   * Archive a subject
   */
  async archive(subjectId: any): Promise<any> {
    const subject = await this.get(subjectId);
    if (subject) {
      subject.archive();
      await this.update(subject);
      return true;
    }
    return false;
  }

  /**
   * Merge two subjects
   */
  async merge(subjectId1: any, subjectId2: any, newKeywords = []): Promise<unknown> {
    const subject1 = await this.get(subjectId1);
    const subject2 = await this.get(subjectId2);

    if (!subject1 || !subject2) {
      throw new Error('One or both subjects not found');
    }

    if (subject1.topic !== subject2.topic) {
      throw new Error('Cannot merge subjects from different topics');
    }

    // Create merged subject
    const merged = subject1.merge(subject2);
    if (newKeywords.length > 0) {
      merged.keywords = newKeywords.sort();
      merged.id = merged.generateId(merged.topic, newKeywords);
    }

    // Store merged subject
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
  async findByKeywords(keywords: any, topicId = null): Promise<unknown> {
    const normalizedKeywords: any[] = keywords.map((k: any) => k.toLowerCase());
    const subjects = [];

    const prefix = topicId ? `${this.storagePrefix}${topicId}:` : this.storagePrefix;
    // TODO: Implement proper querying using ChannelManager
    const allKeys: string[] = []; // await this.nodeOneCore.listObjects(prefix);

    for (const key of allKeys) {
      const subject = await this.get(key.replace(this.storagePrefix, ''));
      if (subject && subject.matchesKeywords(normalizedKeywords)) {
        subjects.push(subject);
      }
    }

    return subjects;
  }

  /**
   * Clean up old archived subjects
   */
  async cleanup(daysToKeep = 30): Promise<unknown> {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    // TODO: Implement proper querying using ChannelManager
    const allKeys: string[] = []; // await this.nodeOneCore.listObjects(this.storagePrefix);
    let deletedCount = 0;

    for (const key of allKeys) {
      const subject = await this.get(key.replace(this.storagePrefix, ''));
      if (subject && subject.archived && subject.timestamp < cutoffTime) {
        await this.delete(subject.id);
        deletedCount++;
      }
    }

    console.log(`[SubjectStorage] Cleaned up ${deletedCount} old archived subjects`);
    return deletedCount;
  }

  /**
   * Get storage statistics
   */
  async getStats(topicId = null): Promise<unknown> {
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
  async getAll(): Promise<any> {
    const subjects = [];
    // TODO: Implement proper querying using ChannelManager
    const allKeys: string[] = []; // await this.nodeOneCore.listObjects(this.storagePrefix);

    for (const key of allKeys) {
      const subject = await this.get(key.replace(this.storagePrefix, ''));
      if (subject) {
        subjects.push(subject);
      }
    }

    return subjects;
  }
}

export default SubjectStorage;