/**
 * ProposalEngine - Generates proposals based on subject matching
 *
 * Scans past subjects for keyword matches with current subjects using Jaccard similarity.
 * Calculates recency boost for recent subjects.
 *
 * Reference: /specs/019-above-the-chat/tasks.md T012
 * Reference: /specs/019-above-the-chat/research.md lines 59-72
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';

export interface ProposalConfig {
  matchWeight: number;
  recencyWeight: number;
  recencyWindow: number;
  minJaccard: number;
  maxProposals: number;
}

export interface UnrankedProposal {
  pastSubject: SHA256IdHash<any>;
  jaccardScore: number;
  recencyScore: number;
  matchedKeywords: string[];
  pastSubjectName: string;
  sourceTopicId: string;
  createdAt: number;
}

export class ProposalEngine {
  private topicAnalysisModel: any;

  constructor(topicAnalysisModel: any) {
    this.topicAnalysisModel = topicAnalysisModel;
  }

  /**
   * Calculate Jaccard similarity between two keyword sets
   *
   * Jaccard = |intersection| / |union|
   *
   * @param set1 - First set of keywords
   * @param set2 - Second set of keywords
   * @returns Jaccard similarity score (0.0-1.0)
   */
  private calculateJaccard(set1: string[], set2: string[]): number {
    if (set1.length === 0 && set2.length === 0) {
      return 0;
    }

    const s1 = new Set(set1.map(k => k.toLowerCase()));
    const s2 = new Set(set2.map(k => k.toLowerCase()));

    // Calculate intersection
    const intersection = new Set([...s1].filter(x => s2.has(x)));

    // Calculate union
    const union = new Set([...s1, ...s2]);

    if (union.size === 0) {
      return 0;
    }

    return intersection.size / union.size;
  }

  /**
   * Calculate recency boost for a subject
   *
   * Linear decay: boost = max(0, 1 - (age / recencyWindow))
   *
   * @param createdAt - Subject creation timestamp
   * @param recencyWindow - Time window for recency boost (ms)
   * @returns Recency score (0.0-1.0)
   */
  private calculateRecencyBoost(createdAt: number, recencyWindow: number): number {
    const age = Date.now() - createdAt;

    if (age >= recencyWindow) {
      return 0;
    }

    return Math.max(0, 1 - (age / recencyWindow));
  }

  /**
   * Get proposals for a topic based on current subjects
   *
   * @param topicId - Current topic ID
   * @param currentSubjectIdHashes - ID hashes of current subjects
   * @param config - User's proposal configuration
   * @returns Unranked proposals (ranking happens in ProposalRanker)
   */
  async getProposalsForTopic(
    topicId: string,
    currentSubjectIdHashes: SHA256IdHash<any>[],
    config: ProposalConfig
  ): Promise<UnrankedProposal[]> {
    console.log('[ProposalEngine] Getting proposals for topic:', topicId);
    console.log('[ProposalEngine] Current subjects:', currentSubjectIdHashes.length);

    if (!this.topicAnalysisModel) {
      console.log('[ProposalEngine] TopicAnalysisModel not initialized');
      return [];
    }

    if (currentSubjectIdHashes.length === 0) {
      console.log('[ProposalEngine] No current subjects');
      return [];
    }

    // Get current subject keywords
    const currentKeywords: string[] = [];
    for (const subjectIdHash of currentSubjectIdHashes) {
      try {
        const result = await getObjectByIdHash(subjectIdHash);
        if (result?.obj) {
          const subject = result.obj as any;
          if (subject.keywords && Array.isArray(subject.keywords)) {
            // Keywords are ID hashes - need to resolve them
            for (const keywordIdHash of subject.keywords) {
              try {
                const keywordResult = await getObjectByIdHash(keywordIdHash);
                if (keywordResult?.obj) {
                  const keyword = keywordResult.obj as any;
                  if (keyword.term) {
                    currentKeywords.push(keyword.term);
                  }
                }
              } catch (err) {
                console.warn('[ProposalEngine] Failed to resolve keyword:', keywordIdHash);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[ProposalEngine] Failed to load subject:', subjectIdHash);
      }
    }

    console.log('[ProposalEngine] Current keywords:', currentKeywords);

    if (currentKeywords.length === 0) {
      console.log('[ProposalEngine] No keywords in current subjects');
      return [];
    }

    // Get all past subjects from all topics (excluding current topic)
    const allTopics = await this.topicAnalysisModel.getAllTopics();
    console.log('[ProposalEngine] Found', allTopics?.length || 0, 'total topics');

    const proposals: UnrankedProposal[] = [];

    for (const pastTopicId of allTopics || []) {
      // Skip current topic
      if (pastTopicId === topicId) {
        continue;
      }

      try {
        const pastSubjects = await this.topicAnalysisModel.getSubjects(pastTopicId);

        for (const pastSubject of pastSubjects || []) {
          // Get past subject keywords
          const pastKeywords: string[] = [];
          if (pastSubject.keywords && Array.isArray(pastSubject.keywords)) {
            for (const keywordIdHash of pastSubject.keywords) {
              try {
                const keywordResult = await getObjectByIdHash(keywordIdHash);
                if (keywordResult?.obj) {
                  const keyword = keywordResult.obj as any;
                  if (keyword.term) {
                    pastKeywords.push(keyword.term);
                  }
                }
              } catch (err) {
                // Ignore keyword resolution errors
              }
            }
          }

          if (pastKeywords.length === 0) {
            continue;
          }

          // Calculate Jaccard similarity
          const jaccardScore = this.calculateJaccard(currentKeywords, pastKeywords);

          // Skip if below threshold
          if (jaccardScore < config.minJaccard) {
            continue;
          }

          // Calculate matched keywords
          const currentSet = new Set(currentKeywords.map(k => k.toLowerCase()));
          const pastSet = new Set(pastKeywords.map(k => k.toLowerCase()));
          const matchedKeywords = [...currentSet].filter(k => pastSet.has(k));

          // Calculate recency boost
          const createdAt = pastSubject.created || pastSubject.createdAt || Date.now();
          const recencyScore = this.calculateRecencyBoost(createdAt, config.recencyWindow);

          // Create proposal
          proposals.push({
            pastSubject: pastSubject.idHash || pastSubject.id,
            jaccardScore,
            recencyScore,
            matchedKeywords,
            pastSubjectName: pastSubject.name || pastSubject.id || 'Unknown Subject',
            sourceTopicId: pastTopicId,
            createdAt
          });
        }
      } catch (err) {
        console.warn('[ProposalEngine] Failed to process topic:', pastTopicId, err);
      }
    }

    console.log('[ProposalEngine] Generated', proposals.length, 'proposals');

    return proposals;
  }
}
