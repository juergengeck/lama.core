// packages/lama.core/modules/AIModule.ts
import type { Module } from '@refinio/api';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type PropertyTreeStore from '@refinio/one.models/lib/models/SettingsModel.js';
import type TopicGroupManager from '@chat/core/models/TopicGroupManager.js';
import type { TrustPlan } from '@trust/core/plans/TrustPlan.js';
import type { JournalPlan } from '../plans/JournalPlan.js';
import type { LLMPlatform, OllamaValidator, LLMConfigManager } from '../services/llm-platform.js';

// ONE.core storage imports
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getIdObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObject, storeUnversionedObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { getAllEntries } from '@refinio/one.core/lib/reverse-map-query.js';
import { createAccess } from '@refinio/one.core/lib/access.js';
import { createDefaultKeys, hasDefaultKeys } from '@refinio/one.core/lib/keychain/keychain.js';

// LAMA core plans (platform-agnostic business logic - AI-related)
import { AIPlan } from '../plans/AIPlan.js';
import { AIAssistantPlan } from '../plans/AIAssistantPlan.js';
import { TopicAnalysisPlan } from '../plans/TopicAnalysisPlan.js';
import { ProposalsPlan } from '../plans/ProposalsPlan.js';
import { KeywordDetailPlan } from '../plans/KeywordDetailPlan.js';
import { WordCloudSettingsPlan } from '../plans/WordCloudSettingsPlan.js';
import { LLMConfigPlan } from '../plans/LLMConfigPlan.js';
import { CryptoPlan } from '../plans/CryptoPlan.js';
import { AuditPlan } from '../plans/AuditPlan.js';
import { SubjectsPlan } from '../plans/SubjectsPlan.js';
import { CubePlan } from '../plans/CubePlan.js';

// LAMA core AI models (message listener)
import { AIMessageListener } from '../models/ai/index.js';

// LAMA core models (LLM and AI object management)
import { LLMObjectManager } from '../models/LLMObjectManager.js';
import { AIObjectManager } from '../models/AIObjectManager.js';
import { AISettingsManager } from '../models/settings/AISettingsManager.js';

// Proposal services
import { ProposalEngine } from '../services/proposal-engine.js';
import { ProposalRanker } from '../services/proposal-ranker.js';
import { ProposalCache } from '../services/proposal-cache.js';

// Platform-agnostic LLM manager
import { LLMManager } from '../services/llm-manager.js';

