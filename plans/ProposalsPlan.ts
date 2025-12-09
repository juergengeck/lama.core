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
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';
import type { Subject } from '../one-ai/types/Subject.js';

const MessageBus = createMessageBus('ProposalsPlan');
import {
  createProposalInteractionPlan,
  createProposalInteractionResponse,
  isProposalDismissed,
} from './ProposalInteractions.js';
import { SemanticProposalEngine } from '../services/semantic-proposal-engine.js';

// Re-export types for consumers
export interface Proposal {
  id: string;  // Same as pastSubject - the SHA256IdHash IS the unique identity
  pastSubject: SHA256IdHash<Subject>;
  currentSubject?: SHA256IdHash<Subject>;
  matchedKeywords: string[];
  relevanceScore: number;
  sourceTopicId: string;
  pastSubjectName: string;
  pastSubjectDescription?: string;  // Human-readable description
  createdAt: number;
}

export interface ProposalConfig {
  userEmail: string;
  matchWeight: number;
  recencyWeight: number;
  recencyWindow: number;
  minJaccard: number;
  minSimilarity?: number;  // Embedding similarity threshold (default: 0.5)
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

export interface GetDetailsRequest {
  pastSubjectIdHash: SHA256IdHash<Subject>;
  topicId: string;
}

export interface GetDetailsResponse {
  success: boolean;
  details: {
    subject: {
      hash: string;
      name: string;
      description?: string;
      timeRanges?: Array<{ start: number; end: number }>;  // Time spans when subject was discussed
      createdAt?: number;  // First message timestamp
      lastSeenAt?: number; // Last message timestamp
    };
    keywords: Array<{ hash: string; value: string }>;
    messages: Array<{
      hash: string;
      conversationHash: string;
      role: 'user' | 'assistant';
      text: string;
      timestamp: string;
    }>;
    memories: Array<{
      hash: string;
      content: string;
      timestamp?: string;
    }>;
    summary?: {
      hash: string;
      text: string;
    };
  };
}

// Default configuration
const DEFAULT_CONFIG: ProposalConfig = {
  userEmail: '',
  matchWeight: 0.7,
  recencyWeight: 0.3,
  recencyWindow: 30 * 24 * 60 * 60 * 1000, // 30 days
  minJaccard: 0.1, // 10% match - lowered from 0.2 to catch more proposals with short input
  minSimilarity: 0.5, // Embedding similarity threshold (0.5 = moderate similarity)
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
  private semanticEngine?: SemanticProposalEngine;

  constructor(
    nodeOneCore: any,
    topicAnalysisModel: any,
    proposalEngine: any,
    proposalRanker: any,
    proposalCache: any,
    semanticEngine?: SemanticProposalEngine
  ) {
    this.nodeOneCore = nodeOneCore;
    this.topicAnalysisModel = topicAnalysisModel;
    this.proposalEngine = proposalEngine;
    this.proposalRanker = proposalRanker;
    this.proposalCache = proposalCache;
    this.dismissedProposals = new Set();
    this.semanticEngine = semanticEngine;
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
            subjects.map((subject: any) => calculateIdHashOfObj(subject as any))
          );
          MessageBus.send('debug', '[ProposalsPlan] Calculated ID hashes for', subjectIdHashes.length, 'subjects');
        } catch (error: any) {
          MessageBus.send('error', '[ProposalsPlan] Error querying subjects:', error);
          return {
            proposals: [],
            count: 0,
            cached: false,
            computeTimeMs: Date.now() - startTime,
          };
        }
      } else {
        MessageBus.send('debug', '[ProposalsPlan] Using provided subjects:', subjectIdHashes.length);
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
      MessageBus.send('debug', '[ProposalsPlan] Using config:', {
        minJaccard: config.minJaccard,
        matchWeight: config.matchWeight,
        maxProposals: config.maxProposals
      });

      // Generate proposals using semantic engine if available, otherwise use Jaccard engine
      let proposals: any[];
      if (this.semanticEngine) {
        MessageBus.send('debug', '[ProposalsPlan] Using SemanticProposalEngine');
        proposals = await this.semanticEngine.getProposalsForTopic(
          request.topicId,
          subjectIdHashes,
          { ...config, jaccardBoost: 0.1, minSimilarity: config.minSimilarity ?? 0.5 }
        );
      } else {
        MessageBus.send('debug', '[ProposalsPlan] Using Jaccard-only ProposalEngine');
        proposals = await this.proposalEngine.getProposalsForTopic(
          request.topicId,
          subjectIdHashes,
          config
        );
      }
      MessageBus.send('debug', '[ProposalsPlan] ProposalEngine returned', proposals.length, 'proposals');

      // Rank proposals
      MessageBus.send('debug', '[ProposalsPlan] Ranking proposals...');
      const rankedProposals = this.proposalRanker.rankProposals(proposals, config);
      MessageBus.send('debug', '[ProposalsPlan] Ranked proposals:', rankedProposals.length);

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

        // Add id field - pastSubject (SHA256IdHash) IS the unique identity
        filtered.push({
          ...proposal,
          id: proposal.pastSubject as string
        });
      }

      MessageBus.send('debug', '[ProposalsPlan] Filtered proposals (after dismissals):', filtered.length);

      // Cache results
      this.proposalCache.set(request.topicId, subjectIdHashes, filtered);

      MessageBus.send('debug', '[ProposalsPlan] ✅ Returning', filtered.length, 'proposals in', Date.now() - startTime, 'ms');
      return {
        proposals: filtered,
        count: filtered.length,
        cached: false,
        computeTimeMs: Date.now() - startTime,
      };
    } catch (error: any) {
      MessageBus.send('error', '[ProposalsPlan] ❌ Error in getForTopic:', error);
      MessageBus.send('error', '[ProposalsPlan] Error stack:', error.stack);
      throw new Error(`COMPUTATION_ERROR: ${error.message}`);
    }
  }

  /**
   * Update user's proposal configuration
   */
  async updateConfig(request: UpdateConfigRequest): Promise<UpdateConfigResponse> {
    try {
      // Validate request structure more defensively
      if (!request || typeof request !== 'object') {
        throw new Error('INVALID_REQUEST: request must be an object');
      }

      if (!request.config || typeof request.config !== 'object') {
        throw new Error('INVALID_REQUEST: config object is required');
      }

      const config = request.config;

      // Validate config parameters - check existence first to avoid undefined access
      if ('matchWeight' in config && config.matchWeight !== undefined) {
        if (typeof config.matchWeight !== 'number' || config.matchWeight < 0 || config.matchWeight > 1) {
          throw new Error('INVALID_CONFIG: matchWeight must be a number between 0.0 and 1.0');
        }
      }

      if ('recencyWeight' in config && config.recencyWeight !== undefined) {
        if (typeof config.recencyWeight !== 'number' || config.recencyWeight < 0 || config.recencyWeight > 1) {
          throw new Error('INVALID_CONFIG: recencyWeight must be a number between 0.0 and 1.0');
        }
      }

      if ('maxProposals' in config && config.maxProposals !== undefined) {
        if (typeof config.maxProposals !== 'number' || config.maxProposals < 1 || config.maxProposals > 50) {
          throw new Error('INVALID_CONFIG: maxProposals must be a number between 1 and 50');
        }
      }

      if ('minJaccard' in config && config.minJaccard !== undefined) {
        if (typeof config.minJaccard !== 'number' || config.minJaccard < 0 || config.minJaccard > 1) {
          throw new Error('INVALID_CONFIG: minJaccard must be a number between 0.0 and 1.0');
        }
      }

      if ('minSimilarity' in config && config.minSimilarity !== undefined) {
        if (typeof config.minSimilarity !== 'number' || config.minSimilarity < 0 || config.minSimilarity > 1) {
          throw new Error('INVALID_CONFIG: minSimilarity must be a number between 0.0 and 1.0');
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

      MessageBus.send('debug', '[ProposalsPlan] Storing updated config for user:', updatedConfig.userEmail);

      // Store as versioned object with ALL fields
      // ONE.core will use only ID fields (from isId: true) to calculate ID hash
      const configObject = {
        $type$: 'ProposalConfig' as const,
        ...updatedConfig,
      };

      const result = await storeVersionedObject(configObject);
      MessageBus.send('debug', '[ProposalsPlan] Config stored with hash:', result.hash);

      // Invalidate proposal cache (config changes affect matching)
      this.proposalCache.clear();

      return {
        success: true,
        config: updatedConfig,
        versionHash: String(result.hash),
      };
    } catch (error: any) {
      MessageBus.send('error', '[ProposalsPlan] Error in updateConfig:', error);
      if (error.message.startsWith('INVALID_CONFIG')) {
        throw error;
      }
      throw new Error(`STORAGE_ERROR: ${error.message}`);
    }
  }

  /**
   * Get current user's proposal configuration
   */
  async getConfig(_request: GetConfigRequest): Promise<GetConfigResponse> {
    try {
      const config = await this.getCurrentConfig();
      const isDefault = config.updatedAt === DEFAULT_CONFIG.updatedAt;

      return {
        config,
        isDefault,
      };
    } catch (error: any) {
      MessageBus.send('error', '[ProposalsPlan] Error in getConfig:', error);
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

      MessageBus.send('debug', '[ProposalsPlan] ✅ Dismissed proposal:', request.pastSubjectIdHash);

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
      MessageBus.send('error', '[ProposalsPlan] Error in dismiss:', error);
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

      const pastSubject = result.obj as Subject;

      // Get subject name, description, and keywords
      const subjectName = pastSubject.topics?.[0] || 'Unknown Subject';
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
          MessageBus.send('error', `[ProposalsPlan] Error fetching keyword ${keywordIdHash}: ${error}`);
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

      MessageBus.send('debug', '[ProposalsPlan] ✅ Shared proposal:', request.pastSubjectIdHash, 'to topic:', request.topicId);

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
      MessageBus.send('error', '[ProposalsPlan] Error in share:', error);
      if (error.message.startsWith('SUBJECT_NOT_FOUND')) {
        throw error;
      }
      throw new Error(`SHARE_FAILED: ${error.message}`);
    }
  }

  /**
   * Get detailed content for a proposal (on-demand fetch)
   * Used when user expands the ProposalCard to see selectable content
   */
  async getDetails(request: GetDetailsRequest): Promise<GetDetailsResponse> {
    try {
      // Get subject with full metadata (including timestamps) from topic via channel
      // This retrieves lastSeenAt, createdAt etc. from the channel entry
      const topicId = request.topicId;
      let pastSubject: any = null;

      // Try to find subject in the topic's channel with full metadata
      if (topicId && this.topicAnalysisModel) {
        const subjects = await this.topicAnalysisModel.getSubjects(topicId);
        pastSubject = subjects.find((s: any) =>
          String(s.idHash) === String(request.pastSubjectIdHash)
        );
      }

      // Fallback to raw object if not found in channel
      if (!pastSubject) {
        const result = await getObjectByIdHash(request.pastSubjectIdHash);
        if (!result || !result.obj) {
          throw new Error('SUBJECT_NOT_FOUND: Past subject no longer exists');
        }
        pastSubject = result.obj as Subject;
      }

      const subjectName = pastSubject.description || pastSubject.topics?.[0] || 'Unknown Subject';
      const description = pastSubject.description;

      // Log subject metadata for debugging
      MessageBus.send('debug', `[ProposalsPlan] getDetails: Subject has timestamps - lastSeenAt: ${pastSubject.lastSeenAt}, createdAt: ${pastSubject.createdAt}`);
      MessageBus.send('debug', `[ProposalsPlan] getDetails: Subject topics: ${pastSubject.topics?.join(', ') || 'none'}`);

      // Retrieve keywords with hashes
      const keywords: Array<{ hash: string; value: string }> = [];
      for (const keywordIdHash of pastSubject.keywords || []) {
        try {
          const keywordResult = await getObjectByIdHash(keywordIdHash);
          if (keywordResult && keywordResult.obj) {
            const keyword = keywordResult.obj as any;
            if (keyword.term) {
              keywords.push({
                hash: String(keywordIdHash),
                value: keyword.term,
              });
            }
          }
        } catch (error) {
          MessageBus.send('error', `[ProposalsPlan] Error fetching keyword ${keywordIdHash}:`, error);
        }
      }

      // Messages: Get from subject's source topics within timeRanges
      // Subject stores timeRanges which define the temporal spans when this subject was discussed
      const messages: Array<{
        hash: string;
        conversationHash: string;
        role: 'user' | 'assistant';
        text: string;
        timestamp: string;
      }> = [];

      // Query messages from each topic the subject references
      const sourceTopics = pastSubject.topics || [];
      const timeRanges = pastSubject.timeRanges || [];

      MessageBus.send('debug', `[ProposalsPlan] getDetails: Querying messages from ${sourceTopics.length} topics, ${timeRanges.length} time ranges`);

      if (sourceTopics.length > 0 && this.nodeOneCore?.channelManager && timeRanges.length > 0) {
        // Get overall time bounds from timeRanges
        const minTime = Math.min(...timeRanges.map(r => r.start));
        const maxTime = Math.max(...timeRanges.map(r => r.end));

        for (const sourceTopicId of sourceTopics) {
          try {
            // Use time-based query with from/to options
            const entries = await this.nodeOneCore.channelManager.getObjects({
              channelId: sourceTopicId,
              from: new Date(minTime - 1000),  // 1 second buffer
              to: new Date(maxTime + 1000)
            });

            // Filter to messages only
            for (const entry of entries) {
              // Skip non-message types
              if (!entry.data || entry.data.$type$ === 'MessageAttestation' ||
                  entry.data.$type$ === 'Subject' || entry.data.$type$ === 'Keyword') {
                continue;
              }

              const text = entry.data.text || entry.data.content || '';
              if (text) {
                const entryTime = entry.creationTime
                  ? new Date(entry.creationTime).getTime()
                  : entry.data.timestamp
                    ? new Date(entry.data.timestamp).getTime()
                    : 0;

                messages.push({
                  hash: String(entry.hash || entry.channelEntryHash),
                  conversationHash: String(sourceTopicId),
                  role: entry.data.sender === 'assistant' || entry.data.role === 'assistant' ? 'assistant' : 'user',
                  text,
                  timestamp: new Date(entryTime).toISOString(),
                });
              }
            }
          } catch (error) {
            MessageBus.send('error', `[ProposalsPlan] Error fetching messages from topic ${sourceTopicId}:`, error);
          }
        }

        // Sort messages by timestamp (oldest first for reading context)
        messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        // Limit to last 10 messages to avoid overwhelming the UI
        if (messages.length > 10) {
          messages.splice(0, messages.length - 10);
        }
      }

      MessageBus.send('debug', `[ProposalsPlan] getDetails: Found ${messages.length} messages in time ranges`);
      MessageBus.send('debug', `[ProposalsPlan] getDetails: Subject memories: ${pastSubject.memories?.length || 0}`);

      // Retrieve linked memories if available
      const memories: Array<{
        hash: string;
        content: string;
        timestamp?: string;
      }> = [];

      if ((pastSubject as any).memories && Array.isArray((pastSubject as any).memories)) {
        for (const memoryRef of (pastSubject as any).memories) {
          try {
            const memResult = await getObjectByIdHash(memoryRef);
            if (memResult && memResult.obj) {
              const mem = memResult.obj as any;
              memories.push({
                hash: String(memoryRef),
                content: mem.content || mem.text || '',
                timestamp: mem.timestamp,
              });
            }
          } catch (error) {
            MessageBus.send('error', `[ProposalsPlan] Error fetching memory:`, error);
          }
        }
      }

      // Retrieve summary if available
      // Summary is identified by (subject + topic) - calculate its ID hash
      let summary: { hash: string; text: string } | undefined;
      if (request.topicId) {
        try {
          // Summary ID is calculated from subject + topic (isId: true fields)
          const summaryIdObj = {
            $type$: 'Summary' as const,
            subject: String(request.pastSubjectIdHash),
            topic: request.topicId,
          };
          const summaryIdHash = await calculateIdHashOfObj(summaryIdObj as any);
          const summaryResult = await getObjectByIdHash(summaryIdHash);
          if (summaryResult && summaryResult.obj) {
            const sum = summaryResult.obj as any;
            summary = {
              hash: String(summaryIdHash),
              text: sum.prose || sum.text || sum.content || '',
            };
            MessageBus.send('debug', `[ProposalsPlan] Found summary for subject: ${summary.text.slice(0, 50)}...`);
          }
        } catch (error) {
          // Summary not found is normal - not all subjects have summaries
          MessageBus.send('debug', `[ProposalsPlan] No summary found for subject in topic ${request.topicId}`);
        }
      }

      MessageBus.send('debug', `[ProposalsPlan] getDetails: ${keywords.length} keywords, ${messages.length} messages, ${memories.length} memories`);

      return {
        success: true,
        details: {
          subject: {
            hash: String(request.pastSubjectIdHash),
            name: subjectName,
            description,
            // Time ranges when this subject was discussed (UI uses for scrolling to messages)
            timeRanges: pastSubject.timeRanges,
            createdAt: pastSubject.createdAt,
            lastSeenAt: pastSubject.lastSeenAt,
          },
          keywords,
          messages,
          memories,
          summary,
        },
      };
    } catch (error: any) {
      MessageBus.send('error', '[ProposalsPlan] Error in getDetails:', error);
      throw new Error(`GET_DETAILS_FAILED: ${error.message}`);
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

      MessageBus.send('debug', '[ProposalsPlan] Looking up config for user:', userEmail, 'idHash:', configIdHash);

      // Retrieve from ONE.core by ID hash
      const result = await getObjectByIdHash(configIdHash);
      if (result && result.obj) {
        MessageBus.send('debug', '[ProposalsPlan] Found stored config:', result.obj);
        return result.obj as any as ProposalConfig;
      }

      MessageBus.send('debug', '[ProposalsPlan] No stored config found, using defaults');
      // Return defaults if not found
      return {
        ...DEFAULT_CONFIG,
        userEmail,
      };
    } catch (error) {
      MessageBus.send('error', '[ProposalsPlan] Error retrieving config, using defaults:', error);
      // Return defaults on error
      return {
        ...DEFAULT_CONFIG,
        userEmail: this.nodeOneCore.email || 'user@example.com',
      };
    }
  }
}
