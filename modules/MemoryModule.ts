// packages/lama.browser/browser-ui/src/modules/MemoryModule.ts
import type { Module } from '@refinio/api';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicAnalysisModel from '@lama/core/one-ai/models/TopicAnalysisModel.js';
import type { SubjectsPlan } from '@lama/core/plans/SubjectsPlan.js';
import type { MemoryPlan as UIMemoryPlan } from '@ui/core';

// ONE.core storage imports
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

// Memory.core imports
import { MemoryPlan as CoreMemoryPlan, ChatMemoryPlan, ChatMemoryService } from '@memory/core';

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
    { targetType: 'OneCore', required: true }
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
  } = {};

  // Memory plans and services
  // NOTE: memoryPlan implements ui.core's MemoryPlan interface, NOT memory.core's MemoryPlan class
  public memoryPlan!: UIMemoryPlan;
  private coreMemoryPlan!: CoreMemoryPlan;
  public chatMemoryPlan!: ChatMemoryPlan;
  public chatMemoryService!: ChatMemoryService;

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('MemoryModule missing required dependencies');
    }

    console.log('[MemoryModule] Initializing memory module...');

    const { channelManager, topicAnalysisModel, subjectsPlan, oneCore } = this.deps;

    // Create ChatMemoryService with all dependencies
    this.chatMemoryService = new ChatMemoryService({
      nodeOneCore: oneCore,
      topicAnalyzer: topicAnalysisModel,
      memoryPlan: undefined, // Will be set after CoreMemoryPlan is created
      storeVersionedObject,
      getObjectByIdHash
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

    // Wire up ChatMemoryService with CoreMemoryPlan
    (this.chatMemoryService as any).deps.memoryPlan = this.coreMemoryPlan;

    // Create ChatMemoryPlan with ChatMemoryService
    this.chatMemoryPlan = new ChatMemoryPlan({
      chatMemoryService: this.chatMemoryService
    });

    // Create the UI-compatible memoryPlan adapter
    // This implements ui.core's MemoryPlan interface
    this.memoryPlan = this.createUIMemoryPlan(topicAnalysisModel!, this.chatMemoryService);

    console.log('[MemoryModule] Initialized');
  }

  /**
   * Create a MemoryPlan that implements ui.core's MemoryPlan interface
   * This adapter bridges memory.core classes with the UI expectations
   */
  private createUIMemoryPlan(
    topicAnalysisModel: TopicAnalysisModel,
    chatMemoryService: ChatMemoryService
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
        const result = await chatMemoryService.findRelatedMemories({
          keywords: params.keywords,
          limit: params.limit ?? 10,
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
            const topicNode: GraphNode = {
              id: `topic:${topicId}`,
              type: 'topic',
              label: topicId.length > 20 ? topicId.substring(0, 20) + '...' : topicId,
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
      this.deps.oneCore
    );
  }
}