/**
 * AIModule - AI and LLM functionality
 *
 * Provides:
 * - AI Plans (AIPlan, AIAssistantPlan, etc.)
 * - LLM management
 * - Topic analysis
 * - Proposals
 *
 * Platform-agnostic: All platform specifics injected via dependencies
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
    // Platform adapters as demands (injected by platform)
    { targetType: 'LLMPlatform', required: true },
    { targetType: 'OllamaValidator', required: true },
    { targetType: 'LLMConfigManager', required: true }
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
    journalPlan?: JournalPlan;
    oneCore?: any;
    topicAnalysisModel?: any;
    llmPlatform?: LLMPlatform;
    ollamaValidator?: OllamaValidator;
    llmConfigManager?: LLMConfigManager;
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

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('AIModule missing required dependencies');
    }

    console.log('[AIModule] Initializing AI module...');

    const {
      leuteModel,
      channelManager,
      topicModel,
      settings,
      topicGroupManager,
      trustPlan,
      journalPlan,
      oneCore,
      llmPlatform,
      ollamaValidator,
      llmConfigManager
    } = this.deps;

    // LLM management (platform-agnostic) - MUST be created before AIAssistantPlan
    // Use injected platform adapter instead of creating browser-specific instance
    this.llmManager = new LLMManager(llmPlatform!);

    // Set channelManager on llmManager for LLM storage access
    this.llmManager.channelManager = channelManager;

    // LLMObjectManager - platform-agnostic LLM object management using ONE.core abstractions
    this.llmObjectManager = new LLMObjectManager(
      {
        storeVersionedObject,
        createAccess,
        queryAllLLMObjects: async function* () {
          // Query all LLM objects from storage using reverse map
          // This is needed to restore AI contacts on reload
          console.log('[AIModule/queryAllLLMObjects] Querying LLM objects...');
          const myId = await leuteModel!.myMainIdentity();
          console.log(`[AIModule/queryAllLLMObjects] Got owner ID: ${myId.substring(0, 8)}...`);

          const llmEntries = await getAllEntries(myId, 'LLM');
          console.log(`[AIModule/queryAllLLMObjects] Found ${llmEntries.length} LLM entries`);

          for (const entry of llmEntries) {
            const objectHash = entry.obj || entry.hash || entry;
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
        createAccess,
        queryAllAIObjects: async function* () {
          // Query all AI objects from storage using reverse map
          console.log('[AIModule/queryAllAIObjects] Querying AI objects...');
          const myId = await leuteModel!.myMainIdentity();
          const aiEntries = await getAllEntries(myId, 'AI');
          console.log(`[AIModule/queryAllAIObjects] Found ${aiEntries.length} AI entries`);

          for (const entry of aiEntries) {
            const objectHash = entry.obj || entry.hash || entry;
            const aiObject = await getObject(objectHash);
            if (aiObject && aiObject.$type$ === 'AI') {
              console.log(`[AIModule/queryAllAIObjects] Yielding AI object: ${aiObject.displayName}`);
              yield aiObject;
            }
          }
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
      platform: llmPlatform!, // Use injected platform adapter
      stateManager: undefined, // Optional - not used in browser
      llmObjectManager: this.llmObjectManager, // Platform-agnostic LLM object manager
      contextEnrichmentService: undefined, // Optional - not used in browser
      topicAnalysisModel: undefined, // Will be set during init()
      topicGroupManager: topicGroupManager!,
      settingsPersistence: undefined, // Optional - use llmConfigPlan instead
      llmConfigPlan: undefined, // Will be set right after
      aiSettingsManager: this.aiSettingsManager,
      storageDeps: {
        storeVersionedObject,
        storeUnversionedObject,
        getIdObject,
        getObjectByIdHash,
        getObject,
        createDefaultKeys,
        hasDefaultKeys,
        channelManager: channelManager!,    // Required: for querying LLM objects
        trustPlan: trustPlan!,              // For assigning 'high' trust to AI contacts
        journalPlan: journalPlan!,          // For recording AI contact creation as assemblies
        aiObjectManager: this.aiObjectManager,  // For creating AI storage objects
        llmObjectManager: this.llmObjectManager // For creating/updating LLM storage objects
      }
    });

    // Create LLMConfigPlan with settings for secure API key storage
    // Settings uses ONE.core's master key encryption automatically
    // Use injected adapters instead of browser-specific implementations
    this.llmConfigPlan = new LLMConfigPlan(
      oneCore!,
      this.aiAssistantPlan,
      this.llmManager,
      settings!, // ONE.core SettingsModel (encrypted storage)
      ollamaValidator!, // Injected platform-specific validator
      {
        computeBaseUrl: llmConfigManager!.computeBaseUrl.bind(llmConfigManager)
      }
    );

    // Set llmConfigPlan on aiAssistantPlan for settings persistence
    (this.aiAssistantPlan as any).llmConfigPlan = this.llmConfigPlan;

    // CRITICAL: Inject topicAnalysisModel into AIAssistantPlan (injected by ModuleRegistry)
    console.log('[AIModule] Injecting topicAnalysisModel into AIAssistantPlan.deps');
    (this.aiAssistantPlan as any).deps.topicAnalysisModel = this.deps.topicAnalysisModel;

    // Also inject into messageProcessor for backwards compatibility
    if (this.aiAssistantPlan.messageProcessor) {
      (this.aiAssistantPlan.messageProcessor as any).topicAnalysisModel = this.deps.topicAnalysisModel;
    }

    // CRITICAL: Inject topicAnalysisModel into taskManager so analysis can be processed
    if (this.aiAssistantPlan.taskManager) {
      console.log('[AIModule] Injecting topicAnalysisModel into AITaskManager');
      (this.aiAssistantPlan.taskManager as any).topicAnalysisModel = this.deps.topicAnalysisModel;
    }

    // CRITICAL: Initialize AIAssistantPlan now that all dependencies are injected
    console.log('[AIModule] Initializing AIAssistantPlan...');
    await this.aiAssistantPlan.init();
    console.log('[AIModule] AIAssistantPlan initialized');

    // CRITICAL: Set aiAssistantModel on oneCore so LLMConfigPlan can access it dynamically
    // LLMConfigPlan accesses it via this.nodeOneCore.aiAssistantModel
    console.log('[AIModule] Setting aiAssistantModel on oneCore for dynamic access');
    (oneCore as any).aiAssistantModel = this.aiAssistantPlan;

    // topicAnalysisPlan, proposalsPlan will be created after topicAnalysisModel is ready
    this.keywordDetailPlan = new KeywordDetailPlan(oneCore!);
    this.wordCloudSettingsPlan = new WordCloudSettingsPlan(oneCore!);
    this.cryptoPlan = new CryptoPlan(oneCore!);
    this.auditPlan = new AuditPlan(oneCore!);

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

    // Initialize all handlers
    await this.topicAnalysisPlan.init?.();
    await this.proposalsPlan.init?.();
    await this.keywordDetailPlan.init?.();
    await this.wordCloudSettingsPlan.init?.();
    await this.llmConfigPlan.init?.();
    await this.cryptoPlan.init?.();
    await this.auditPlan.init?.();

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
      ownerId: ownerId
    });
    await this.aiMessageListener.start();
    console.log('[AIModule] AIMessageListener started');
  }

  async shutdown(): Promise<void> {
    console.log('[AIModule] Shutting down...');

    const platformHandlers = [
      { name: 'AIMessageListener', fn: () => this.aiMessageListener?.stop?.() },
      { name: 'AuditPlan', fn: () => this.auditPlan?.shutdown?.() },
      { name: 'CryptoPlan', fn: () => this.cryptoPlan?.shutdown?.() },
      { name: 'LLMConfigPlan', fn: () => this.llmConfigPlan?.shutdown?.() },
      { name: 'WordCloudSettingsPlan', fn: () => this.wordCloudSettingsPlan?.shutdown?.() },
      { name: 'KeywordDetailPlan', fn: () => this.keywordDetailPlan?.shutdown?.() },
      { name: 'ProposalsPlan', fn: () => this.proposalsPlan?.shutdown?.() },
      { name: 'TopicAnalysisPlan', fn: () => this.topicAnalysisPlan?.shutdown?.() },
      { name: 'AIPlan', fn: () => this.aiPlan?.shutdown?.() }
    ];

    for (const handler of platformHandlers) {
      try {
        await handler.fn();
      } catch (error) {
        console.error(`[AIModule] Shutdown error (${handler.name}):`, error);
      }
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
      this.deps.journalPlan &&
      this.deps.oneCore &&
      this.deps.topicAnalysisModel &&
      this.deps.llmPlatform &&
      this.deps.ollamaValidator &&
      this.deps.llmConfigManager
    );
  }
}
