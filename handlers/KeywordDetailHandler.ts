/**
 * Keyword Detail Handler (Pure Business Logic)
 *
 * Transport-agnostic handler for keyword detail operations including access control.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Pattern based on refinio.api handler architecture.
 *
 * Implements Phase 2 (Handler Layer) for spec 015-keyword-detail-preview
 */

import { getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';

export interface GetKeywordDetailsRequest {
  keyword: string;
  topicId?: string;
}

export interface GetKeywordDetailsResponse {
  success: boolean;
  data?: {
    keyword: any;
    subjects: any[];
    accessStates: any[];
  };
  error?: string;
}

export interface UpdateKeywordAccessStateRequest {
  keyword: string;
  topicId: string;
  principalId: string;
  principalType: 'user' | 'group';
  state: 'allow' | 'deny' | 'none';
}

export interface UpdateKeywordAccessStateResponse {
  success: boolean;
  data?: {
    accessState: any;
    created: boolean;
  };
  error?: string;
}

/**
 * KeywordDetailHandler - Pure business logic for keyword detail operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - nodeOneCore: Platform-specific ONE.core instance
 * - topicAnalysisModel: Topic analysis model instance
 * - keywordAccessStorage: Access state storage operations
 * - keywordEnrichment: Keyword enrichment service
 */
export class KeywordDetailHandler {
  private nodeOneCore: any;
  private topicAnalysisModel: any;
  private keywordAccessStorage: any;
  private keywordEnrichment: any;
  private detailsCache: Map<string, { data: any; timestamp: number }>;
  private readonly CACHE_TTL = 5000; // 5 seconds

  constructor(
    nodeOneCore: any,
    topicAnalysisModel: any,
    keywordAccessStorage: any,
    keywordEnrichment: any
  ) {
    this.nodeOneCore = nodeOneCore;
    this.topicAnalysisModel = topicAnalysisModel;
    this.keywordAccessStorage = keywordAccessStorage;
    this.keywordEnrichment = keywordEnrichment;
    this.detailsCache = new Map();
  }

  /**
   * Initialize the topic analysis model
   */
  private async ensureModelInitialized(): Promise<void> {
    if (this.topicAnalysisModel.state.currentState === 'Initialised') {
      return;
    }

    if (this.topicAnalysisModel.state.currentState === 'Initialising' as any) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.ensureModelInitialized();
    }

    if (this.topicAnalysisModel.state.currentState === 'Uninitialised') {
      await this.topicAnalysisModel.init();
    }
  }

  /**
   * Get keyword details with subjects, access states, and topic references
   */
  async getKeywordDetails(request: GetKeywordDetailsRequest): Promise<GetKeywordDetailsResponse> {
    const startTime = Date.now();
    console.log('[KeywordDetailHandler] ⏱️ Getting keyword details:', request);

    try {
      // Validate inputs
      if (!request.keyword || typeof request.keyword !== 'string') {
        throw new Error('Invalid keyword: must be non-empty string');
      }

      // Normalize keyword
      const normalizedKeyword = request.keyword.toLowerCase().trim();

      // Check cache
      const cacheKey = `${normalizedKeyword}:${request.topicId || 'all'}`;
      const cached = this.detailsCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        console.log('[KeywordDetailHandler] ⚡ Returning cached data for:', cacheKey, `(${Date.now() - startTime}ms)`);
        return { success: true, data: cached.data };
      }

      // topicId is required - we can't search across all topics without it
      if (!request.topicId) {
        throw new Error('topicId is required');
      }

      // Initialize model
      let t = Date.now();
      await this.ensureModelInitialized();
      console.log('[KeywordDetailHandler] ⏱️ Model init:', `${Date.now() - t}ms`);
      const channelManager = this.nodeOneCore.channelManager;

      // Get the specific keyword using ID hash lookup (O(1))
      t = Date.now();
      const keywordObj = await this.topicAnalysisModel.getKeywordByTerm(request.topicId, normalizedKeyword);
      console.log('[KeywordDetailHandler] ⏱️ getKeywordByTerm:', `${Date.now() - t}ms`);

      if (!keywordObj) {
        throw new Error(`Keyword not found: ${request.keyword}`);
      }

      // Get subject ID hashes from keyword.subjects array
      t = Date.now();
      const subjectIdHashes = keywordObj.subjects || [];
      console.log('[KeywordDetailHandler] ⏱️ Got subject ID hashes from keyword:', `${Date.now() - t}ms`, `(${subjectIdHashes.length} subjects)`);
      console.log('[KeywordDetailHandler] 🔍 DEBUG keyword.subjects:', JSON.stringify(subjectIdHashes, null, 2));

      // Load ONLY the subjects referenced by this keyword using their ID hashes
      t = Date.now();
      const subjects = [];

      for (const subjectIdHash of subjectIdHashes) {
        try {
          console.log('[KeywordDetailHandler] 🔍 Attempting to load subject with ID hash:', subjectIdHash);
          const result = await getObjectByIdHash(subjectIdHash);
          console.log('[KeywordDetailHandler] 🔍 getObjectByIdHash returned:', result ? `obj: ${result.obj?.$type$}` : 'null');
          if (result?.obj) {
            subjects.push(result.obj);
          } else {
            console.warn('[KeywordDetailHandler] ⚠️  Subject not found for ID hash:', subjectIdHash);
          }
        } catch (error) {
          console.warn('[KeywordDetailHandler] ❌ Could not load subject with ID hash:', subjectIdHash, error);
        }
      }
      console.log('[KeywordDetailHandler] ⏱️ Loaded specific subjects:', `${Date.now() - t}ms`, `(${subjects.length} loaded)`);

      // Enrich keyword with topic references
      t = Date.now();
      const enrichedKeyword = await this.keywordEnrichment.enrichKeywordWithTopicReferences(
        keywordObj,
        subjects,
        channelManager
      );
      console.log('[KeywordDetailHandler] ⏱️ enrichKeywordWithTopicReferences:', `${Date.now() - t}ms`);

      // Enrich subjects with metadata
      t = Date.now();
      const enrichedSubjects = await this.keywordEnrichment.enrichSubjectsWithMetadata(
        subjects,
        subjects  // We only have the subjects for this keyword now
      );
      console.log('[KeywordDetailHandler] ⏱️ enrichSubjectsWithMetadata:', `${Date.now() - t}ms`);

      // Sort subjects by relevanceScore descending
      t = Date.now();
      const sortedSubjects = this.keywordEnrichment.sortByRelevance(enrichedSubjects);
      console.log('[KeywordDetailHandler] ⏱️ sortByRelevance:', `${Date.now() - t}ms`);

      // Get access states for this keyword
      t = Date.now();
      const accessStates = await this.keywordAccessStorage.getAccessStatesByKeyword(
        channelManager,
        normalizedKeyword
      );
      console.log('[KeywordDetailHandler] ⏱️ getAccessStatesByKeyword:', `${Date.now() - t}ms`);

      const result = {
        keyword: enrichedKeyword,
        subjects: sortedSubjects,
        accessStates
      };

      // Cache result
      this.detailsCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      console.log('[KeywordDetailHandler] ⏱️ TOTAL TIME:', `${Date.now() - startTime}ms`, {
        keyword: normalizedKeyword,
        subjectCount: sortedSubjects.length,
        accessStateCount: accessStates.length
      });

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('[KeywordDetailHandler] ❌ Error getting keyword details:', error, `(${Date.now() - startTime}ms)`);
      return {
        success: false,
        error: (error as Error).message,
        data: {
          keyword: null,
          subjects: [],
          accessStates: []
        }
      };
    }
  }

  /**
   * Update or create access state for a keyword and principal
   */
  async updateKeywordAccessState(request: UpdateKeywordAccessStateRequest): Promise<UpdateKeywordAccessStateResponse> {
    console.log('[KeywordDetailHandler] Updating access state:', request);

    try {
      // Validate inputs
      if (!request.keyword || typeof request.keyword !== 'string') {
        throw new Error('Invalid keyword: must be non-empty string');
      }
      if (!request.topicId) {
        throw new Error('Invalid topicId: required');
      }
      if (!request.principalId) {
        throw new Error('Invalid principalId: required');
      }
      if (!['user', 'group'].includes(request.principalType)) {
        throw new Error(`Invalid principalType: must be 'user' or 'group'`);
      }
      if (!['allow', 'deny', 'none'].includes(request.state)) {
        throw new Error(`Invalid state: must be 'allow', 'deny', or 'none'`);
      }

      // Normalize keyword
      const keywordTerm = request.keyword.toLowerCase().trim();

      // Initialize model
      await this.ensureModelInitialized();
      const channelManager = this.nodeOneCore.channelManager;

      // Verify keyword exists in this topic
      const allKeywords: any = await this.topicAnalysisModel.getKeywords(request.topicId);
      const keywordExists = allKeywords.some((k: any) => k.term === keywordTerm);
      if (!keywordExists) {
        throw new Error(`Keyword not found: ${request.keyword}`);
      }

      // Get current user
      const updatedBy = (this.nodeOneCore as any).getCurrentUserId
        ? (this.nodeOneCore as any).getCurrentUserId()
        : 'system';

      if (!updatedBy) {
        throw new Error('User not authenticated');
      }

      // Update access state (upsert)
      const result = await this.keywordAccessStorage.updateAccessState(
        channelManager,
        keywordTerm,
        request.principalId,
        request.principalType,
        request.state,
        updatedBy
      );

      // Invalidate cache for this keyword
      const cacheKeys = Array.from(this.detailsCache.keys());
      for (const key of cacheKeys) {
        if (key.startsWith(`${keywordTerm}:`)) {
          this.detailsCache.delete(key);
        }
      }

      // Get the access state object
      const accessState = await this.keywordAccessStorage.getAccessStateByPrincipal(
        channelManager,
        keywordTerm,
        request.principalId
      );

      console.log('[KeywordDetailHandler] Access state updated:', {
        keywordTerm,
        principalId: request.principalId,
        created: result.created
      });

      return {
        success: true,
        data: {
          accessState: accessState,
          created: result.created
        }
      };
    } catch (error) {
      console.error('[KeywordDetailHandler] Error updating access state:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: {
          accessState: null,
          created: false
        }
      };
    }
  }
}
