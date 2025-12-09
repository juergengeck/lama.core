/**
 * SemanticProposalEngine - Embedding-based proposal matching
 *
 * Uses MeaningDimension from meaning.core for semantic similarity.
 * Scoring: embedding similarity + small Jaccard boost for exact matches.
 *
 * Reference: Replaces Jaccard-only approach in proposal-engine.ts
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type { MeaningDimension, MeaningQueryResult } from '@cube/meaning.core';
import type { ProposalConfig, UnrankedProposal } from './proposal-engine.js';

export interface SemanticProposalConfig extends ProposalConfig {
  /** Boost factor for exact keyword matches (default: 0.1) */
  jaccardBoost?: number;
  /** Minimum embedding similarity threshold (default: 0.5) */
  minSimilarity?: number;
}

export class SemanticProposalEngine {
  private meaningDimension: MeaningDimension;

  constructor(meaningDimension: MeaningDimension) {
    this.meaningDimension = meaningDimension;
  }

  /**
   * Calculate Jaccard similarity between two keyword sets
   */
  private calculateJaccard(set1: string[], set2: string[]): number {
    if (set1.length === 0 && set2.length === 0) return 0;

    const s1 = new Set(set1.map(k => k.toLowerCase()));
    const s2 = new Set(set2.map(k => k.toLowerCase()));
    const intersection = new Set([...s1].filter(x => s2.has(x)));
    const union = new Set([...s1, ...s2]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Get current subject keywords
   */
  private async getSubjectKeywords(subjectIdHash: SHA256IdHash<any>): Promise<string[]> {
    const keywords: string[] = [];
    try {
      const result = await getObjectByIdHash(subjectIdHash);
      if (result?.obj) {
        const subject = result.obj as any;
        if (subject.keywords && Array.isArray(subject.keywords)) {
          for (const keywordIdHash of subject.keywords) {
            try {
              const keywordResult = await getObjectByIdHash(keywordIdHash);
              if (keywordResult?.obj?.term) {
                keywords.push(keywordResult.obj.term);
              }
            } catch (err) {
              // Skip failed keyword resolution
            }
          }
        }
      }
    } catch (err) {
      console.warn('[SemanticProposalEngine] Failed to load subject:', subjectIdHash);
    }
    return keywords;
  }

  /**
   * Get subject description for embedding
   */
  private async getSubjectDescription(subjectIdHash: SHA256IdHash<any>): Promise<string | null> {
    try {
      const result = await getObjectByIdHash(subjectIdHash);
      if (result?.obj) {
        return (result.obj as any).description || null;
      }
    } catch (err) {
      console.warn('[SemanticProposalEngine] Failed to load subject description:', subjectIdHash);
    }
    return null;
  }

  /**
   * Get proposals using semantic similarity
   */
  async getProposalsForTopic(
    topicId: string,
    currentSubjectIdHashes: SHA256IdHash<any>[],
    config: SemanticProposalConfig
  ): Promise<UnrankedProposal[]> {
    console.log('[SemanticProposalEngine] Getting semantic proposals for topic:', topicId);

    if (!this.meaningDimension || currentSubjectIdHashes.length === 0) {
      return [];
    }

    const jaccardBoost = config.jaccardBoost ?? 0.1;
    const minSimilarity = config.minSimilarity ?? 0.5;

    // Get current subject descriptions and keywords
    const currentDescriptions: string[] = [];
    const currentKeywords: string[] = [];

    for (const subjectIdHash of currentSubjectIdHashes) {
      const desc = await this.getSubjectDescription(subjectIdHash);
      if (desc) currentDescriptions.push(desc);

      const keywords = await this.getSubjectKeywords(subjectIdHash);
      currentKeywords.push(...keywords);
    }

    if (currentDescriptions.length === 0) {
      console.log('[SemanticProposalEngine] No descriptions found in current subjects');
      return [];
    }

    // Query semantically similar subjects using MeaningDimension
    const queryText = currentDescriptions.join(' ');

    let semanticResults: MeaningQueryResult[] = [];
    try {
      semanticResults = await this.meaningDimension.queryByText(
        queryText,
        config.maxProposals * 2, // Get more to filter
        minSimilarity
      );
    } catch (err) {
      console.error('[SemanticProposalEngine] Semantic query failed:', err);
      return [];
    }

    console.log('[SemanticProposalEngine] Found', semanticResults.length, 'semantic matches');

    // Build proposals from semantic results
    const proposals: UnrankedProposal[] = [];
    const seenSubjects = new Set(currentSubjectIdHashes.map(h => String(h)));

    for (const result of semanticResults) {
      // MeaningDimension returns SHA256Hash, but Subjects are indexed by their IdHash
      // The objectHash here IS the IdHash when subjects are indexed
      const subjectIdHash = result.objectHash as unknown as SHA256IdHash<any>;
      const objectHashStr = String(result.objectHash);

      // Skip current subjects
      if (seenSubjects.has(objectHashStr)) continue;

      try {
        const subjectResult = await getObjectByIdHash(subjectIdHash);
        if (!subjectResult?.obj) continue;

        const pastSubject = subjectResult.obj as any;
        const pastKeywords = await this.getSubjectKeywords(subjectIdHash);

        // Calculate Jaccard boost
        const jaccardScore = this.calculateJaccard(currentKeywords, pastKeywords);

        // Calculate matched keywords
        const currentSet = new Set(currentKeywords.map(k => k.toLowerCase()));
        const pastSet = new Set(pastKeywords.map(k => k.toLowerCase()));
        const matchedKeywords = [...currentSet].filter(k => pastSet.has(k));

        // Combined score: embedding similarity + jaccard boost
        const combinedScore = result.similarity + (jaccardScore * jaccardBoost);

        // Get source topic from subject
        const sourceTopicId = pastSubject.topics?.[0] || 'unknown';

        // Skip if from current topic
        if (sourceTopicId === topicId) continue;

        proposals.push({
          pastSubject: subjectIdHash,
          jaccardScore: combinedScore,
          recencyScore: 0,
          matchedKeywords,
          pastSubjectName: pastSubject.description || pastSubject.id || 'Unknown Subject',
          sourceTopicId,
          createdAt: pastSubject.createdAt || Date.now()
        });

        seenSubjects.add(objectHashStr);
      } catch (err) {
        console.warn('[SemanticProposalEngine] Failed to process result:', result.objectHash);
      }
    }

    console.log('[SemanticProposalEngine] Generated', proposals.length, 'proposals');
    return proposals;
  }
}
