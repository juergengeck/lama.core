// packages/lama.browser/browser-ui/src/modules/ConnectionModule.ts
import type { Module } from '@refinio/api';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type ConnectionsModel from '@refinio/one.models/lib/models/ConnectionsModel.js';
import type TopicGroupManager from '@chat/core/models/TopicGroupManager.js';
import ProfileModel from '@refinio/one.models/lib/models/Leute/ProfileModel.js';
import {ConnectionPlan, type PairingEventCallbacks} from '@connection/core/plans/ConnectionPlan.js';
import type {TrustPlanDependencies} from '@connection/core/plans/TrustPlan.js';
import {GroupChatPlan, type GroupChatPlanDependencies} from '@connection/core/plans/GroupChatPlan.js';
import {TrustPlan} from '@trust/core/plans/TrustPlan.js';
import {DiscoveryService, type LocalDiscoveryProvider} from '@connection/core';
import {getAllEntries} from '@refinio/one.core/lib/reverse-map-query.js';
import {getObject, storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {storeVersionedObject, getObjectByIdHash} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {OEvent} from '@refinio/one.models/lib/misc/OEvent.js';

/**
 * ConnectionModule - P2P connections and group chat
 *
 * Provides:
 * - Connection Plans (ConnectionPlan, GroupChatPlan)
 * - P2P pairing and sync
 */
export class ConnectionModule implements Module {
  readonly name = 'ConnectionModule';

  static demands = [
    { targetType: 'OneCore', required: true },
    { targetType: 'LeuteModel', required: true },
    { targetType: 'ChannelManager', required: true },
    { targetType: 'TopicModel', required: true },
    { targetType: 'ConnectionsModel', required: true },
    { targetType: 'TrustPlan', required: true },
    { targetType: 'TopicGroupManager', required: false }  // Optional, for mesh propagation
  ];

  static supplies = [
    { targetType: 'ConnectionPlan' },
    { targetType: 'GroupChatPlan' },
    { targetType: 'DiscoveryService' }
  ];

  private deps: {
    oneCore?: any;
    leuteModel?: LeuteModel;
    channelManager?: ChannelManager;
    topicModel?: TopicModel;
    connectionsModel?: ConnectionsModel;
    trustPlan?: TrustPlan;
    topicGroupManager?: TopicGroupManager;
  } = {};

  // Connection Plans
  public connectionPlan: ConnectionPlan;
  public groupChatPlan: GroupChatPlan;

  // Discovery Service
  public discoveryService: DiscoveryService;

  // Platform-specific discovery provider (set before init)
  private localDiscoveryProvider?: LocalDiscoveryProvider;

  // Event emitters for platform-specific UI updates
  public onContactsChanged = new OEvent<() => void>();
  public onTopicsChanged = new OEvent<() => void>();
  public onConnectionsChanged = new OEvent<() => void>();

  // Cache for mapping topicId to participantsHash (used by channelManager adapter)
  private channelParticipantsCache = new Map<string, any>();

  constructor(
    private commServerUrl: string,
    private webUrl: string
  ) {}

  /**
   * Set platform-specific local discovery provider
   * Must be called BEFORE init() to integrate with DiscoveryService
   */
  setLocalDiscoveryProvider(provider: LocalDiscoveryProvider): void {
    this.localDiscoveryProvider = provider;
  }

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('ConnectionModule missing required dependencies');
    }

    if (!this.deps.oneCore) {
      throw new Error('[ConnectionModule] OneCore dependency not injected - Instance not ready');
    }

    console.log('[ConnectionModule] Initializing connection plans...');

    // Prepare TrustPlan dependencies for automatic trust establishment
    const trustDeps: TrustPlanDependencies = {
      getAllEntries,
      getObject,
      ProfileModel,
      leuteModel: this.deps.leuteModel!
    };

    // Prepare pairing event callbacks for browser-specific handling
    const pairingCallbacks: PairingEventCallbacks = {
      onContactCreated: async (contact) => {
        console.log('[ConnectionModule] Contact created:', contact.displayName);
        // Contact is already in LeuteModel - browser just needs to refresh UI
        this.onContactsChanged.emit();
      },

      onTopicCreated: async (topic) => {
        console.log('[ConnectionModule] Topic created:', topic.channelId);
        // Topic is already created - browser just needs to refresh UI
        this.onTopicsChanged.emit();
      },

      onPairingComplete: async (details) => {
        console.log('[ConnectionModule] ✅ Pairing complete:', details.type);
        // Emit general event for UI updates
        this.onConnectionsChanged.emit();
      }
    };

    // Connection plan (platform-agnostic from connection.core)
    // Now automatically handles trust establishment via integrated TrustPlan
    // and fires callbacks for platform-specific UI updates
    this.connectionPlan = new ConnectionPlan(
      this.deps.oneCore,
      undefined,     // No storage provider for browser
      this.webUrl,   // Web URL for invite links (from env or default)
      undefined,     // No discovery config for browser
      trustDeps,     // Trust dependencies - enables automatic trust after pairing
      pairingCallbacks,  // Platform-specific UI updates
      this.deps.trustPlan,    // trust.core TrustPlan for automatic trust level assignment
      undefined     // No storyFactory
    );

    // CRITICAL: Register pairing handler with actual ConnectionsModel
    // This ensures the handler is registered even if oneCore.connectionsModel
    // was not ready during ConnectionPlan construction (timing issue)
    console.log('[ConnectionModule] Registering pairing handler...');
    console.log('[ConnectionModule] connectionsModel available:', !!this.deps.connectionsModel);
    console.log('[ConnectionModule] connectionsModel.pairing available:', !!(this.deps.connectionsModel as any)?.pairing);
    if (this.deps.connectionsModel) {
      this.connectionPlan.registerPairingHandler(this.deps.connectionsModel);
    } else {
      console.error('[ConnectionModule] ❌ Cannot register pairing handler - no ConnectionsModel!');
    }

    // Wire up mesh propagation support (for automatic group sharing to new P2P connections)
    if (this.deps.topicGroupManager) {
      this.connectionPlan.setTopicGroupManager(this.deps.topicGroupManager);
      console.log('[ConnectionModule] TopicGroupManager wired to ConnectionPlan for mesh propagation');
    }
    if (this.deps.oneCore?.paranoiaLevel !== undefined) {
      this.connectionPlan.setParanoiaLevel(this.deps.oneCore.paranoiaLevel);
      console.log('[ConnectionModule] Paranoia level set:', this.deps.oneCore.paranoiaLevel);
    }

    // Group chat plan dependencies (platform-agnostic from connection.core)
    const groupChatDeps: GroupChatPlanDependencies = {
      // ONE.core storage functions
      storeVersionedObject,
      storeUnversionedObject,
      getObjectByIdHash,
      calculateIdHashOfObj,

      // Access control - use ONE.core's createAccess API
      grantReadAccess: async (hash: any, personId: any) => {
        try {
          await createAccess([{
            object: hash,
            person: [personId],
            group: [],
            mode: SET_ACCESS_MODE.ADD
          }]);
        } catch (error) {
          console.error('[ConnectionModule/GroupChatPlan] Failed to grant read access:', error);
          throw error;
        }
      },

      // Leute model for trust and identity
      leuteModel: {
        myMainIdentity: async () => this.deps.leuteModel!.myMainIdentity(),
        others: async () => {
          const others = await this.deps.leuteModel!.others();
          // Convert SomeoneModel[] to SHA256IdHash<Person>[]
          return others.map((someone: any) => someone.personId) as any[];
        },
        trust: {
          certify: (certType: 'AffirmationCertificate', params: any) => this.deps.leuteModel!.trust.certify(certType, params),
          isAffirmedBy: (hash: any, affirmerId: any) => this.deps.leuteModel!.trust.isAffirmedBy(hash, affirmerId),
          affirmedBy: (hash: any) => this.deps.leuteModel!.trust.affirmedBy(hash),
          refreshCaches: () => this.deps.leuteModel!.trust.refreshCaches()
        }
      },

      // Channel manager for group chat channels
      // Note: This adapter maps the old string-based channel API to the new participants-based API
      channelManager: {
        getOrCreateChannel: async (topicId: string, owner: any) => {
          // Create a channel with owner as the sole participant
          // The topicId is stored for reference but identity is based on participants
          const result = await this.deps.channelManager!.createChannel([owner], owner);
          // Cache the mapping for postToChannel
          this.channelParticipantsCache.set(topicId, result.participantsHash);
          return result;
        },
        postToChannel: async (topicId: string, message: any, owner?: any) => {
          // Look up the participantsHash from cache
          const participantsHash = this.channelParticipantsCache.get(topicId);
          if (!participantsHash) {
            console.warn(`[ConnectionModule] No cached participantsHash for topicId: ${topicId}`);
            return;
          }
          await this.deps.channelManager!.postToChannel(participantsHash, message, owner);
        }
      }
    };

    // Group chat plan (platform-agnostic from connection.core)
    this.groupChatPlan = new GroupChatPlan(groupChatDeps);

    // Discovery service for QuicVC device discovery
    // Platform-specific providers (UDP, BTLE) can be set via setLocalDiscoveryProvider
    this.discoveryService = new DiscoveryService();
    await this.discoveryService.initialize({
      localDiscovery: this.localDiscoveryProvider
    });

    console.log('[ConnectionModule] ✅ Initialized with ConnectionPlan, GroupChatPlan, and DiscoveryService');
  }

  async shutdown(): Promise<void> {
    // DiscoveryService has shutdown, Plans don't
    await this.discoveryService?.shutdown?.();

    console.log('[ConnectionModule] Shutdown complete');
  }

  setDependency(targetType: string, instance: any): void {
    const key = targetType.charAt(0).toLowerCase() + targetType.slice(1);
    this.deps[key as keyof typeof this.deps] = instance;
  }

  emitSupplies(registry: any): void {
    registry.supply('ConnectionPlan', this.connectionPlan);
    registry.supply('GroupChatPlan', this.groupChatPlan);
    registry.supply('DiscoveryService', this.discoveryService);
  }

  private hasRequiredDeps(): boolean {
    return !!(
      this.deps.oneCore &&
      this.deps.leuteModel &&
      this.deps.channelManager &&
      this.deps.topicModel &&
      this.deps.connectionsModel &&
      this.deps.trustPlan
    );
  }
}
