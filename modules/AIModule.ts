// packages/lama.browser/browser-ui/src/modules/AIModule.ts
import type { Module } from '@refinio/api';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type PropertyTreeStore from '@refinio/one.models/lib/models/SettingsModel.js';
import type TopicGroupManager from '@chat/core/models/TopicGroupManager.js';
import type { TrustPlan } from '@trust/core/plans/TrustPlan.js';

// ONE.core storage imports
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getIdObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObject, storeUnversionedObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';

// Assembly/Story imports for journal tracking
import { StoryFactory } from '@refinio/api/plan-system';
import { getAllEntries } from '@refinio/one.core/lib/reverse-map-query.js';
import { createAccess } from '@refinio/one.core/lib/access.js';
import { createDefaultKeys, hasDefaultKeys } from '@refinio/one.core/lib/keychain/keychain.js';

// LAMA core plans (platform-agnostic business logic - AI-related)
import { AIPlan } from '@lama/core/plans/AIPlan.js';
import { AIAssistantPlan } from '@lama/core/plans/AIAssistantPlan.js';
import { TopicAnalysisPlan } from '@lama/core/plans/TopicAnalysisPlan.js';
import { ProposalsPlan } from '@lama/core/plans/ProposalsPlan.js';
import { KeywordDetailPlan } from '@lama/core/plans/KeywordDetailPlan.js';
import { WordCloudSettingsPlan } from '@lama/core/plans/WordCloudSettingsPlan.js';
import { LLMConfigPlan } from '@lama/core/plans/LLMConfigPlan.js';
import { CryptoPlan } from '@lama/core/plans/CryptoPlan.js';
import { AuditPlan } from '@lama/core/plans/AuditPlan.js';
import { SubjectsPlan } from '@lama/core/plans/SubjectsPlan.js';
import { CubePlan } from '@lama/core/plans/CubePlan.js';

// LAMA core AI models (message listener)
import { AIMessageListener } from '@lama/core/models/ai/index.js';

// LAMA core models (LLM and AI object management)
import { LLMObjectManager } from '@lama/core/models/LLMObjectManager.js';
import { AIObjectManager } from '@lama/core/models/AIObjectManager.js';
import { AISettingsManager } from '@lama/core/models/settings/AISettingsManager.js';

// Proposal services
import { ProposalEngine } from '@lama/core/services/proposal-engine.js';
import { ProposalRanker } from '@lama/core/services/proposal-ranker.js';
import { ProposalCache } from '@lama/core/services/proposal-cache.js';

// LAMA core services
import { LLMManager } from '@lama/core/services/llm-manager.js';
import type { LLMPlatform } from '@lama/core/services/llm-platform.js';
import { AIToolExecutor, type AIToolExecutorDeps } from '@lama/core/services/AIToolExecutor.js';

/**
 * Platform-specific LLM configuration interface
 * Platforms implement this to provide validator and config manager
 */
export interface LLMConfigAdapter {
  ollamaValidator: {
    testOllamaConnection: (server: string, authToken?: string, serviceName?: string) => Promise<any>;
    fetchOllamaModels: (server: string, authToken?: string) => Promise<any[]>;
  };
  configManager: {
    encryptToken: (token: string) => string;
    decryptToken: (encrypted: string) => string;
    computeBaseUrl: (modelType: string, baseUrl?: string) => string;
    isEncryptionAvailable: () => boolean;
  };
}

/**
 * AIModule - AI and LLM functionality
 *
 * Provides:
 * - AI Plans (AIPlan, AIAssistantPlan, etc.)
 * - LLM management
 * - Topic analysis
 * - Proposals
 *
 * Platform-agnostic - requires LLMPlatform and LLMConfigAdapter injection
 */
export class AIModule implements Module {
  readonly name = 'AIModule';

