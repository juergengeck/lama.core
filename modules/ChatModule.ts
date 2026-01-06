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
import { GroupPlan, GroupPlanStorageDeps } from '@chat/core/plans/GroupPlan.js';
import { ContactsPlan } from '@chat/core/plans/ContactsPlan.js';
import { FeedForwardPlan } from '@chat/core/plans/FeedForwardPlan.js';
import type { ExportPlan } from '@chat/core/plans/ExportPlan.js';

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
    { targetType: 'OneCore', required: true },
    { targetType: 'ExportPlan', required: true },
    // TrustPlan is needed for implied trust assignment when receiving Groups
    { targetType: 'TrustPlan', required: false },
    // AIAssistantPlan is needed for AI contact detection in ContactsPlan
    // It sets oneCore.aiAssistantModel which ContactsPlan uses
    { targetType: 'AIAssistantPlan', required: false }
  ];

  static supplies = [
    { targetType: 'ChatPlan' },
    { targetType: 'GroupPlan' },
    { targetType: 'ContactsPlan' },
    { targetType: 'FeedForwardPlan' }
  ];

  private deps: {
    leuteModel?: LeuteModel;
    channelManager?: ChannelManager;
    topicModel?: TopicModel;
    oneCore?: any;
    exportPlan?: ExportPlan;  // Required - injected via setDependency
    trustPlan?: any;  // TrustPlan for implied trust on group receive
  } = {};

  // Chat Plans
  public chatPlan!: ChatPlan;
  public groupPlan!: GroupPlan;
  public contactsPlan!: ContactsPlan;
  public exportPlan!: ExportPlan;
  public feedForwardPlan!: FeedForwardPlan;

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('ChatModule missing required dependencies');
    }

    const { oneCore } = this.deps;

    // Chat plans (platform-agnostic from chat.core)
    // Check if AIModule has set aiAssistantModel on oneCore
    console.log('[ChatModule] oneCore.aiAssistantModel available:', !!(oneCore as any)?.aiAssistantModel);
    this.chatPlan = new ChatPlan(oneCore);
    this.contactsPlan = new ContactsPlan(oneCore);
    this.feedForwardPlan = new FeedForwardPlan(oneCore);

    // ExportPlan is required - injected by platform via setDependency
    this.exportPlan = this.deps.exportPlan!;

    // Initialize GroupPlan with TopicModel and storage deps
    // GroupPlan creates HashGroup -> Group -> Topic for conversations
    const ownerId = await this.deps.leuteModel!.myMainIdentity();
    const storageDeps: GroupPlanStorageDeps = {
      getObjectByIdHash: getObjectByIdHash as any,
      getObject: getObject as any,
      calculateIdHashOfObj: calculateIdHashOfObj as any,
      storeUnversionedObject: storeUnversionedObject as any,
      storeVersionedObject: storeVersionedObject as any
    };
    this.groupPlan = new GroupPlan(this.deps.topicModel!, storageDeps, ownerId);

    // Inject GroupPlan into ChatPlan
    this.chatPlan.setGroupPlan(this.groupPlan);
    console.log('[ChatModule] GroupPlan initialized');

    console.log('[ChatModule] Initialized');
  }

  async shutdown(): Promise<void> {
    // Plans don't have shutdown methods in current chat.core
    // Use optional chaining with type assertion for future compatibility
    await (this.feedForwardPlan as any)?.shutdown?.();
    if (this.exportPlan) {
      await (this.exportPlan as any)?.shutdown?.();
    }
    await (this.contactsPlan as any)?.shutdown?.();
    await (this.groupPlan as any)?.shutdown?.();
    await (this.chatPlan as any)?.shutdown?.();

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
    // Note: ExportPlan is NOT supplied - ChatModule consumes it, platform supplies it directly
    registry.supply('FeedForwardPlan', this.feedForwardPlan);
  }

  private hasRequiredDeps(): boolean {
    return !!(
      this.deps.leuteModel &&
      this.deps.channelManager &&
      this.deps.topicModel &&
      this.deps.oneCore &&
      this.deps.exportPlan
    );
  }
}
