/**
 * Keyword Detail Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for keyword detail operations including access control.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Pattern based on refinio.api handler architecture.
 *
 * Implements Phase 2 (Handler Layer) for spec 015-keyword-detail-preview
 */

import { getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Keyword } from '../one-ai/types/Keyword.js';
import type { Subject } from '../one-ai/types/Subject.js';

export interface GetKeywordDetailsRequest {
  keyword: string;
  topicId?: string;
}

export interface GetKeywordDetailsResponse {
  success: boolean;
  data?: {
    keyword: Keyword | null;
    subjects: Subject[];
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

export interface GetAllKeywordsRequest {
  includeArchived?: boolean;
  sortBy?: 'frequency' | 'alphabetical' | 'lastSeen';
  limit?: number;
  offset?: number;
}

export interface AggregatedKeyword {
  $type$: 'Keyword';
  term: string;
  category: string | null;
  frequency: number;
  score: number;
  extractedAt: string;
  lastSeen: string;
  subjects: SHA256IdHash<Subject>[];

  // Aggregated statistics
  topicCount: number;
  subjectCount: number;
  topTopics: Array<{
    topicId: string;
    topicName: string;
    frequency: number;
  }>;

  // Access control summary
  accessControlCount: number;
  hasRestrictions: boolean;
}

export interface GetAllKeywordsResponse {
  success: boolean;
  data?: {
    keywords: AggregatedKeyword[];
    totalCount: number;
    hasMore: boolean;
  };
  error?: string;
}

/**
 * KeywordDetailPlan - Pure business logic for keyword detail operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - nodeOneCore: Platform-specific ONE.core instance
 * - topicAnalysisModel: Topic analysis model instance
 * - keywordAccessStorage: Access state storage operations
 * - keywordEnrichment: Keyword enrichment service
 */
export class KeywordDetailPlan {
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
    console.log('[KeywordDetailPlan] ⏱️ Getting keyword details:', request);

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
        console.log('[KeywordDetailPlan] ⚡ Returning cached data for:', cacheKey, `(${Date.now() - startTime}ms)`);
        return { success: true, data: cached.data };
      }

      // topicId is required - we can't search across all topics without it
      if (!request.topicId) {
        throw new Error('topicId is required');
      }

      // Initialize model
      let t = Date.now();
      await this.ensureModelInitialized();
      console.log('[KeywordDetailPlan] ⏱️ Model init:', `${Date.now() - t}ms`);
      const channelManager = this.nodeOneCore.channelManager;

      // Get the specific keyword using ID hash lookup (O(1))
      t = Date.now();
      const keywordObj = await this.topicAnalysisModel.getKeywordByTerm(request.topicId, normalizedKeyword);
      console.log('[KeywordDetailPlan] ⏱️ getKeywordByTerm:', `${Date.now() - t}ms`);

      if (!keywordObj) {
        throw new Error(`Keyword not found: ${request.keyword}`);
      }

      // Get subject ID hashes from keyword.subjects array
      t = Date.now();
      const subjectIdHashes = keywordObj.subjects || [];
      console.log('[KeywordDetailPlan] ⏱️ Got subject ID hashes from keyword:', `${Date.now() - t}ms`, `(${subjectIdHashes.length} subjects)`);
      console.log('[KeywordDetailPlan] 🔍 DEBUG keyword.subjects:', JSON.stringify(subjectIdHashes, null, 2));

      // Load ONLY the subjects referenced by this keyword using their ID hashes
      t = Date.now();
      const subjects = [];

      for (const subjectIdHash of subjectIdHashes) {
        try {
          console.log('[KeywordDetailPlan] 🔍 Attempting to load subject with ID hash:', subjectIdHash);
          const result = await getObjectByIdHash(subjectIdHash);
          console.log('[KeywordDetailPlan] 🔍 getObjectByIdHash returned:', result ? `obj: ${(result.obj as any)?.$type$}` : 'null');
          if (result?.obj) {
            subjects.push(result.obj);
          } else {
            console.warn('[KeywordDetailPlan] ⚠️  Subject not found for ID hash:', subjectIdHash);
          }
        } catch (error) {
          console.warn('[KeywordDetailPlan] ❌ Could not load subject with ID hash:', subjectIdHash, error);
        }
      }
      console.log('[KeywordDetailPlan] ⏱️ Loaded specific subjects:', `${Date.now() - t}ms`, `(${subjects.length} loaded)`);

      // Enrich keyword with topic references
      t = Date.now();
      const enrichedKeyword = await this.keywordEnrichment.enrichKeywordWithTopicReferences(
        keywordObj,
        subjects,
        channelManager
      );
      console.log('[KeywordDetailPlan] ⏱️ enrichKeywordWithTopicReferences:', `${Date.now() - t}ms`);

      // Enrich subjects with metadata
      t = Date.now();
      const enrichedSubjects = await this.keywordEnrichment.enrichSubjectsWithMetadata(
        subjects,
        subjects  // We only have the subjects for this keyword now
      );
      console.log('[KeywordDetailPlan] ⏱️ enrichSubjectsWithMetadata:', `${Date.now() - t}ms`);

      // Sort subjects by relevanceScore descending
      t = Date.now();
      const sortedSubjects = this.keywordEnrichment.sortByRelevance(enrichedSubjects);
      console.log('[KeywordDetailPlan] ⏱️ sortByRelevance:', `${Date.now() - t}ms`);

      // Get access states for this keyword
      t = Date.now();
      const accessStates = await this.keywordAccessStorage.getAccessStatesByKeyword(
        channelManager,
        normalizedKeyword
      );
      console.log('[KeywordDetailPlan] ⏱️ getAccessStatesByKeyword:', `${Date.now() - t}ms`);

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

      console.log('[KeywordDetailPlan] ⏱️ TOTAL TIME:', `${Date.now() - startTime}ms`, {
        keyword: normalizedKeyword,
        subjectCount: sortedSubjects.length,
        accessStateCount: accessStates.length
      });

      return {
        success: true,
        data: result
      };
    } catch (error) {
      console.error('[KeywordDetailPlan] ❌ Error getting keyword details:', error, `(${Date.now() - startTime}ms)`);
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
    console.log('[KeywordDetailPlan] Updating access state:', request);

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

      console.log('[KeywordDetailPlan] Access state updated:', {
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
      console.error('[KeywordDetailPlan] Error updating access state:', error);
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

  /**
   * Get all keywords across all topics with aggregated statistics
   */
  async getAllKeywords(request: GetAllKeywordsRequest = {}): Promise<GetAllKeywordsResponse> {
    const startTime = Date.now();
    const {
      includeArchived = false,
      sortBy = 'frequency',
      limit = 500,
      offset = 0
    } = request;

    console.log('[KeywordDetailPlan] Getting all keywords:', { sortBy, limit, offset });

    try {
      // Validate inputs
      if (!['frequency', 'alphabetical', 'lastSeen'].includes(sortBy)) {
        throw new Error(`Invalid sortBy: must be 'frequency', 'alphabetical', or 'lastSeen'`);
      }

      if (limit < 1 || limit > 500) {
        throw new Error('Invalid limit: must be between 1 and 500');
      }

      if (offset < 0) {
        throw new Error('Invalid offset: must be non-negative');
      }

      // Initialize model
      await this.ensureModelInitialized();
      const channelManager = this.nodeOneCore.channelManager;

      // Get all subjects from all topics
      const allSubjects = await this.topicAnalysisModel.getAllSubjects();
      const filteredSubjects = includeArchived
        ? allSubjects
        : allSubjects.filter((s: any) => !s.archived);

      console.log('[KeywordDetailPlan] Loaded subjects:', filteredSubjects.length);

      // Get all keywords from all topics
      const allKeywords = await this.topicAnalysisModel.getAllKeywords();
      console.log('[KeywordDetailPlan] Loaded keywords:', allKeywords.length);

      // Get all access states
      const allAccessStates = await this.keywordAccessStorage.getAllAccessStates(channelManager);
      console.log('[KeywordDetailPlan] Loaded access states:', allAccessStates.length);

      // Aggregate keywords by term
      const keywordMap = new Map<string, AggregatedKeyword>();

      for (const keyword of allKeywords) {
        if (!keywordMap.has(keyword.term)) {
          keywordMap.set(keyword.term, {
            $type$: 'Keyword',
            term: keyword.term,
            category: keyword.category || null,
            frequency: keyword.frequency || 0,
            score: keyword.score || 0,
            extractedAt: keyword.extractedAt || new Date().toISOString(),
            lastSeen: keyword.extractedAt || new Date().toISOString(),
            subjects: keyword.subjects || [],
            topicCount: 0,
            subjectCount: 0,
            topTopics: [],
            accessControlCount: 0,
            hasRestrictions: false
          });
        }
      }

      // Aggregate statistics from subjects
      const topicFrequencyMap = new Map<string, Map<string, number>>(); // keyword -> topicId -> frequency

      for (const subject of filteredSubjects) {
        const keywordTerms = (subject.keywords || [])
          .map((kHash: any) => {
            const kw = allKeywords.find((k: any) => k.id === kHash || k.idHash === kHash);
            return kw?.term;
          })
          .filter(Boolean);

        for (const term of keywordTerms) {
          const agg = keywordMap.get(term);
          if (!agg) continue;

          agg.subjectCount++;

          // Track topic frequencies
          if (!topicFrequencyMap.has(term)) {
            topicFrequencyMap.set(term, new Map());
          }
          const topicMap = topicFrequencyMap.get(term)!;
          const currentFreq = topicMap.get(subject.topicId) || 0;
          topicMap.set(subject.topicId, currentFreq + (subject.messageCount || 1));
        }
      }

      // Calculate topTopics and topicCount
      for (const [term, agg] of keywordMap.entries()) {
        const topicMap = topicFrequencyMap.get(term);
        if (topicMap) {
          agg.topicCount = topicMap.size;

          // Convert to array and sort by frequency
          agg.topTopics = Array.from(topicMap.entries())
            .map(([topicId, frequency]) => ({
              topicId,
              topicName: topicId, // TODO: Get actual topic name from TopicModel
              frequency
            }))
            .sort((a, b) => b.frequency - a.frequency)
            .slice(0, 3);

          // Update total frequency from top topics
          agg.frequency = Array.from(topicMap.values()).reduce((sum, f) => sum + f, 0);
        }

        // Add access control summary
        const accessStates = allAccessStates.filter((s: any) => s.keywordTerm === term);
        agg.accessControlCount = accessStates.length;
        agg.hasRestrictions = accessStates.some((s: any) => s.state === 'deny');
      }

      // Convert to array
      let keywords = Array.from(keywordMap.values());

      // Sort
      switch (sortBy) {
        case 'frequency':
          keywords.sort((a, b) => b.frequency - a.frequency || b.score - a.score);
          break;
        case 'alphabetical':
          keywords.sort((a, b) => a.term.localeCompare(b.term) || b.frequency - a.frequency);
          break;
        case 'lastSeen':
          keywords.sort((a, b) =>
            new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime() ||
            b.frequency - a.frequency
          );
          break;
      }

      // Paginate
      const totalCount = keywords.length;
      keywords = keywords.slice(offset, offset + limit);

      console.log('[KeywordDetailPlan] Aggregated keywords:', {
        total: totalCount,
        returned: keywords.length,
        time: `${Date.now() - startTime}ms`
      });

      return {
        success: true,
        data: {
          keywords,
          totalCount,
          hasMore: (offset + limit) < totalCount
        }
      };

    } catch (error) {
      console.error('[KeywordDetailPlan] Error getting all keywords:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: {
          keywords: [],
          totalCount: 0,
          hasMore: false
        }
      };
    }
  }
}
