/**
 * Summary Storage
 *
 * Handles persistence of Summary objects using ONE.core versioned storage.
 * Summary identity is (subject + topic) - one per Subject per Topic.
 * Storage is unversioned (replacement semantics) - always reads/writes latest.
 */

import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';

import Summary, { type SummaryData } from '../models/Summary.js';

class SummaryStorage {
  public nodeOneCore: any;

  constructor(nodeOneCore: any) {
    this.nodeOneCore = nodeOneCore;
  }

  /**
   * Store or replace a Summary using ONE.core versioned storage.
   * Since Summary identity is (subject + topic), storing with same identity replaces.
   */
  async store(summary: Summary): Promise<{ hash: string; idHash: string }> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    const objectData = summary.toObject();

    // Store using ONE.core versioned storage
    // ONE.core handles versioning automatically - same identity = new version
    const result = await storeVersionedObject(objectData);

    console.log(`[SummaryStorage] Stored summary for subject ${summary.subject} in topic ${summary.topic}`);

    return {
      hash: result.hash,
      idHash: result.idHash
    };
  }

  /**
   * Get Summary for a (subject, topic) pair.
   * Returns the latest version (replacement semantics).
   */
  async get(subjectIdHash: string, topicIdHash: string): Promise<Summary | null> {
    if (!this.nodeOneCore?.initialized) {
      throw new Error('ONE.core not initialized');
    }

    try {
      // Create a temporary Summary to get the idHash
      const tempSummary = new Summary({
        subject: subjectIdHash,
        topic: topicIdHash,
        prose: ''
      });

      // Store it briefly to get the idHash, then retrieve
      // Note: This is a workaround - in production we'd have a better lookup mechanism
      const result = await storeVersionedObject(tempSummary.toObject());
      const retrieved = await getObjectByIdHash(result.idHash);

      if (retrieved && retrieved.obj) {
        return Summary.fromObject(retrieved.obj as SummaryData);
      }
    } catch (error) {
      console.error(`[SummaryStorage] Error retrieving summary for subject ${subjectIdHash}:`, error);
    }

    return null;
  }

  /**
   * Create or update a Summary for a (subject, topic) pair.
   * This is the main entry point for the subject switch flow.
   */
  async createOrUpdate(
    subjectIdHash: string,
    topicIdHash: string,
    prose: string
  ): Promise<Summary> {
    const summary = new Summary({
      subject: subjectIdHash,
      topic: topicIdHash,
      prose
    });

    await this.store(summary);
    return summary;
  }

  /**
   * Check if a Summary exists for a (subject, topic) pair.
   */
  async exists(subjectIdHash: string, topicIdHash: string): Promise<boolean> {
    const summary = await this.get(subjectIdHash, topicIdHash);
    return summary !== null && summary.hasContent();
  }
}

export default SummaryStorage;