  static demands = [
    { targetType: 'LeuteModel', required: true },
    { targetType: 'ChannelManager', required: true },
    { targetType: 'TopicModel', required: true },
    { targetType: 'Settings', required: true },
    { targetType: 'TopicGroupManager', required: true },
    { targetType: 'TrustPlan', required: true },
    { targetType: 'JournalPlan', required: true },
    { targetType: 'OneCore', required: true },
    { targetType: 'TopicAnalysisModel', required: true },
    { targetType: 'StoryFactory', required: true }
  ];

  static supplies = [
    { targetType: 'AIPlan' },
    { targetType: 'AIAssistantPlan' },
    { targetType: 'TopicAnalysisPlan' },
    { targetType: 'LLMConfigPlan' },
    { targetType: 'ProposalsPlan' },
    { targetType: 'KeywordDetailPlan' },
    { targetType: 'WordCloudSettingsPlan' },
    { targetType: 'CryptoPlan' },
    { targetType: 'AuditPlan' },
    { targetType: 'SubjectsPlan' },
    { targetType: 'LLMManager' },
    { targetType: 'LLMObjectManager' },
    { targetType: 'AIObjectManager' },
    { targetType: 'AISettingsManager' },
    { targetType: 'AIMessageListener' }
  ];

  private deps: {
    leuteModel?: LeuteModel;
    channelManager?: ChannelManager;
    topicModel?: TopicModel;
    settings?: PropertyTreeStore;
    topicGroupManager?: TopicGroupManager;
    trustPlan?: TrustPlan;
    oneCore?: any;
    topicAnalysisModel?: any;
    storyFactory?: StoryFactory;
  } = {};

  // AI Plans
  public aiPlan!: AIPlan;
  public aiAssistantPlan!: AIAssistantPlan;
  public topicAnalysisPlan!: TopicAnalysisPlan;
  public llmConfigPlan!: LLMConfigPlan;
  public proposalsPlan!: ProposalsPlan;
  public keywordDetailPlan!: KeywordDetailPlan;
  public wordCloudSettingsPlan!: WordCloudSettingsPlan;
  public cryptoPlan!: CryptoPlan;
  public auditPlan!: AuditPlan;
  public subjectsPlan!: SubjectsPlan;

  // AI Models and Services
  public llmManager!: LLMManager;
  public llmObjectManager!: LLMObjectManager;
  public aiObjectManager!: AIObjectManager;
  public aiSettingsManager!: AISettingsManager;
  public aiMessageListener: AIMessageListener | null = null;

  // Cube storage and plan
  public cubeStorage: any = null;
  public cubePlan: CubePlan | null = null;

  // Tool executor for unified AI tool access
  public toolExecutor: AIToolExecutor | null = null;

