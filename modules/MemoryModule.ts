// packages/lama.browser/browser-ui/src/modules/MemoryModule.ts
import type { Module } from '@refinio/api';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicAnalysisModel from '@lama/core/one-ai/models/TopicAnalysisModel.js';
import type { SubjectsPlan } from '@lama/core/plans/SubjectsPlan.js';
import type { MemoryPlan as UIMemoryPlan } from '@ui/core';
import type { SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';

// ONE.core storage imports
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

// Memory.core imports
import { MemoryPlan as CoreMemoryPlan, ChatMemoryPlan, ChatMemoryService, MemoryExportPlan, MemoryImportPlan } from '@memory/core';

// TopicAnalyzer for LLM-based keyword extraction
import TopicAnalyzer from '../one-ai/services/TopicAnalyzer.js';

/**
 * Embedding provider interface for semantic memory search
 * Platform implementations (ONNX, Ollama) inject this at runtime
 */
export interface EmbeddingProvider {
  readonly model: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * MeaningDimension interface for cube-based semantic indexing
 * Provided by meaning.core package
 */
export interface MeaningDimensionLike {
  indexText(objectHash: SHA256Hash, text: string): Promise<SHA256Hash>;
  queryByText(text: string, k: number, threshold?: number): Promise<Array<{
    objectHash: SHA256Hash;
    meaningNodeHash: SHA256Hash;
    similarity: number;
  }>>;
  isIndexed(objectHash: SHA256Hash): boolean;
  getIndexSize(): number;
}

/**
 * MemoryModule - Memory management functionality
 *
 * Provides:
 * - memoryPlan: Implements ui.core's MemoryPlan interface for UI consumption
 * - ChatMemoryPlan for chat-scoped memory
 * - ChatMemoryService for extraction and association
 */
export class MemoryModule implements Module {
  readonly name = 'MemoryModule';

  static demands = [
    { targetType: 'ChannelManager', required: true },
    { targetType: 'TopicAnalysisModel', required: true },
    { targetType: 'SubjectsPlan', required: true },
    { targetType: 'OneCore', required: true },
    { targetType: 'LLMManager', required: true },  // For TopicAnalyzer keyword extraction
    { targetType: 'LeuteModel', required: false },
    { targetType: 'AuditService', required: false },
    { targetType: 'EmbeddingProvider', required: false },  // For ChatMemoryService semantic search
    { targetType: 'MeaningDimension', required: false }    // For cube-based HNSW indexing
  ];

  static supplies = [
    { targetType: 'MemoryPlan' },
    { targetType: 'ChatMemoryPlan' },
    { targetType: 'ChatMemoryService' }
  ];

  private deps: {
    channelManager?: ChannelManager;
    topicAnalysisModel?: TopicAnalysisModel;
    subjectsPlan?: SubjectsPlan;
    oneCore?: any;
    lLMManager?: any;  // LLMManager for TopicAnalyzer (camelCase matches setDependency)
    leuteModel?: any;
    auditService?: any;
    embeddingProvider?: EmbeddingProvider;  // For ChatMemoryService semantic search
    meaningDimension?: MeaningDimensionLike;  // For cube-based HNSW indexing
  } = {};

  // TopicAnalyzer instance for LLM-based keyword extraction
  private topicAnalyzer?: TopicAnalyzer;

  // Memory plans and services
  // NOTE: memoryPlan implements ui.core's MemoryPlan interface, NOT memory.core's MemoryPlan class
  public memoryPlan!: UIMemoryPlan;
  private coreMemoryPlan!: CoreMemoryPlan;
  public chatMemoryPlan!: ChatMemoryPlan;
  public chatMemoryService!: ChatMemoryService;
  private memoryExportPlan?: MemoryExportPlan;
  private memoryImportPlan?: MemoryImportPlan;

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('MemoryModule missing required dependencies');
    }

    console.log('[MemoryModule] Initializing memory module...');

    const { channelManager, topicAnalysisModel, subjectsPlan, oneCore, lLMManager, embeddingProvider, meaningDimension } = this.deps;

    // Create TopicAnalyzer with LLMManager for keyword extraction
    // TopicAnalyzer uses LLM to extract keywords from chat messages
    if (lLMManager) {
      this.topicAnalyzer = new TopicAnalyzer(lLMManager);
      console.log('[MemoryModule] ✅ TopicAnalyzer created with LLMManager for keyword extraction');
    } else {
      console.warn('[MemoryModule] ⚠️ No LLMManager available - memory extraction will use fallback');
    }

    // Log embedding provider status
    if (embeddingProvider) {
      console.log(`[MemoryModule] ✅ EmbeddingProvider available (${embeddingProvider.model}) for semantic search`);
    } else {
      console.log('[MemoryModule] ℹ️ No EmbeddingProvider - using keyword-based memory search');
    }

    // Log MeaningDimension status for HNSW-based semantic indexing
    if (meaningDimension) {
      console.log(`[MemoryModule] ✅ MeaningDimension available (${meaningDimension.getIndexSize()} items indexed) for cube-based search`);
    } else {
      console.log('[MemoryModule] ℹ️ No MeaningDimension - subjects will not be indexed in cube');
    }

    // Create ChatMemoryService with all dependencies
    // Pass topicAnalyzer (with extractKeywords) for LLM-based extraction
    // Pass embeddingProvider for semantic similarity search
    this.chatMemoryService = new ChatMemoryService({
      nodeOneCore: oneCore,
      topicAnalyzer: this.topicAnalyzer,  // Use TopicAnalyzer service, not TopicAnalysisModel
      memoryPlan: undefined, // Will be set after CoreMemoryPlan is created
      storeVersionedObject,
      getObjectByIdHash,
      embeddingProvider  // For semantic memory search
    });

    // Create core MemoryPlan with dependencies
    this.coreMemoryPlan = new CoreMemoryPlan({
      storeVersionedObject,
      getObjectByIdHash,
      getInstanceOwner: async () => {
        // Get instance owner from oneCore
        const { getInstanceOwnerIdHash } = await import('@refinio/one.core/lib/instance.js');
        return getInstanceOwnerIdHash();
      },
      subjectsPlan: {
        addMemoryToSubject: subjectsPlan!.addMemoryToSubject.bind(subjectsPlan)
      }
    });

    // Create adapter for ChatMemoryService that wraps TopicAnalysisModel
    // Provides: createSubject, listSubjects, getSubject
    const memoryPlanAdapter = {
      // Store created subjects for retrieval
      _createdSubjects: new Map<string, any>(),

      async createSubject(params: { id: string; name: string; description?: string; metadata?: Map<string, string>; sign?: boolean; theme?: string }) {
        // Extract topic ID and keywords from the chat-scoped id (format: chat-{topicId}-{name})
        const match = params.id.match(/^chat-([a-f0-9]+)-(.+)$/);
        const topicId = match?.[1] || '';
        const subjectName = params.name || match?.[2] || '';

        // Extract keywords from name (space-separated)
        const keywordTerms = subjectName.split(/\s+/).filter(k => k.length > 0);
        const keywordCombination = keywordTerms.join('+');

        // Get confidence from metadata or default
        const confidence = parseFloat(params.metadata?.get('confidence') || '0.5');

        console.log('[MemoryModule] Creating subject via TopicAnalysisModel:', { topicId, keywordTerms, subjectName });

        try {
          const result = await topicAnalysisModel!.createSubject(
            topicId,
            keywordTerms,
            keywordCombination,
            params.description || subjectName,
            confidence
          );

          // Store for later retrieval
          const idHash = result.idHash || result.hash || '';
          this._createdSubjects.set(idHash, {
            ...result,
            name: subjectName,
            keywords: keywordTerms,
            description: params.description || subjectName
          });

          // Index subject in MeaningDimension for cube-based semantic search
          if (meaningDimension && idHash) {
            const textToIndex = params.description || subjectName;
            try {
              await meaningDimension.indexText(idHash as SHA256Hash, textToIndex);
              console.log('[MemoryModule] ✅ Subject indexed in MeaningDimension:', subjectName);
            } catch (indexError) {
              // Log but don't fail - MeaningDimension indexing is optional enhancement
              console.warn('[MemoryModule] ⚠️ Failed to index subject in MeaningDimension:', indexError);
            }
          }

          return {
            idHash,
            hash: result.hash || result.idHash || '',
            filePath: ''
          };
        } catch (error) {
          console.error('[MemoryModule] createSubject error:', error);
          throw error;
        }
      },

      async listSubjects(): Promise<string[]> {
        // Get all subjects from TopicAnalysisModel across all topics
        try {
          const allSubjects = await topicAnalysisModel!.getAllSubjects();
          const idHashes: string[] = [];

          for (const subject of allSubjects) {
            // Calculate idHash for each subject
            const idHash = await calculateIdHashOfObj(subject);
            if (idHash) {
              idHashes.push(idHash);
              // Cache for getSubject
              this._createdSubjects.set(idHash, subject);
            }
          }

          // Also include any subjects we created in this session
          for (const idHash of this._createdSubjects.keys()) {
            if (!idHashes.includes(idHash)) {
              idHashes.push(idHash);
            }
          }

          console.log('[MemoryModule] listSubjects found:', idHashes.length);
          return idHashes;
        } catch (error) {
          console.error('[MemoryModule] listSubjects error:', error);
          return [];
        }
      },

      async getSubject(idHash: string): Promise<any> {
        // Helper to transform subject to ChatMemoryService-compatible format
        const transformSubject = (subject: any): any => {
          if (!subject) return null;

          // Create metadata Map with keywords for ChatMemoryService
          const metadata = new Map<string, string>();

          // Get keyword terms from the subject
          // Subject stores keywords as array of terms (from our createSubject adapter)
          // or as array of idHashes (from TopicAnalysisModel)
          let keywordTerms: string[] = [];
          if (subject.keywords && Array.isArray(subject.keywords)) {
            // Check if keywords are already terms (strings that aren't hashes)
            const firstKeyword = subject.keywords[0];
            if (firstKeyword && firstKeyword.length < 64 && !firstKeyword.match(/^[a-f0-9]{64}$/)) {
              // Keywords are already terms
              keywordTerms = subject.keywords;
            } else {
              // Keywords are idHashes - use name or description to extract terms
              if (subject.name) {
                keywordTerms = subject.name.split(/\s+/).filter((k: string) => k.length > 0);
              } else if (subject.description) {
                keywordTerms = subject.description.split(/\s+/).slice(0, 5);
              }
            }
          }

          metadata.set('keywords', keywordTerms.join(','));
          metadata.set('confidence', String(subject.confidence || 0.5));

          return {
            ...subject,
            name: subject.name || subject.description?.split('.')[0] || 'Untitled',
            metadata,
            created: subject.createdAt || Date.now(),
            modified: subject.lastSeenAt || subject.createdAt || Date.now()
          };
        };

        // First check our cache
        if (this._createdSubjects.has(idHash)) {
          return transformSubject(this._createdSubjects.get(idHash));
        }

        // Try to fetch from ONE.core storage
        try {
          const result = await getObjectByIdHash(idHash as any);
          if (result?.obj) {
            const subject = result.obj;
            // Cache for future lookups
            this._createdSubjects.set(idHash, subject);
            return transformSubject(subject);
          }
        } catch (error) {
          console.error('[MemoryModule] getSubject error for', idHash, ':', error);
        }

        return null;
      }
    };

    // Wire up ChatMemoryService with adapter
    (this.chatMemoryService as any).deps.memoryPlan = memoryPlanAdapter;

    // Create ChatMemoryPlan with ChatMemoryService
    this.chatMemoryPlan = new ChatMemoryPlan({
      chatMemoryService: this.chatMemoryService
    });

    // Create export/import plans if optional dependencies are available
    if (this.deps.leuteModel && this.deps.auditService) {
      this.memoryExportPlan = new MemoryExportPlan({
        implode: async (hash) => {
          const { implode } = await import('@refinio/one.core/lib/microdata-imploder.js');
          return implode(hash);
        },
        leuteModel: this.deps.leuteModel,
        auditService: this.deps.auditService,
        createCryptoApi: async (owner) => {
          const { createCryptoApiFromDefaultKeys } = await import('@refinio/one.core/lib/keychain/keychain.js');
          return createCryptoApiFromDefaultKeys(owner);
        }
      });

      this.memoryImportPlan = new MemoryImportPlan({
        explode: async (html, expectedType) => {
          const { explode } = await import('@refinio/one.core/lib/microdata-exploder.js');
          return explode(html, expectedType as any);
        },
        storeVersionedObject,
        trustedKeysManager: this.deps.leuteModel.trustedKeysManager,
        auditService: this.deps.auditService,
        leuteModel: this.deps.leuteModel,
        onUnknownSigner: async () => false // Reject unknown signers by default
      });
    }

    // Create the UI-compatible memoryPlan adapter
    // This implements ui.core's MemoryPlan interface
    this.memoryPlan = this.createUIMemoryPlan(
      topicAnalysisModel!,
      this.chatMemoryService,
      memoryPlanAdapter,
      meaningDimension
    );

    console.log('[MemoryModule] Initialized');
  }

  /**
   * Create a MemoryPlan that implements ui.core's MemoryPlan interface
   * This adapter bridges memory.core classes with the UI expectations
   */
  private createUIMemoryPlan(
    topicAnalysisModel: TopicAnalysisModel,
    chatMemoryService: ChatMemoryService,
    memoryPlanAdapter: { _createdSubjects: Map<string, any> },
    meaningDimension?: MeaningDimensionLike
  ): UIMemoryPlan {
    return {
      // Status and toggle methods delegate to chatMemoryService
      async getStatus(params: { topicId: string }) {
        try {
          const enabled = chatMemoryService.isEnabled(params.topicId as any);
          const config = chatMemoryService.getConfig(params.topicId as any);
          return { enabled, config };
        } catch {
          return { enabled: false };
        }
      },

      async toggle(params: { topicId: string }) {
        const isEnabled = chatMemoryService.isEnabled(params.topicId as any);
        if (isEnabled) {
          await chatMemoryService.disableMemories(params.topicId as any);
          return { enabled: false };
        } else {
          await chatMemoryService.enableMemories(params.topicId as any, {});
          return { enabled: true };
        }
      },

      async enable(params: { topicId: string; autoExtract?: boolean; keywords?: string[] }) {
        const config = await chatMemoryService.enableMemories(
          params.topicId as any,
          {
            autoExtract: params.autoExtract ?? true,
            keywords: params.keywords ?? []
          }
        );
        return { enabled: true, config };
      },

      async disable(params: { topicId: string }) {
        await chatMemoryService.disableMemories(params.topicId as any);
        return { enabled: false };
      },

      async extract(params: { topicId: string; limit?: number }) {
        const result = await chatMemoryService.extractAndStoreSubjects({
          topicId: params.topicId as any,
          limit: params.limit ?? 50
        });
        return {
          subjects: result.subjects.map(s => ({
            id: s.name.toLowerCase().replace(/\s+/g, '-'),
            description: s.description || s.name,
            keywords: s.keywords,
            createdAt: Date.now(),
            lastSeenAt: Date.now()
          })),
          totalMessages: result.totalMessages,
          processingTime: result.processingTime
        };
      },

      async find(params: { topicId?: string; keywords: string[]; limit?: number }) {
        const limit = params.limit ?? 10;

        // Try semantic search via MeaningDimension first (HNSW-indexed)
        if (meaningDimension && meaningDimension.getIndexSize() > 0) {
          const queryText = params.keywords.join(' ');
          try {
            const semanticResults = await meaningDimension.queryByText(queryText, limit, 0.3);
            if (semanticResults.length > 0) {
              console.log(`[MemoryModule] Semantic search found ${semanticResults.length} results`);

              // Enrich results with subject data from cache
              const enrichedMemories = await Promise.all(semanticResults.map(async (r) => {
                const cached = memoryPlanAdapter._createdSubjects.get(r.objectHash);
                return {
                  id: r.objectHash,
                  idHash: r.objectHash,
                  description: cached?.description || cached?.name || 'Memory',
                  keywords: cached?.keywords || [],
                  relevanceScore: r.similarity
                };
              }));

              return {
                memories: enrichedMemories,
                searchKeywords: params.keywords,
                totalFound: semanticResults.length
              };
            }
          } catch (searchError) {
            console.warn('[MemoryModule] MeaningDimension search failed, falling back to keyword search:', searchError);
          }
        }

        // Fall back to keyword-based search via ChatMemoryService
        const result = await chatMemoryService.findRelatedMemories({
          keywords: params.keywords,
          limit,
          minRelevance: 0.3
        });
        return {
          memories: result.memories.map(m => ({
            id: m.subjectIdHash,
            idHash: m.subjectIdHash,
            description: m.name,
            keywords: m.keywords,
            relevanceScore: m.relevanceScore
          })),
          searchKeywords: result.searchKeywords,
          totalFound: result.totalFound
        };
      },

      // Journal methods use topicAnalysisModel directly
      async listJournal(params?: { limit?: number }) {
        const topics = await topicAnalysisModel.getAllTopics();
        const allSubjects: any[] = [];

        // Build a map of keyword IdHash -> term for resolving keyword references
        const keywordTermMap = new Map<string, string>();

        for (const topicId of topics) {
          const subjects = await topicAnalysisModel.getSubjects(topicId);
          for (const subject of subjects) {
            (subject as any)._sourceTopicId = topicId;
          }
          allSubjects.push(...subjects);

          // Get keywords for this topic and build the term map
          const keywords = await topicAnalysisModel.getKeywords(topicId);
          for (const keyword of keywords) {
            const keywordIdHash = await calculateIdHashOfObj(keyword);
            if (keywordIdHash && keyword.term) {
              keywordTermMap.set(keywordIdHash, keyword.term);
            }
          }
        }

        // Map subjects to journal entry format
        const entries = await Promise.all(allSubjects.map(async (subject: any) => {
          const idHash = await calculateIdHashOfObj(subject);

          // Resolve keyword IdHashes to actual term strings
          const keywordTerms: string[] = [];
          if (subject.keywords && Array.isArray(subject.keywords)) {
            for (const keywordIdHash of subject.keywords) {
              const term = keywordTermMap.get(keywordIdHash);
              if (term) {
                keywordTerms.push(term);
              }
            }
          }

          return {
            idHash: idHash || '',
            id: idHash || '',
            name: subject.description?.split('.')[0] || 'Untitled',
            description: subject.description || '',
            created: subject.createdAt || 0,
            modified: subject.lastSeenAt || 0,
            topic: subject._sourceTopicId || subject.topics?.[0] || '',
            keywords: keywordTerms,
            metadata: {
              abstractionLevel: subject.abstractionLevel || 0
            }
          };
        }));

        // Sort by most recent first
        entries.sort((a: any, b: any) => {
          const aTime = a.modified || a.created || 0;
          const bTime = b.modified || b.created || 0;
          return bTime - aTime;
        });

        const limited = params?.limit ? entries.slice(0, params.limit) : entries;
        return { entries: limited, total: entries.length };
      },

      async getJournalEntry(params: { idHash: string }) {
        const topics = await topicAnalysisModel.getAllTopics();
        const allSubjects: any[] = [];

        for (const topicId of topics) {
          const subjects = await topicAnalysisModel.getSubjects(topicId);
          allSubjects.push(...subjects);
        }

        let foundSubject: any = null;
        for (const subject of allSubjects) {
          const idHash = await calculateIdHashOfObj(subject);
          if (idHash === params.idHash) {
            foundSubject = subject;
            break;
          }
        }

        if (!foundSubject) {
          return null;
        }

        return {
          idHash: params.idHash,
          id: params.idHash,
          name: foundSubject.description?.split('.')[0] || 'Untitled',
          description: foundSubject.description || '',
          created: 0,
          modified: 0,
          topic: foundSubject.topics?.[0] || '',
          keywords: foundSubject.keywords || [],
          metadata: { abstractionLevel: foundSubject.abstractionLevel || 0 },
          filePath: undefined,
          html: undefined
        };
      },

      // Knowledge graph builds from topicAnalysisModel
      async getKnowledgeGraph() {
        try {
          interface GraphNode {
            id: string;
            type: 'topic' | 'subject' | 'keyword';
            label: string;
            metadata?: Record<string, any>;
          }
          interface GraphEdge {
            source: string;
            target: string;
            type: string;
            weight?: number;
          }

          const nodes: GraphNode[] = [];
          const edges: GraphEdge[] = [];
          const keywordToNodes = new Map<string, string[]>();

          const topics = await topicAnalysisModel.getAllTopics();

          for (const topicId of topics) {
            // Get topic to retrieve display name
            const topic = await topicAnalysisModel.topicModel?.findTopic?.(topicId);
            const topicLabel = topic?.screenName || topic?.name || topicId;

            const topicNode: GraphNode = {
              id: `topic:${topicId}`,
              type: 'topic',
              label: topicLabel,
              metadata: { topicId }
            };

            const subjects = await topicAnalysisModel.getSubjects(topicId);
            const keywords = await topicAnalysisModel.getKeywords(topicId);
            const topicKeywords: string[] = [];

            for (let subjectIndex = 0; subjectIndex < subjects.length; subjectIndex++) {
              const subject = subjects[subjectIndex];
              const nodeId = `subject:${topicId}:${subjectIndex}`;
              const keywordTerms: string[] = [];

              for (const kw of keywords) {
                if (kw.term) {
                  keywordTerms.push(kw.term);
                  topicKeywords.push(kw.term);

                  if (!keywordToNodes.has(kw.term)) {
                    keywordToNodes.set(kw.term, []);
                  }
                  keywordToNodes.get(kw.term)!.push(nodeId);
                }
              }

              nodes.push({
                id: nodeId,
                type: 'subject',
                label: subject.description || 'Untitled Subject',
                metadata: {
                  createdAt: subject.createdAt,
                  topicId
                }
              });
            }

            topicNode.metadata = { ...topicNode.metadata, keywords: [...new Set(topicKeywords)] };
            nodes.push(topicNode);

            for (const kw of topicKeywords) {
              if (!keywordToNodes.has(kw)) {
                keywordToNodes.set(kw, []);
              }
              keywordToNodes.get(kw)!.push(topicNode.id);
            }
          }

          // Compute edges based on shared keywords
          const edgeSet = new Set<string>();
          for (const [, nodeIds] of keywordToNodes) {
            for (let i = 0; i < nodeIds.length; i++) {
              for (let j = i + 1; j < nodeIds.length; j++) {
                const edgeKey = [nodeIds[i], nodeIds[j]].sort().join('|');
                if (!edgeSet.has(edgeKey)) {
                  edgeSet.add(edgeKey);
                  edges.push({
                    source: nodeIds[i],
                    target: nodeIds[j],
                    type: 'shared_keyword',
                    weight: 1
                  });
                }
              }
            }
          }

          console.log(`[MemoryModule] Built knowledge graph: ${nodes.length} nodes, ${edges.length} edges`);
          return { success: true, data: { nodes, edges } };
        } catch (error) {
          console.error('[MemoryModule] getKnowledgeGraph error:', error);
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },

      // Memory export/import methods (delegate to memory.core plans)
      exportMemory: async (params: { hash: string; options?: any }) => {
        if (!this.memoryExportPlan) {
          throw new Error('Memory export not available - missing LeuteModel or AuditService');
        }
        const html = await this.memoryExportPlan.exportMemory(params.hash as any, params.options);
        return { success: true, html };
      },

      importMemory: async (params: { html: string }) => {
        if (!this.memoryImportPlan) {
          throw new Error('Memory import not available - missing LeuteModel or AuditService');
        }
        const result = await this.memoryImportPlan.importMemory(params.html);
        return {
          success: true,
          hash: result.hash,
          idHash: result.idHash,
          trustStatus: 'untrusted' as const
        };
      },

      previewImport: async (params: { html: string }) => {
        // Extract metadata from HTML without importing
        // Parse the signatureData meta tag
        const signatureMatch = params.html.match(/<meta\s+itemprop="signatureData"\s+content="([^"]+)"/);
        let signer: { personId: string; name?: string; signingKey: string; signedAt: number } | undefined;

        if (signatureMatch) {
          try {
            const decoded = JSON.parse(signatureMatch[1]
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&amp;/g, '&')
              .replace(/&quot;/g, '"'));
            signer = {
              personId: decoded.personId,
              name: decoded.name,
              signingKey: decoded.signingKey || '',
              signedAt: decoded.signedAt
            };
          } catch { /* ignore parse errors */ }
        }

        return {
          success: true,
          signer,
          signatureValid: !!signatureMatch
        };
      }
    };
  }

  async shutdown(): Promise<void> {
    console.log('[MemoryModule] Shutting down...');
    // No cleanup needed - memory plans are stateless
    console.log('[MemoryModule] Shutdown complete');
  }

  setDependency(targetType: string, instance: any): void {
    const key = targetType.charAt(0).toLowerCase() + targetType.slice(1);
    this.deps[key as keyof typeof this.deps] = instance;
  }

  emitSupplies(registry: any): void {
    registry.supply('MemoryPlan', this.memoryPlan);
    registry.supply('ChatMemoryPlan', this.chatMemoryPlan);
    registry.supply('ChatMemoryService', this.chatMemoryService);
  }

  private hasRequiredDeps(): boolean {
    return !!(
      this.deps.channelManager &&
      this.deps.topicAnalysisModel &&
      this.deps.subjectsPlan &&
      this.deps.oneCore &&
      this.deps.lLMManager
    );
  }
}
