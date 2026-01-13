import LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import PropertyTreeStore from '@refinio/one.models/lib/models/SettingsModel.js';
import GroupModel from '@refinio/one.models/lib/models/Leute/GroupModel.js';
import { objectEvents } from '@refinio/one.models/lib/misc/ObjectEventDispatcher.js';
import { OEvent } from '@refinio/one.models/lib/misc/OEvent.js';
import type { Module } from '@refinio/api';
import { initializePlanObjectManager, registerStandardPlans } from '@refinio/api/plan-system';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getInstanceOwnerIdHash, getInstanceOwnerEmail } from '@refinio/one.core/lib/instance.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';

// IoM group name constant (same as IoMManager.IoMGroupName)
const IOM_GROUP_NAME = 'IoM';

// ============================================================================
// MODULE-LEVEL SINGLETONS
// These survive across CoreModule instance recreation (e.g., hot reload,
// multiple Model constructions). React components subscribe to these once
// and they remain valid even if CoreModule is re-instantiated.
// ============================================================================
let globalInitialized = false;
let globalOnTopicUpdated: OEvent<(topicId: string) => void> | null = null;
let globalModels: {
  leuteModel?: LeuteModel;
  channelManager?: ChannelManager;
  topicModel?: TopicModel;
  settings?: PropertyTreeStore;
} = {};

/**
 * CoreModule - ONE.core foundation models
 *
 * CONSOLIDATED architecture - this is THE single place for basic model initialization.
 * All platforms (lama.cube, lama.browser, lama.ios) use CoreModule.
 *
 * Provides:
 * - LeuteModel (people/contacts/profiles)
 * - ChannelManager (channel operations)
 * - TopicModel (chat/messaging)
 * - Settings (encrypted storage)
 *
 * NOTE: ConnectionsModel is created by ConnectionModule. This avoids circular dependencies.
 */
export class CoreModule implements Module {
  readonly name = 'CoreModule';

  static demands = [
    { targetType: 'OneCore', required: true },
    { targetType: 'Settings', required: false }  // Optional: platform can supply pre-configured settings
  ];

  static supplies = [
    { targetType: 'LeuteModel' },
    { targetType: 'ChannelManager' },
    { targetType: 'TopicModel' },
    { targetType: 'Settings' },
    { targetType: 'PlanObjectManager' }
    // Note: ConnectionsModel is supplied by ConnectionModule
    // Note: StoryFactory is supplied by ModuleRegistry.setStorageFunction()
  ];

  private deps: {
    oneCore?: any;
    settings?: PropertyTreeStore;
  } = {};

  public leuteModel!: LeuteModel;
  public channelManager!: ChannelManager;
  public topicModel!: TopicModel;
  public settings!: PropertyTreeStore;

  /**
   * Emits topicId when messages in that topic are updated (via CHUM or local)
   * NOTE: This getter returns a MODULE-LEVEL singleton that survives instance recreation.
   * React components subscribe once and the subscription remains valid.
   */
  public get onTopicUpdated(): OEvent<(topicId: string) => void> {
    if (!globalOnTopicUpdated) {
      globalOnTopicUpdated = new OEvent<(topicId: string) => void>();
    }
    return globalOnTopicUpdated;
  }
  private channelUpdateUnsubscribe: (() => void) | null = null;
  private newTopicUnsubscribe: (() => void) | null = null;
  private initialized = false;

  constructor(private commServerUrl: string) {}

