// packages/lama.core/modules/ChatModule.ts
import type { Module } from '@refinio/api';
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
import { FeedForwardPlan } from '@chat/core/plans/FeedForwardPlan.js';

// Chat core models
import TopicGroupManager from '@chat/core/models/TopicGroupManager.js';

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
        storeVersionedObject: async (obj: any) => {
          const result = await storeVersionedObject(obj);
          // Add versionHash alias for compatibility
          return { ...result, versionHash: result.hash };
        },
        storeUnversionedObject,
        getObjectByIdHash,
        getObject,
        getAllOfType: async (_type: string) => {
          // TopicGroupManager declares this in interface but never uses it
          throw new Error('getAllOfType not implemented - not used by TopicGroupManager');
        },
        createAccess,
        calculateIdHashOfObj,
        calculateHashOfObj
      }
    );

    // Chat plans (platform-agnostic from chat.core)
    this.chatPlan = new ChatPlan(oneCore);
    this.contactsPlan = new ContactsPlan(oneCore);
    this.feedForwardPlan = new FeedForwardPlan(oneCore);

    // Initialize GroupPlan with StorageFunctions for assembly tracking
    // GroupPlan creates its own internal StoryFactory from StorageFunctions
    console.log('[ChatModule] Initializing GroupPlan with StorageFunctions');

    // Create GroupPlan with TopicGroupManager and StorageFunctions
    // GroupPlan will create its own StoryFactory internally
    this.groupPlan = new GroupPlan(
      this.topicGroupManager,
      oneCore,  // oneCore
      {
        storeVersionedObject: async (obj: any) => {
          const result = await storeVersionedObject(obj);
          return { ...result, versionHash: result.hash };
        },
        getObjectByIdHash,
        getObject
      }
    );

    // Inject GroupPlan into ChatPlan for assembly creation
    this.chatPlan.setGroupPlan(this.groupPlan);
    console.log('[ChatModule] GroupPlan initialized and injected into ChatPlan');

    console.log('[ChatModule] Initialized');
  }

  async shutdown(): Promise<void> {
    // Plans don't have shutdown methods - nothing to clean up
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
