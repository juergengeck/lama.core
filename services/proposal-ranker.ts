/**
 * ProposalRanker - Ranks proposals by relevance
 *
 * Calculates relevance scores using weighted combination of:
 * - Jaccard similarity (keyword match strength)
 * - Recency boost (prefer recent subjects)
 *
 * Reference: /specs/019-above-the-chat/tasks.md T013
 * Reference: /specs/019-above-the-chat/research.md lines 60-72
 */

export interface ProposalConfig {
  matchWeight: number;
  recencyWeight: number;
  recencyWindow: number;
  minJaccard: number;
  maxProposals: number;
}

export interface UnrankedProposal {
  pastSubject: any;
  jaccardScore: number;
  recencyScore: number;
  matchedKeywords: string[];
  pastSubjectName: string;
  sourceTopicId: string;
  createdAt: number;
}

export interface RankedProposal extends UnrankedProposal {
  relevanceScore: number;
}

export class ProposalRanker {
  /**
   * Rank proposals by relevance score
   *
   * relevanceScore = jaccardScore * matchWeight + recencyScore * recencyWeight
   *
   * @param proposals - Unranked proposals from ProposalEngine
   * @param config - User's proposal configuration
   * @returns Proposals sorted by relevanceScore descending, limited to maxProposals
   */
  rankProposals(proposals: UnrankedProposal[], config: ProposalConfig): RankedProposal[] {
    console.log('[ProposalRanker] Ranking', proposals.length, 'proposals');

    // Calculate relevance scores
    const ranked: RankedProposal[] = proposals.map(proposal => {
      const relevanceScore =
        (proposal.jaccardScore * config.matchWeight) +
        (proposal.recencyScore * config.recencyWeight);

      return {
        ...proposal,
        relevanceScore
      };
    });

    // Sort by relevance score descending
    ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Limit to maxProposals
    const limited = ranked.slice(0, config.maxProposals);

    console.log('[ProposalRanker] Top ranked:', {
      count: limited.length,
      topScore: limited[0]?.relevanceScore,
      lowestScore: limited[limited.length - 1]?.relevanceScore
    });

    return limited;
  }
}