  async init(): Promise<void> {
    if (!this.deps.oneCore) {
      throw new Error('[CoreModule] OneCore dependency not injected - Instance not ready');
    }

    // GLOBAL singleton guard - prevents ANY CoreModule instance from reinitializing
    // This is critical because React components subscribe to globalOnTopicUpdated,
    // and we must not create duplicate model instances or listeners
    if (globalInitialized) {
      console.log('[CoreModule] GLOBAL GUARD: Already initialized, reusing existing models');
      // Copy global models to this instance so getters work
      this.leuteModel = globalModels.leuteModel!;
      this.channelManager = globalModels.channelManager!;
      this.topicModel = globalModels.topicModel!;
      this.settings = globalModels.settings!;
      this.initialized = true;
      return;
    }

    // Instance-level guard (belt and suspenders)
    if (this.initialized) {
      console.log('[CoreModule] Already initialized, skipping');
      return;
    }

    try {
      console.log('[CoreModule] Initializing - THE single source of model creation');

      // CRITICAL: Initialize ObjectEventDispatcher BEFORE models
      // This enables CHUM sync notifications - without this, imported ChannelInfo
      // objects don't trigger events, and messages from remote peers never appear
      // Check if already initialized (guards against module duplication issues)
      if (objectEvents.isInitialized()) {
        console.log('[CoreModule] ObjectEventDispatcher already initialized, skipping');
      } else {
        console.log('[CoreModule] Initializing ObjectEventDispatcher...');
        await objectEvents.init();
        console.log('[CoreModule] ObjectEventDispatcher initialized');
      }

      // Initialize PlanObjectManager (other modules may depend on it)
      console.log('[CoreModule] Initializing PlanObjectManager...');
      initializePlanObjectManager({ storeVersionedObject });
      await registerStandardPlans();
      console.log('[CoreModule] PlanObjectManager initialized and standard Plans registered');

      // Create and initialize ONE.core models
      // This is THE single place for basic model creation
      // NOTE: ConnectionsModel is created by ConnectionModule
      console.log('[CoreModule] Creating ONE.core models');
      // createEveryoneGroup=true creates the "everyone" group for certificate sharing
      // This is required for AI and user certificate distribution via CHUM
      this.leuteModel = new LeuteModel(this.commServerUrl, true);
      this.channelManager = new ChannelManager(this.leuteModel);
      this.topicModel = new TopicModel(this.channelManager, this.leuteModel);

      // Use supplied Settings or create default
      if (this.deps.settings) {
        this.settings = this.deps.settings;
        console.log('[CoreModule] Using supplied Settings');
      } else {
        this.settings = new PropertyTreeStore('lama.settings');
        await this.settings.init();
        console.log('[CoreModule] Created default Settings');
      }

      // Initialize all models (state machine transitions)
      await this.leuteModel.init();
      await this.channelManager.init();
      await this.topicModel.init();

      // Ensure IoM group exists for certificate sharing (mirrors IoMManager.initIomGroup)
      // This is required for shareObjectWithIoM to work for both users and AI
      try {
        const myId = await this.leuteModel.myMainIdentity();
        const iomGroup = await GroupModel.constructWithNewGroup(IOM_GROUP_NAME);
        if (!iomGroup.persons.includes(myId)) {
          iomGroup.persons.push(myId);
          await iomGroup.saveAndLoad();
        }
        console.log('[CoreModule] ✅ IoM group initialized');
      } catch (error: any) {
        // Group might already exist
        if (!error.message?.includes('already exists')) {
          console.warn('[CoreModule] IoM group initialization:', error.message);
        }
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

      // Set up channel update listener
      // SIMPLIFIED: Emit for ALL topics on any channel update. UI filters by its own topicId.
      // No complex participant matching needed - the UI knows which topic it's displaying.
      console.log('[CoreModule] Setting up channel update listener...');
      this.channelUpdateUnsubscribe = this.channelManager.onUpdated(async () => {
        try {
          console.log('[CoreModule] 📬 Channel updated - notifying all topics');
          const allTopics = await this.topicModel.topics.all();
          for (const topic of allTopics) {
            const topicIdHash = await calculateIdHashOfObj(topic);
            this.onTopicUpdated.emit(topicIdHash);
          }
        } catch (error) {
          console.error('[CoreModule] Error in channel update listener:', error);
        }
      });

      // Listen for new Topics being added
      this.newTopicUnsubscribe = this.topicModel.onNewTopicEvent(() => {
        console.log('[CoreModule] 🆕 New topic added - notifying all topics');
        this.topicModel.topics.all().then(async (topics: Topic[]) => {
          for (const topic of topics) {
            const topicIdHash = await calculateIdHashOfObj(topic);
            this.onTopicUpdated.emit(topicIdHash);
          }
        }).catch((error: any) => {
          console.error('[CoreModule] Error getting topics after new topic event:', error);
        });
      });

      console.log('[CoreModule] ✅ Channel listeners registered');

      // Store models globally so future CoreModule instances can reuse them
      globalModels = {
        leuteModel: this.leuteModel,
        channelManager: this.channelManager,
        topicModel: this.topicModel,
        settings: this.settings
      };
      globalInitialized = true;
      this.initialized = true;
      console.log('[CoreModule] Initialized (global singleton established)');
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
      if (this.newTopicUnsubscribe) {
        this.newTopicUnsubscribe();
        this.newTopicUnsubscribe = null;
      }

      // Shutdown in reverse order (one.models classes have shutdown)
      // Note: ConnectionsModel is shutdown by ConnectionModule
      if (this.topicModel) await this.topicModel.shutdown?.();
      if (this.channelManager) await this.channelManager.shutdown?.();
      if (this.leuteModel) await this.leuteModel.shutdown?.();
      // PropertyTreeStore doesn't have shutdown

      // Shutdown ObjectEventDispatcher last (was initialized first)
      await objectEvents.shutdown();

      // Reset global singleton state
      globalInitialized = false;
      globalModels = {};
      // Note: We do NOT reset globalOnTopicUpdated - React components may still
      // hold references to it. They'll just receive no more events until resubscribe.

      this.initialized = false;
      console.log('[CoreModule] Shutdown complete (global singleton reset)');
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
    registry.supply('Settings', this.settings);
    registry.supply('PlanObjectManager', true); // Signal that PlanObjectManager is ready
    // Note: ConnectionsModel is supplied by ConnectionModule
    // Note: StoryFactory is already supplied by ModuleRegistry - not here
  }
}
