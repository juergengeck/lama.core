import LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import ConnectionsModel from '@refinio/one.models/lib/models/ConnectionsModel.js';
import PropertyTreeStore from '@refinio/one.models/lib/models/SettingsModel.js';
import type { Module } from '@refinio/api';
import { initializePlanObjectManager, registerStandardPlans } from '@refinio/api/plan-system';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';

/**
 * CoreModule - ONE.core foundation models
 *
 * Root module with NO dependencies. Provides:
 * - LeuteModel (people/contacts/profiles)
 * - ChannelManager (channel operations)
 * - TopicModel (chat/messaging)
 * - ConnectionsModel (P2P connections)
 * - Settings (encrypted storage)
 */
export class CoreModule implements Module {
  readonly name = 'CoreModule';

  // Demand OneCore to ensure Instance is ready before initializing models
  static demands = [
    { targetType: 'OneCore', required: true }
  ];

  static supplies = [
    { targetType: 'LeuteModel' },
    { targetType: 'ChannelManager' },
    { targetType: 'TopicModel' },
    { targetType: 'ConnectionsModel' },
    { targetType: 'Settings' },
    { targetType: 'PlanObjectManager' }
    // Note: StoryFactory is supplied by ModuleRegistry.setStorageFunction()
  ];

  private deps: {
    oneCore?: any;
  } = {};

  public leuteModel!: LeuteModel;
  public channelManager!: ChannelManager;
  public topicModel!: TopicModel;
  public connections!: ConnectionsModel;
  public settings!: PropertyTreeStore;

  constructor(private commServerUrl: string) {}

  async init(): Promise<void> {
    if (!this.deps.oneCore) {
      throw new Error('[CoreModule] OneCore dependency not injected - Instance not ready');
    }

    try {
      console.log('[CoreModule] OneCore dependency injected - Instance ready');

      // Initialize PlanObjectManager (other modules may depend on it)
      // Note: PlanRecipe is already registered via Model.ts MultiUser recipes
      console.log('[CoreModule] Initializing PlanObjectManager...');
      initializePlanObjectManager({ storeVersionedObject });
      await registerStandardPlans();
      console.log('[CoreModule] PlanObjectManager initialized and standard Plans registered');
      // Note: StoryFactory is created by ModuleRegistry.setStorageFunction() - NOT here
      // All modules share that single instance via the registry

      // Create ONE.core models
      this.leuteModel = new LeuteModel(this.commServerUrl, false);
      this.channelManager = new ChannelManager(this.leuteModel);
      this.topicModel = new TopicModel(this.channelManager, this.leuteModel);
      this.connections = new ConnectionsModel(this.leuteModel, {
        commServerUrl: this.commServerUrl
      });
      this.settings = new PropertyTreeStore('lama.browser.settings');

      // Initialize all models (state machine transitions)
      await this.leuteModel.init();
      await this.channelManager.init();
      await this.topicModel.init();
      await this.connections.init();
      await this.settings.init();

      // CRITICAL: Set ownerId and instanceId on oneCore IMMEDIATELY after leuteModel init
      // Other modules (AIModule -> TopicGroupManager) need this during their init
      const oneCore = this.deps.oneCore;
      if (oneCore && this.leuteModel) {
        oneCore.ownerId = await this.leuteModel.myMainIdentity();
        console.log('[CoreModule] Set ownerId on oneCore:', oneCore.ownerId?.substring(0, 8));

        // Set instanceId for InstancePlan (dynamic import to avoid circular deps)
        try {
          const { getInstanceIdHash } = await import('@refinio/one.core/lib/instance.js');
          oneCore.instanceId = getInstanceIdHash();
          console.log('[CoreModule] Set instanceId on oneCore:', oneCore.instanceId?.substring(0, 8));
        } catch (e) {
          console.warn('[CoreModule] Could not get instanceId:', e);
        }
      }

      // Note: Owner Assembly recording moved to JournalModule which has proper existence checking

      // Create the 'lama' channel for application-level data (LLM configs, etc.)
      try {
        await this.channelManager.createChannel('lama');
        console.log('[CoreModule] Created \'lama\' channel for application data');
      } catch (error: any) {
        // Channel might already exist - check error
        if (error.message?.includes('already exists')) {
          console.log('[CoreModule] \'lama\' channel already exists');
        } else {
          throw error;
        }
      }

      console.log('[CoreModule] Initialized');
    } catch (error) {
      console.error('[CoreModule] Initialization failed:', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    try {
      // Shutdown in reverse order (one.models classes have shutdown)
      if (this.connections) await this.connections.shutdown?.();
      if (this.topicModel) await this.topicModel.shutdown?.();
      if (this.channelManager) await this.channelManager.shutdown?.();
      if (this.leuteModel) await this.leuteModel.shutdown?.();
      // PropertyTreeStore doesn't have shutdown

      console.log('[CoreModule] Shutdown complete');
    } catch (error) {
      console.error('[CoreModule] Shutdown failed:', error);
      throw error;
    }
  }

  setDependency(targetType: string, instance: any): void {
    const key = targetType.charAt(0).toLowerCase() + targetType.slice(1);
    this.deps[key as keyof typeof this.deps] = instance;
  }

  emitSupplies(registry: any): void {
    registry.supply('LeuteModel', this.leuteModel);
    registry.supply('ChannelManager', this.channelManager);
    registry.supply('TopicModel', this.topicModel);
    registry.supply('ConnectionsModel', this.connections);
    registry.supply('Settings', this.settings);
    registry.supply('PlanObjectManager', true); // Signal that PlanObjectManager is ready
    // Note: StoryFactory is already supplied by ModuleRegistry - not here
  }
}
