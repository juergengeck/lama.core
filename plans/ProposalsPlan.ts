/**
 * Proposals Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for context-aware knowledge sharing (Feature 019).
 * Generates proposals based on subject/keyword matching using Jaccard similarity.
 * Can be used from both Electron IPC and Web Worker contexts.
 *
 * Implements Phase 2 (Handler Layer) for spec 019-above-the-chat
 */

import {
  storeVersionedObject,
  getObjectByIdHash,
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Subject } from '../one-ai/types/Subject.js';
import type { Keyword } from '../one-ai/types/Keyword.js';
import {
  createProposalInteractionPlan,
  createProposalInteractionResponse,
  isProposalDismissed,
} from './ProposalInteractions.js';

// Re-export types for consumers
export interface Proposal {
  pastSubject: SHA256IdHash<Subject>;
  currentSubject?: SHA256IdHash<Subject>;
  matchedKeywords: string[];
  relevanceScore: number;
  sourceTopicId: string;
  pastSubjectName: string;
  createdAt: number;
}

export interface ProposalConfig {
  userEmail: string;
  matchWeight: number;
  recencyWeight: number;
  recencyWindow: number;
  minJaccard: number;
  maxProposals: number;
  updatedAt: number;
}

// Request/Response interfaces
export interface GetForTopicRequest {
  topicId: string;
  currentSubjects?: SHA256IdHash<Subject>[];
  forceRefresh?: boolean;
}

export interface GetForTopicResponse {
  proposals: Proposal[];
  count: number;
  cached: boolean;
  computeTimeMs: number;
}

export interface UpdateConfigRequest {
  config: Partial<ProposalConfig>;
}

export interface UpdateConfigResponse {
  success: boolean;
  config: ProposalConfig;
  versionHash?: string;
}

export interface GetConfigRequest {}

export interface GetConfigResponse {
  config: ProposalConfig;
  isDefault: boolean;
}

export interface DismissRequest {
  proposalId: string;
  topicId: string;
  pastSubjectIdHash: string;
}

export interface DismissResponse {
  success: boolean;
  remainingCount: number;
}

export interface ShareRequest {
  proposalId: string;
  topicId: string;
  pastSubjectIdHash: SHA256IdHash<Subject>;
  includeMessages?: boolean;
}

export interface ShareResponse {
  success: boolean;
  sharedContent: {
    subjectName: string;
    description?: string; // Human-readable description of the subject
    keywords: string[];
    messages?: any[];
  };
}

// Default configuration
const DEFAULT_CONFIG: ProposalConfig = {
  userEmail: '',
  matchWeight: 0.7,
  recencyWeight: 0.3,
  recencyWindow: 30 * 24 * 60 * 60 * 1000, // 30 days
  minJaccard: 0.1, // 10% match - lowered from 0.2 to catch more proposals with short input
  maxProposals: 10,
  updatedAt: Date.now(),
};

/**
 * ProposalsPlan - Pure business logic for context-aware knowledge sharing
 *
 * Dependencies are injected via constructor to support both platforms:
 * - nodeOneCore: Platform-specific ONE.core instance
 * - topicAnalysisModel: Topic analysis model instance
 * - proposalEngine: Proposal generation engine
 * - proposalRanker: Proposal ranking service
 * - proposalCache: LRU cache for proposals
 */
export class ProposalsPlan {
  private nodeOneCore: any;
  private topicAnalysisModel: any;
  private proposalEngine: any;
  private proposalRanker: any;
  private proposalCache: any;
  private dismissedProposals: Set<string>;

  constructor(
    nodeOneCore: any,
    topicAnalysisModel: any,
    proposalEngine: any,
    proposalRanker: any,
    proposalCache: any
  ) {
    this.nodeOneCore = nodeOneCore;
    this.topicAnalysisModel = topicAnalysisModel;
    this.proposalEngine = proposalEngine;
    this.proposalRanker = proposalRanker;
    this.proposalCache = proposalCache;
    this.dismissedProposals = new Set();
  }

