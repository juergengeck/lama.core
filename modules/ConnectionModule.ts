// packages/lama.browser/browser-ui/src/modules/ConnectionModule.ts
import type { Module } from '@refinio/api';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type ConnectionsModel from '@refinio/one.models/lib/models/ConnectionsModel.js';
import ProfileModel from '@refinio/one.models/lib/models/Leute/ProfileModel.js';
import {ConnectionPlan, type TrustPlanDependencies, type PairingEventCallbacks} from '@connection/core/plans/ConnectionPlan.js';
import {GroupChatPlan, type GroupChatPlanDependencies} from '@connection/core/plans/GroupChatPlan.js';
import {TrustPlan} from '@trust/core/plans/TrustPlan.js';
import {DiscoveryService} from '@connection/core';
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
    { targetType: 'TrustPlan', required: true }
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
  } = {};

  // Connection Plans
  public connectionPlan: ConnectionPlan;
  public groupChatPlan: GroupChatPlan;

  // Discovery Service
  public discoveryService: DiscoveryService;

  // Event emitters for platform-specific UI updates
  public onContactsChanged = new OEvent<() => void>();
  public onTopicsChanged = new OEvent<() => void>();
  public onConnectionsChanged = new OEvent<() => void>();

  constructor(
    private commServerUrl: string,
    private webUrl: string
  ) {}

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
      undefined,     // No storyFactory
      this.commServerUrl  // CommServer URL for WebRTC signaling
    );

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
      channelManager: {
        getOrCreateChannel: async (channelId: string, owner: any) => {
          // Get existing channels
          const existingChannels = await this.deps.channelManager!.channels();
          const existing = existingChannels.find((ch: any) => ch.id === channelId && ch.owner === owner);
          if (existing) return existing;
          // Create new channel
          return this.deps.channelManager!.createChannel(channelId, owner);
        },
        postToChannel: (topicId: string, message: any, owner?: any) =>
          this.deps.channelManager!.postToChannel(topicId, message, owner)
      }
    };

    // Group chat plan (platform-agnostic from connection.core)
    this.groupChatPlan = new GroupChatPlan(groupChatDeps);

    // Discovery service for QuicVC device discovery
    // Note: Browser doesn't have platform-specific local/relay discovery providers yet
    // This creates the service in an uninitialized state for future integration
    this.discoveryService = new DiscoveryService();
    await this.discoveryService.initialize();

    console.log('[ConnectionModule] ✅ Initialized with ConnectionPlan, GroupChatPlan, and DiscoveryService');
  }

  async shutdown(): Promise<void> {
    await this.discoveryService?.shutdown?.();
    await this.groupChatPlan?.shutdown?.();
    await this.connectionPlan?.shutdown?.();

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
