// packages/lama.browser/browser-ui/src/modules/ChatModule.ts
import type { Module } from '@refinio/api/plan-system';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';

// ONE.core storage imports
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObject, storeUnversionedObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { createAccess } from '@refinio/one.core/lib/access.js';
import { calculateHashOfObj, calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

// Chat core plans (platform-agnostic business logic - chat-related)
import { ChatPlan } from '@chat/core/plans/ChatPlan.js';
import { GroupPlan } from '@chat/core/plans/GroupPlan.js';
import { ContactsPlan } from '@chat/core/plans/ContactsPlan.js';
import { ExportPlan } from '@chat/core/plans/ExportPlan.js';
import { FeedForwardPlan } from '@chat/core/plans/FeedForwardPlan.js';

// Chat core models
import TopicGroupManager from '@chat/core/models/TopicGroupManager.js';

// Plan system for assembly tracking
import { StoryFactory } from '@refinio/api/plan-system';
import { AssemblyPlan } from '@assembly/core';

/**
 * ChatModule - Chat functionality
 *
 * Provides:
 * - Chat Plans (ChatPlan, GroupPlan, ContactsPlan, ExportPlan, FeedForwardPlan)
 * - TopicGroupManager (group chat management)
 */
export class ChatModule implements Module {
  readonly name = 'ChatModule';

  static demands = [
    { targetType: 'LeuteModel', required: true },
    { targetType: 'ChannelManager', required: true },
    { targetType: 'TopicModel', required: true },
    { targetType: 'OneCore', required: true }
  ];

  static supplies = [
    { targetType: 'ChatPlan' },
    { targetType: 'GroupPlan' },
    { targetType: 'ContactsPlan' },
    { targetType: 'ExportPlan' },
    { targetType: 'FeedForwardPlan' },
    { targetType: 'TopicGroupManager' }
  ];

  private deps: {
    leuteModel?: LeuteModel;
    channelManager?: ChannelManager;
    topicModel?: TopicModel;
    oneCore?: any;
  } = {};

  // Chat Plans
  public chatPlan!: ChatPlan;
  public groupPlan!: GroupPlan;
  public contactsPlan!: ContactsPlan;
  public exportPlan!: ExportPlan;
  public feedForwardPlan!: FeedForwardPlan;
  public topicGroupManager!: TopicGroupManager;

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('ChatModule missing required dependencies');
    }

    const { oneCore } = this.deps;

    // Create TopicGroupManager with oneCore instance + storageDeps
    this.topicGroupManager = new TopicGroupManager(
      oneCore, // OneCoreInstance (Model implements this)
      {
        storeVersionedObject,
        storeUnversionedObject,
        getObjectByIdHash,
        getObject,
        createAccess,
        calculateIdHashOfObj,
        calculateHashOfObj
      }
    );

    // Chat plans (platform-agnostic from chat.core)
    this.chatPlan = new ChatPlan(oneCore);
    this.contactsPlan = new ContactsPlan(oneCore);
    this.exportPlan = new ExportPlan(oneCore);
    this.feedForwardPlan = new FeedForwardPlan(oneCore);

    // Initialize GroupPlan with StoryFactory for assembly tracking
    // This enables assembly creation through the proper abstraction layers
    console.log('[ChatModule] Initializing GroupPlan with StoryFactory and AssemblyPlan');

    // Create AssemblyPlan (connects to ONE.core)
    const assemblyPlan = new AssemblyPlan({
      storeVersionedObject,
      storeUnversionedObject,
      getObjectByIdHash
    });

    // Create StoryFactory with storage function (NOT AssemblyPlan object)
    // StoryFactory expects a function, not an object
    const storyFactory = new StoryFactory(storeVersionedObject);
    console.log('[ChatModule] StoryFactory created with storeVersionedObject function');

    // Create GroupPlan with TopicGroupManager and StoryFactory
    this.groupPlan = new GroupPlan(
      this.topicGroupManager,
      oneCore,  // oneCore
      storyFactory
    );

    // Inject GroupPlan into ChatPlan for assembly creation
    this.chatPlan.setGroupPlan(this.groupPlan);
    console.log('[ChatModule] GroupPlan initialized and injected into ChatPlan');

    console.log('[ChatModule] Initialized');
  }

  async shutdown(): Promise<void> {
    await this.feedForwardPlan?.shutdown?.();
    await this.exportPlan?.shutdown?.();
    await this.contactsPlan?.shutdown?.();
    await this.groupPlan?.shutdown?.();
    await this.chatPlan?.shutdown?.();
    await this.topicGroupManager?.shutdown?.();

    console.log('[ChatModule] Shutdown complete');
  }

  setDependency(targetType: string, instance: any): void {
    const key = targetType.charAt(0).toLowerCase() + targetType.slice(1);
    this.deps[key as keyof typeof this.deps] = instance;
  }

  emitSupplies(registry: any): void {
    registry.supply('ChatPlan', this.chatPlan);
    registry.supply('GroupPlan', this.groupPlan);
    registry.supply('ContactsPlan', this.contactsPlan);
    registry.supply('ExportPlan', this.exportPlan);
    registry.supply('FeedForwardPlan', this.feedForwardPlan);
    registry.supply('TopicGroupManager', this.topicGroupManager);
  }

  private hasRequiredDeps(): boolean {
    return !!(
      this.deps.leuteModel &&
      this.deps.channelManager &&
      this.deps.topicModel &&
      this.deps.oneCore
    );
  }
}