  /**
   * Get proposals for a specific topic based on subject matching
   */
  async getForTopic(request: GetForTopicRequest): Promise<GetForTopicResponse> {
    const startTime = Date.now();

    try {
      if (!request.topicId) {
        throw new Error('TOPIC_NOT_FOUND: topicId is required');
      }

      // Get current subjects if not provided
      let subjectIdHashes = request.currentSubjects;
      if (!subjectIdHashes || subjectIdHashes.length === 0) {
        if (!this.topicAnalysisModel) {
          return {
            proposals: [],
            count: 0,
            cached: false,
            computeTimeMs: Date.now() - startTime,
          };
        }

        try {
          const subjects = await this.topicAnalysisModel.getSubjects(request.topicId);

          if (!subjects || subjects.length === 0) {
            return {
              proposals: [],
              count: 0,
              cached: false,
              computeTimeMs: Date.now() - startTime,
            };
          }

          // Calculate ID hashes for all subjects
          subjectIdHashes = await Promise.all(
            subjects.map((subject) => calculateIdHashOfObj(subject as any))
          );
          console.log('[ProposalsPlan] Calculated ID hashes for', subjectIdHashes.length, 'subjects');
        } catch (error: any) {
          console.error('[ProposalsPlan] Error querying subjects:', error);
          return {
            proposals: [],
            count: 0,
            cached: false,
            computeTimeMs: Date.now() - startTime,
          };
        }
      } else {
        console.log('[ProposalsPlan] Using provided subjects:', subjectIdHashes.length);
      }

      // Check cache first (unless forceRefresh)
      if (!request.forceRefresh) {
        const cached = this.proposalCache.get(request.topicId, subjectIdHashes);
        if (cached) {
          // Filter against dismissed proposals
          const filtered = cached.filter(
            (p: Proposal) => !this.dismissedProposals.has(`${request.topicId}:${p.pastSubject}`)
          );
          return {
            proposals: filtered,
            count: filtered.length,
            cached: true,
            computeTimeMs: Date.now() - startTime,
          };
        }
      }

      // Get current user config
      const config = await this.getCurrentConfig();
      console.log('[ProposalsPlan] Using config:', {
        minJaccard: config.minJaccard,
        matchWeight: config.matchWeight,
        maxProposals: config.maxProposals
      });

      // Generate proposals using engine
      console.log('[ProposalsPlan] Calling getProposalsForTopic...');
      const proposals = await this.proposalEngine.getProposalsForTopic(
        request.topicId,
        subjectIdHashes,
        config
      );
      console.log('[ProposalsPlan] ProposalEngine returned', proposals.length, 'proposals');

      // Rank proposals
      console.log('[ProposalsPlan] Ranking proposals...');
      const rankedProposals = this.proposalRanker.rankProposals(proposals, config);
      console.log('[ProposalsPlan] Ranked proposals:', rankedProposals.length);

      // Filter against dismissed proposals (both in-memory and stored in ONE.core)
      const userEmail = this.nodeOneCore.email || 'user@example.com';
      const filtered: Proposal[] = [];

      for (const proposal of rankedProposals) {
        // Check in-memory set first (fast)
        if (this.dismissedProposals.has(`${request.topicId}:${proposal.pastSubject}`)) {
          continue;
        }

        // Check stored dismissals/shares in ONE.core (persistent across sessions)
        const isDismissed = await isProposalDismissed(userEmail, proposal.pastSubject as any);
        if (isDismissed) {
          // Add to in-memory set for faster future checks
          this.dismissedProposals.add(`${request.topicId}:${proposal.pastSubject}`);
          continue;
        }

        filtered.push(proposal);
      }

      console.log('[ProposalsPlan] Filtered proposals (after dismissals):', filtered.length);

      // Cache results
      this.proposalCache.set(request.topicId, subjectIdHashes, filtered);

      console.log('[ProposalsPlan] ✅ Returning', filtered.length, 'proposals in', Date.now() - startTime, 'ms');
      return {
        proposals: filtered,
        count: filtered.length,
        cached: false,
        computeTimeMs: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error('[ProposalsPlan] ❌ Error in getForTopic:', error);
      console.error('[ProposalsPlan] Error stack:', error.stack);
      throw new Error(`COMPUTATION_ERROR: ${error.message}`);
    }
  }

  /**
   * Update user's proposal configuration
   */
  async updateConfig(request: UpdateConfigRequest): Promise<UpdateConfigResponse> {
    try {
      // Validate config parameters
      if (request.config.matchWeight !== undefined) {
        if (request.config.matchWeight < 0 || request.config.matchWeight > 1) {
          throw new Error('INVALID_CONFIG: matchWeight must be between 0.0 and 1.0');
        }
      }

      if (request.config.recencyWeight !== undefined) {
        if (request.config.recencyWeight < 0 || request.config.recencyWeight > 1) {
          throw new Error('INVALID_CONFIG: recencyWeight must be between 0.0 and 1.0');
        }
      }

      if (request.config.maxProposals !== undefined) {
        if (request.config.maxProposals < 1 || request.config.maxProposals > 50) {
          throw new Error('INVALID_CONFIG: maxProposals must be between 1 and 50');
        }
      }

      if (request.config.minJaccard !== undefined) {
        if (request.config.minJaccard < 0 || request.config.minJaccard > 1) {
          throw new Error('INVALID_CONFIG: minJaccard must be between 0.0 and 1.0');
        }
      }

      // Get current config or use defaults
      const currentConfig = await this.getCurrentConfig();

      // Merge with new config
      const updatedConfig: ProposalConfig = {
        ...currentConfig,
        ...request.config,
        updatedAt: Date.now(),
      };

      console.log('[ProposalsPlan] Storing updated config for user:', updatedConfig.userEmail);

      // Store as versioned object with ALL fields
      // ONE.core will use only ID fields (from isId: true) to calculate ID hash
      const configObject = {
        $type$: 'ProposalConfig' as const,
        ...updatedConfig,
      };

      const result = await storeVersionedObject(configObject);
      console.log('[ProposalsPlan] Config stored with hash:', result.hash);

      // Invalidate proposal cache (config changes affect matching)
      this.proposalCache.clear();

      return {
        success: true,
        config: updatedConfig,
        versionHash: String(result.hash),
      };
    } catch (error: any) {
      console.error('[ProposalsPlan] Error in updateConfig:', error);
      if (error.message.startsWith('INVALID_CONFIG')) {
        throw error;
      }
      throw new Error(`STORAGE_ERROR: ${error.message}`);
    }
  }

  /**
   * Get current user's proposal configuration
   */
  async getConfig(request: GetConfigRequest): Promise<GetConfigResponse> {
    try {
      const config = await this.getCurrentConfig();
      const isDefault = config.updatedAt === DEFAULT_CONFIG.updatedAt;

      return {
        config,
        isDefault,
      };
    } catch (error: any) {
      console.error('[ProposalsPlan] Error in getConfig:', error);
      throw new Error(`USER_NOT_AUTHENTICATED: ${error.message}`);
    }
  }

  /**
   * Dismiss a proposal (Plan/Response pattern)
   *
   * Creates a ProposalInteractionPlan with action='dismiss' and stores it permanently.
   * The proposal ID hash comes from the pastSubjectIdHash.
   */
  async dismiss(request: DismissRequest): Promise<DismissResponse> {
    try {
      if (!request.proposalId || !request.topicId || !request.pastSubjectIdHash) {
        throw new Error('PROPOSAL_NOT_FOUND: Missing required parameters');
      }

      // Get current user email
      const userEmail = this.nodeOneCore.email || 'user@example.com';

      // Create ProposalInteractionPlan (stores permanently in ONE.core)
      const { planIdHash } = await createProposalInteractionPlan(
        userEmail,
        request.pastSubjectIdHash as any,
        'dismiss',
        request.topicId
      );

      // Create ProposalInteractionResponse
      await createProposalInteractionResponse(planIdHash, true);

      console.log('[ProposalsPlan] ✅ Dismissed proposal:', request.pastSubjectIdHash);

      // Also add to in-memory set for immediate filtering (performance optimization)
      const dismissKey = `${request.topicId}:${request.pastSubjectIdHash}`;
      this.dismissedProposals.add(dismissKey);

      // Query remaining non-dismissed proposals
      // For now, return 0 (will be updated when getForTopic is called again)
      const remainingCount = 0;

      return {
        success: true,
        remainingCount,
      };
    } catch (error: any) {
      console.error('[ProposalsPlan] Error in dismiss:', error);
      throw error;
    }
  }

  /**
   * Share a proposal into the current conversation (Plan/Response pattern)
   *
   * Creates a ProposalInteractionPlan with action='share' and stores it permanently.
   */
  async share(request: ShareRequest): Promise<ShareResponse> {
    try {
      // Retrieve past subject by ID hash
      const result = await getObjectByIdHash(request.pastSubjectIdHash);
      if (!result || !result.obj) {
        throw new Error('SUBJECT_NOT_FOUND: Past subject no longer exists');
      }

      const pastSubject = result.obj;

      // Get subject name, description, and keywords
      const subjectName = pastSubject.id || 'Unknown Subject';
      const description = pastSubject.description; // Human-readable description if available
      const keywords: string[] = [];

      // Retrieve keyword terms from ONE.core
      for (const keywordIdHash of pastSubject.keywords || []) {
        try {
          const keywordResult = await getObjectByIdHash(keywordIdHash);
          if (keywordResult && keywordResult.obj) {
            const keyword = keywordResult.obj as any;
            if (keyword.term) {
              keywords.push(keyword.term);
            }
          }
        } catch (error) {
          console.error(
            `[ProposalsPlan] Error fetching keyword ${keywordIdHash}:`,
            error
          );
        }
      }

      // Optionally retrieve sample messages
      const messages: any[] = [];
      if (request.includeMessages) {
        // TODO: Implement message retrieval from past topic
        // For now, return empty array
      }

      // Get current user email
      const userEmail = this.nodeOneCore.email || 'user@example.com';

      // Create ProposalInteractionPlan (stores permanently in ONE.core)
      const { planIdHash } = await createProposalInteractionPlan(
        userEmail,
        request.pastSubjectIdHash as any,
        'share',
        request.topicId
      );

      // Create ProposalInteractionResponse
      await createProposalInteractionResponse(planIdHash, true, {
        sharedToTopicId: request.topicId,
      });

      console.log('[ProposalsPlan] ✅ Shared proposal:', request.pastSubjectIdHash, 'to topic:', request.topicId);

      // Also add to in-memory set for immediate filtering (shared proposals are also dismissed)
      const dismissKey = `${request.topicId}:${request.pastSubjectIdHash}`;
      this.dismissedProposals.add(dismissKey);

      return {
        success: true,
        sharedContent: {
          subjectName,
          description, // Human-readable description (if available)
          keywords,
          messages: request.includeMessages ? messages : undefined,
        },
      };
    } catch (error: any) {
      console.error('[ProposalsPlan] Error in share:', error);
      if (error.message.startsWith('SUBJECT_NOT_FOUND')) {
        throw error;
      }
      throw new Error(`SHARE_FAILED: ${error.message}`);
    }
  }

  /**
   * Helper: Get current user config or return defaults
   *
   * CRITICAL: When using isId: true in recipes, ONE.core calculates the ID hash
   * using ONLY the ID fields ($type$ + userEmail). We must use the same
   * minimal object structure when retrieving.
   */
  private async getCurrentConfig(): Promise<ProposalConfig> {
    try {
      // Get current user email from nodeOneCore
      const userEmail = this.nodeOneCore.email || 'user@example.com';

      // Calculate ID hash using ONLY ID fields (matching recipe's isId: true)
      // This must match what ONE.core uses when storing with isId: true
      const configIdObj = {
        $type$: 'ProposalConfig' as const,
        userEmail,
      };
      const configIdHash = await calculateIdHashOfObj(configIdObj as any);

      console.log('[ProposalsPlan] Looking up config for user:', userEmail, 'idHash:', configIdHash);

      // Retrieve from ONE.core by ID hash
      const result = await getObjectByIdHash(configIdHash);
      if (result && result.obj) {
        console.log('[ProposalsPlan] Found stored config:', result.obj);
        return result.obj as any as ProposalConfig;
      }

      console.log('[ProposalsPlan] No stored config found, using defaults');
      // Return defaults if not found
      return {
        ...DEFAULT_CONFIG,
        userEmail,
      };
    } catch (error) {
      console.error('[ProposalsPlan] Error retrieving config, using defaults:', error);
      // Return defaults on error
      return {
        ...DEFAULT_CONFIG,
        userEmail: this.nodeOneCore.email || 'user@example.com',
      };
    }
  }
}
