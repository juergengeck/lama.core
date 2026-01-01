import LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import ConnectionsModel from '@refinio/one.models/lib/models/ConnectionsModel.js';
import PropertyTreeStore from '@refinio/one.models/lib/models/SettingsModel.js';
import { objectEvents } from '@refinio/one.models/lib/misc/ObjectEventDispatcher.js';
import { OEvent } from '@refinio/one.models/lib/misc/OEvent.js';
import type { Module } from '@refinio/api';
import { initializePlanObjectManager, registerStandardPlans } from '@refinio/api/plan-system';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getInstanceIdHash, getInstanceOwnerIdHash, getInstanceOwnerEmail } from '@refinio/one.core/lib/instance.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';

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
    leuteModel?: LeuteModel;
    channelManager?: ChannelManager;
    topicModel?: TopicModel;
    connectionsModel?: ConnectionsModel;
    settings?: PropertyTreeStore;
  } = {};

  public leuteModel!: LeuteModel;
  public channelManager!: ChannelManager;
  public topicModel!: TopicModel;
  public connections!: ConnectionsModel;
  public settings!: PropertyTreeStore;

  /** Emits topicId when messages in that topic are updated (via CHUM or local) */
  public onTopicUpdated = new OEvent<(topicId: string) => void>();
  private channelUpdateUnsubscribe: (() => void) | null = null;

  constructor(private commServerUrl: string) {}

  async init(): Promise<void> {
    if (!this.deps.oneCore) {
      throw new Error('[CoreModule] OneCore dependency not injected - Instance not ready');
    }

    try {
      console.log('[CoreModule] OneCore dependency injected - Instance ready');

      // CRITICAL: Initialize ObjectEventDispatcher BEFORE models
      // This enables CHUM sync notifications - without this, imported ChannelInfo
      // objects don't trigger events, and messages from remote peers never appear
      // Note: Only initialize if not already done (pre-supplied models case)
      try {
        console.log('[CoreModule] Initializing ObjectEventDispatcher...');
        await objectEvents.init();
        console.log('[CoreModule] ObjectEventDispatcher initialized');
      } catch (e: any) {
        if (e.message?.includes('already initialized')) {
          console.log('[CoreModule] ObjectEventDispatcher already initialized (pre-supplied models)');
        } else {
          throw e;
        }
      }

      // Initialize PlanObjectManager (other modules may depend on it)
      // Note: PlanRecipe is already registered via Model.ts MultiUser recipes
      console.log('[CoreModule] Initializing PlanObjectManager...');
      initializePlanObjectManager({ storeVersionedObject });
      await registerStandardPlans();
      console.log('[CoreModule] PlanObjectManager initialized and standard Plans registered');
      // Note: StoryFactory is created by ModuleRegistry.setStorageFunction() - NOT here
      // All modules share that single instance via the registry

      // Use pre-supplied models if available, otherwise create new ones
      // This allows platforms like lama.cube to supply nodeOneCore's models
      // instead of creating duplicates (which causes issues like duplicate PairingManagers)
      const modelsSupplied = this.deps.leuteModel && this.deps.channelManager &&
                             this.deps.topicModel && this.deps.connectionsModel;

      if (modelsSupplied) {
        console.log('[CoreModule] Using pre-supplied models from platform');
        this.leuteModel = this.deps.leuteModel!;
        this.channelManager = this.deps.channelManager!;
        this.topicModel = this.deps.topicModel!;
        this.connections = this.deps.connectionsModel!;
        this.settings = this.deps.settings || new PropertyTreeStore('lama.browser.settings');

        // Models already initialized by platform - only init settings if we created it
        if (!this.deps.settings) {
          await this.settings.init();
        }
      } else {
        // Create and initialize ONE.core models (browser platform case)
        console.log('[CoreModule] Creating new ONE.core models');
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
      }

      // Note: ownerId and instanceId are available via ONE.core's getInstanceOwnerIdHash() and
      // getInstanceIdHash() after login. No need to set them on oneCore - Model accesses them directly.
      // ConnectionsModel is supplied via emitSupplies() and injected by ModuleRegistry.
      console.log('[CoreModule] Models initialized. ownerId:', getInstanceOwnerIdHash()?.substring(0, 8));

      // Ensure profile has a display name (using email from Instance object)
      const email = getInstanceOwnerEmail();
      if (email) {
        await this.ensureProfileName(email);
      }

      // Note: Owner Assembly recording moved to JournalModule which has proper existence checking

      // Create the 'lama' channel for application-level data (LLM configs, etc.)
      try {
        const myId = await this.leuteModel.myMainIdentity();
        await this.channelManager.createChannel([myId]);
        console.log('[CoreModule] Created application data channel');
      } catch (error: any) {
        // Channel might already exist - check error
        if (error.message?.includes('already exists')) {
          console.log('[CoreModule] Application data channel already exists');
        } else {
          throw error;
        }
      }

      // Set up channel update listener for topic-specific events
      // This single listener maps channelInfoIdHash → topicId and emits onTopicUpdated
      // UI components and other modules can subscribe to onTopicUpdated
      console.log('[CoreModule] Setting up channel update listener...');
      console.log('[CoreModule] channelManager.onUpdated type:', typeof this.channelManager.onUpdated);
      console.log('[CoreModule] channelManager.onUpdated listenerCount:', this.channelManager.onUpdated.listenerCount?.() ?? 'N/A');
      this.channelUpdateUnsubscribe = this.channelManager.onUpdated(async (
        channelInfoIdHash: any,
        _channelParticipants: any,
        _channelOwner: any,
        _timeOfEarliestChange: any,
        _data: any
      ) => {
        console.log(`[CoreModule] 📡 channelManager.onUpdated FIRED! channelInfoIdHash: ${String(channelInfoIdHash).substring(0, 16)}`);
        try {
          // Find topic that matches this channelInfoIdHash
          const allTopics = await this.topicModel.topics.all();
          console.log(`[CoreModule] 📋 Checking ${allTopics.length} topics for matching channel`);
          const matchingTopic = allTopics.find((t: Topic) => t.channel === channelInfoIdHash);

          if (matchingTopic) {
            console.log(`[CoreModule] 🔔 Channel update for topic: ${matchingTopic.id}`);
            console.log(`[CoreModule] 📢 onTopicUpdated has ${this.onTopicUpdated.listenerCount()} listeners`);
            this.onTopicUpdated.emit(matchingTopic.id);
          } else {
            console.log(`[CoreModule] ❌ No matching topic for channel ${String(channelInfoIdHash).substring(0, 16)}`);
          }
        } catch (error) {
          console.error('[CoreModule] Error in channel update listener:', error);
        }
      });
      console.log('[CoreModule] ✅ Channel update listener started, listenerCount:', this.channelManager.onUpdated.listenerCount?.() ?? 'N/A');

      console.log('[CoreModule] Initialized');
    } catch (error) {
      console.error('[CoreModule] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Ensure the user's profile has a display name derived from email
   */
  private async ensureProfileName(email: string): Promise<void> {
    const me = await this.leuteModel.me();
    if (!me) return;

    const profile = await me.mainProfile();
    const hasName = profile.personDescriptions?.some((d: any) => d.$type$ === 'PersonName');

    if (!hasName) {
      // Extract username from email (e.g., "demo@example.com" -> "Demo")
      const emailParts = email.split('@');
      const userPart = emailParts[0];
      const displayName = userPart.charAt(0).toUpperCase() + userPart.slice(1);

      profile.personDescriptions = profile.personDescriptions || [];
      profile.personDescriptions.push({
        $type$: 'PersonName',
        name: displayName
      });

      await profile.saveAndLoad();
      console.log(`[CoreModule] Profile updated with name: ${displayName}`);
    }
  }

  async shutdown(): Promise<void> {
    try {
      // Unsubscribe from channel updates first
      if (this.channelUpdateUnsubscribe) {
        this.channelUpdateUnsubscribe();
        this.channelUpdateUnsubscribe = null;
      }

      // Shutdown in reverse order (one.models classes have shutdown)
      if (this.connections) await this.connections.shutdown?.();
      if (this.topicModel) await this.topicModel.shutdown?.();
      if (this.channelManager) await this.channelManager.shutdown?.();
      if (this.leuteModel) await this.leuteModel.shutdown?.();
      // PropertyTreeStore doesn't have shutdown

      // Shutdown ObjectEventDispatcher last (was initialized first)
      await objectEvents.shutdown();

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