  /**
   * Constructor - inject platform-specific dependencies
   * @param llmPlatform - Platform-specific LLM event emitter (Electron, Browser, etc.)
   * @param llmConfigAdapter - Platform-specific LLM configuration (validator, encryption)
   */
  constructor(
    private llmPlatform: LLMPlatform,
    private llmConfigAdapter: LLMConfigAdapter
  ) {}

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('AIModule missing required dependencies');
    }

    console.log('[AIModule] Initializing AI module...');

    const { leuteModel, channelManager, topicModel, settings, topicGroupManager, trustPlan, oneCore } = this.deps;

    // LLM management - uses injected platform
    this.llmManager = new LLMManager(this.llmPlatform);

    // Set channelManager on llmManager for LLM storage access
    this.llmManager.channelManager = channelManager;

    // Discover and register installed local models (if platform supports it)
    if (this.llmPlatform.getInstalledTextGenModels) {
      try {
        console.log('[AIModule] Discovering installed local text-generation models...');
        const installedModels = await this.llmPlatform.getInstalledTextGenModels();
        if (installedModels.length > 0) {
          await this.llmManager.discoverLocalModels(installedModels);
          console.log(`[AIModule] Registered ${installedModels.length} local models in ONE.core storage`);
        } else {
          console.log('[AIModule] No installed local models found');
        }
      } catch (error) {
        console.warn('[AIModule] Local model discovery failed (non-fatal):', error);
      }
    }

    // Capture 'this' for closures
    const that = this;

    // LLMObjectManager - platform-agnostic LLM object management using ONE.core abstractions
    this.llmObjectManager = new LLMObjectManager(
      {
        storeVersionedObject,
        createAccess: async (accessRequests: any[]) => {
          // Wrap createAccess to match expected void return type
          await createAccess(accessRequests);
        },
        queryAllLLMObjects: async function* () {
          // Query all LLM objects from storage using reverse map
          // This is needed to restore AI contacts on reload
          console.log('[AIModule/queryAllLLMObjects] Querying LLM objects...');
          const myId = await leuteModel!.myMainIdentity();
          console.log(`[AIModule/queryAllLLMObjects] Got owner ID: ${myId.substring(0, 8)}...`);

          const llmEntries = await getAllEntries(myId, 'LLM' as any);
          console.log(`[AIModule/queryAllLLMObjects] Found ${llmEntries.length} LLM entries`);

          for (const entry of llmEntries) {
            const objectHash = (entry as any).obj || (entry as any).hash || entry;
            const llmObject = await getObject(objectHash);
            if (llmObject && llmObject.$type$ === 'LLM') {
              console.log(`[AIModule/queryAllLLMObjects] Yielding LLM object: ${llmObject.name}`);
              yield llmObject;
            }
          }
          console.log(`[AIModule/queryAllLLMObjects] Query complete`);
        },
        getOwnerId: async () => {
          return await leuteModel!.myMainIdentity();
        }
      }
      // No federation group for browser (optional parameter)
    );

    // AIObjectManager - platform-agnostic AI object management
    this.aiObjectManager = new AIObjectManager(
      {
        storeVersionedObject,
        createAccess: async (accessRequests: any[]) => {
          // Wrap createAccess to match expected void return type
          await createAccess(accessRequests);
        },
        getOwnerId: async () => {
          return await leuteModel!.myMainIdentity();
        }
      }
    );

    // AI Settings Manager for user preferences
    this.aiSettingsManager = new AISettingsManager(oneCore!);

    // LAMA Plans (AI-related)
    this.aiPlan = new AIPlan(oneCore!);

    // AI Assistant Plan with all dependencies ready
    this.aiAssistantPlan = new AIAssistantPlan({
      oneCore: oneCore!,
      channelManager: channelManager!,
      topicModel: topicModel!,
      leuteModel: leuteModel!,
      llmManager: this.llmManager,
      platform: this.llmPlatform,
      stateManager: undefined, // Optional - not used in browser
      llmObjectManager: this.llmObjectManager, // Platform-agnostic LLM object manager
      contextEnrichmentService: undefined, // Optional - not used in browser
      topicAnalysisModel: undefined, // Will be set during init()
      topicGroupManager: topicGroupManager!,
      aiSettingsManager: this.aiSettingsManager,
      localModelLookup: this.llmPlatform.lookupLocalModel?.bind(this.llmPlatform),
      storageDeps: {
        storeVersionedObject,
        storeUnversionedObject,
        getIdObject,
        getObjectByIdHash,
        getObject,
        createDefaultKeys,
        hasDefaultKeys,
        channelManager: channelManager!,    // Required: for querying LLM objects
        trustPlan: trustPlan!              // For assigning 'high' trust to AI contacts
      }
    });

    // Create LLMConfigPlan with settings for secure API key storage
    // Settings uses ONE.core's master key encryption automatically
    this.llmConfigPlan = new LLMConfigPlan(
      oneCore!,
      this.aiAssistantPlan,
      this.llmManager,
      settings!, // ONE.core SettingsModel (encrypted storage)
      this.llmConfigAdapter.ollamaValidator
    );

    // Set llmConfigPlan on aiAssistantPlan for settings persistence
    (this.aiAssistantPlan as any).llmConfigPlan = this.llmConfigPlan;

    // CRITICAL: Inject topicAnalysisModel into AIAssistantPlan (injected by ModuleRegistry)
    console.log('[AIModule] Injecting topicAnalysisModel into AIAssistantPlan.deps');
    (this.aiAssistantPlan as any).deps.topicAnalysisModel = this.deps.topicAnalysisModel;

    // Also inject into messageProcessor for backwards compatibility
    if ((this.aiAssistantPlan as any).messageProcessor) {
      ((this.aiAssistantPlan as any).messageProcessor as any).topicAnalysisModel = this.deps.topicAnalysisModel;
    }

    // CRITICAL: Inject topicAnalysisModel into taskManager so analysis can be processed
    if ((this.aiAssistantPlan as any).taskManager) {
      console.log('[AIModule] Injecting topicAnalysisModel into AITaskManager');
      ((this.aiAssistantPlan as any).taskManager as any).topicAnalysisModel = this.deps.topicAnalysisModel;
    }

    // CRITICAL: Wire up StoryFactory BEFORE init() so AI contact creation is tracked in journal
    // AIManager.createAI() is called during init() and needs StoryFactory to create Assemblies
    // Use the shared StoryFactory from ModuleRegistry so all modules share the same instance
    const { storyFactory } = this.deps;
    if (!storyFactory) {
      throw new Error('AIModule requires StoryFactory from ModuleRegistry');
    }
    await this.aiAssistantPlan.setStoryFactory(storyFactory);
    console.log('[AIModule] Using shared StoryFactory from ModuleRegistry');

    // CRITICAL: Initialize AIAssistantPlan now that all dependencies are injected
    console.log('[AIModule] Initializing AIAssistantPlan...');
    await this.aiAssistantPlan.init();
    console.log('[AIModule] AIAssistantPlan initialized');

    // CRITICAL: Set aiAssistantModel on oneCore so LLMConfigPlan can access it dynamically
    // LLMConfigPlan accesses it via this.nodeOneCore.aiAssistantModel
    console.log('[AIModule] Setting aiAssistantModel on oneCore for dynamic access');
    (oneCore as any).aiAssistantModel = this.aiAssistantPlan;

    // topicAnalysisPlan, proposalsPlan will be created after topicAnalysisModel is ready
    // Note: These plans have optional dependencies that will be set later via initTopicAnalysis
    this.keywordDetailPlan = new KeywordDetailPlan(oneCore!, undefined, undefined, undefined);
    this.wordCloudSettingsPlan = new WordCloudSettingsPlan(oneCore!, undefined, undefined);
    this.cryptoPlan = new CryptoPlan(oneCore!);
    this.auditPlan = new AuditPlan(undefined, undefined, undefined);

    // Subjects plan for managing memory/topics/keywords (uses TopicAnalysisModel)
    this.subjectsPlan = new SubjectsPlan();

    console.log('[AIModule] Initialized');
  }

  /**
   * Post-initialization step to create analysis-dependent plans
   * Called after module initialization completes
   */
  async initTopicAnalysis(cubeStorage?: any): Promise<void> {
    const { topicModel, oneCore, topicAnalysisModel } = this.deps;

    console.log('[AIModule] Creating analysis-dependent plans...');

    // Store cubeStorage for external access
    this.cubeStorage = cubeStorage;

    // Create CubePlan if cubeStorage is provided
    if (cubeStorage) {
      this.cubePlan = new CubePlan({ cubeStorage, oneCore: oneCore! });
      console.log('[AIModule] CubePlan created');
    }

    // Wire up SubjectsPlan with TopicAnalysisModel (injected by ModuleRegistry)
    this.subjectsPlan.setModel(topicAnalysisModel);

    // Create TopicAnalysisPlan now that topicAnalysisModel is ready
    this.topicAnalysisPlan = new TopicAnalysisPlan(
      topicAnalysisModel,
      topicModel!,
      this.llmManager,
      oneCore!, // nodeOneCore
      cubeStorage
    );

    // Create ProposalsPlan with all dependencies
    const proposalEngine = new ProposalEngine(topicAnalysisModel);
    const proposalRanker = new ProposalRanker();
    const proposalCache = new ProposalCache();
    this.proposalsPlan = new ProposalsPlan(
      oneCore!, // nodeOneCore
      topicAnalysisModel,
      proposalEngine,
      proposalRanker,
      proposalCache
    );
    console.log('[AIModule] ProposalsPlan initialized');

    // Initialize AIPlan with all dependencies
    console.log('[AIModule] Initializing AIPlan with dependencies...');
    this.aiPlan.setModels(
      this.llmManager,
      this.aiAssistantPlan,
      topicModel!,
      oneCore!, // nodeOneCore
      undefined // stateManager (not used in browser)
    );
    console.log('[AIModule] AIPlan initialized');
  }

  /**
   * Start the AI message listener after login
   * Called after all initialization is complete
   */
  async startMessageListener(ownerId: string): Promise<void> {
    const { channelManager, topicModel } = this.deps;

    console.log('[AIModule] Creating and starting AIMessageListener...');
    this.aiMessageListener = new AIMessageListener({
      channelManager: channelManager!,
      topicModel: topicModel!,
      aiPlan: this.aiAssistantPlan,
      ownerId: ownerId as any
    });
    await this.aiMessageListener.start();
    console.log('[AIModule] AIMessageListener started');
  }

  /**
   * Initialize the AI tool executor for unified tool access
   * Call this after mcpManager is available (from platform code)
   *
   * @param deps - Tool executor dependencies (planRouter, mcpManager, etc.)
   */
  initToolExecutor(deps: AIToolExecutorDeps): void {
    console.log('[AIModule] Initializing AIToolExecutor...');

    this.toolExecutor = new AIToolExecutor(deps);
    this.llmManager.setToolExecutor(this.toolExecutor);

    console.log('[AIModule] AIToolExecutor initialized and wired to LLMManager');
  }

  async shutdown(): Promise<void> {
    console.log('[AIModule] Shutting down...');

    // Stop the message listener
    try {
      await this.aiMessageListener?.stop?.();
    } catch (error) {
      console.error('[AIModule] Shutdown error (AIMessageListener):', error);
    }

    console.log('[AIModule] Shutdown complete');
  }

  setDependency(targetType: string, instance: any): void {
    const key = targetType.charAt(0).toLowerCase() + targetType.slice(1);
    this.deps[key as keyof typeof this.deps] = instance;
  }

  emitSupplies(registry: any): void {
    registry.supply('AIPlan', this.aiPlan);
    registry.supply('AIAssistantPlan', this.aiAssistantPlan);
    registry.supply('TopicAnalysisPlan', this.topicAnalysisPlan);
    registry.supply('LLMConfigPlan', this.llmConfigPlan);
    registry.supply('ProposalsPlan', this.proposalsPlan);
    registry.supply('KeywordDetailPlan', this.keywordDetailPlan);
    registry.supply('WordCloudSettingsPlan', this.wordCloudSettingsPlan);
    registry.supply('CryptoPlan', this.cryptoPlan);
    registry.supply('AuditPlan', this.auditPlan);
    registry.supply('SubjectsPlan', this.subjectsPlan);
    registry.supply('LLMManager', this.llmManager);
    registry.supply('LLMObjectManager', this.llmObjectManager);
    registry.supply('AIObjectManager', this.aiObjectManager);
    registry.supply('AISettingsManager', this.aiSettingsManager);
    registry.supply('AIMessageListener', this.aiMessageListener);
  }

  private hasRequiredDeps(): boolean {
    return !!(
      this.deps.leuteModel &&
      this.deps.channelManager &&
      this.deps.topicModel &&
      this.deps.settings &&
      this.deps.topicGroupManager &&
      this.deps.trustPlan &&
      this.deps.oneCore &&
      this.deps.topicAnalysisModel &&
      this.deps.storyFactory
    );
  }
}
