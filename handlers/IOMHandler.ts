/**
 * IOM Handler (Pure Business Logic)
 *
 * Transport-agnostic handler for IoM operations.
 * Delegates to one.models ConnectionsModel and ChannelManager.
 * Platform-specific operations (fs, storage) are injected.
 *
 * Can be used from both Electron IPC and Web Worker contexts.
 */

// Request/Response interfaces
export interface GetIOMInstancesRequest {}

export interface GetIOMInstancesResponse {
  instances: Instance[];
}

export interface Instance {
  id: string;
  name: string;
  type: string;
  role: string;
  status: string;
  endpoint: string;
  storage: StorageInfo;
  lastSync: string | null;
  replication: ReplicationInfo;
}

export interface StorageInfo {
  used: number;
  total: number;
  percentage: number;
}

export interface ReplicationInfo {
  inProgress: boolean;
  lastCompleted: string | null;
  queueSize: number;
  failedItems: number;
  errors: any[];
}

export interface CreatePairingInvitationRequest {}

export interface CreatePairingInvitationResponse {
  success: boolean;
  invitation?: {
    url: string;
    token: string;
  };
  error?: string;
}

export interface AcceptPairingInvitationRequest {
  invitationUrl: string;
}

export interface AcceptPairingInvitationResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface GetConnectionStatusRequest {}

export interface GetConnectionStatusResponse {
  connections: any[];
  syncing: boolean;
}

/**
 * IOMHandler - Pure business logic for IoM operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - nodeOneCore: Platform-specific ONE.core instance
 * - storageProvider: Platform-specific storage info provider (optional)
 */
export class IOMHandler {
  private nodeOneCore: any;
  private storageProvider: any;

  constructor(nodeOneCore: any, storageProvider?: any) {
    this.nodeOneCore = nodeOneCore;
    this.storageProvider = storageProvider;
  }

  /**
   * Get IOM instances - delegates to one.models
   */
  async getIOMInstances(request: GetIOMInstancesRequest): Promise<GetIOMInstancesResponse> {
    try {
      const instances: Instance[] = [];

      // Get node instance info from ONE.core
      if (this.nodeOneCore.initialized) {
        const coreInfo = this.nodeOneCore.getInfo();

        // Get connection status from ConnectionsModel
        const connectionStatus = this.getConnectionStatusFromModel();

        const nodeInstance: Instance = {
          id: coreInfo?.ownerId || 'node-' + Date.now(),
          name: 'Desktop Node',
          type: 'node',
          role: 'archive',
          status: connectionStatus.syncing ? 'syncing' : (coreInfo?.initialized ? 'online' : 'offline'),
          endpoint: 'local',
          storage: this.storageProvider ? await this.storageProvider.getNodeStorage() : this.getDefaultStorage(),
          lastSync: null, // Would come from ChannelManager sync history
          replication: {
            inProgress: connectionStatus.syncing,
            lastCompleted: null,
            queueSize: 0,
            failedItems: 0,
            errors: []
          }
        };

        instances.push(nodeInstance);
      }

      return { instances };
    } catch (error) {
      console.error('[IOMHandler] Failed to get instances:', error);
      throw error;
    }
  }

  /**
   * Create pairing invitation - delegates to ConnectionsModel.pairing
   */
  async createPairingInvitation(request: CreatePairingInvitationRequest): Promise<CreatePairingInvitationResponse> {
    try {
      if (!this.nodeOneCore.initialized) {
        return {
          success: false,
          error: 'Node instance not initialized. Please login first.'
        };
      }

      if (!this.nodeOneCore.connectionsModel?.pairing) {
        return {
          success: false,
          error: 'Pairing not available. Node instance may not be fully initialized.'
        };
      }

      console.log('[IOMHandler] Creating pairing invitation via ConnectionsModel...');

      // Use one.models pairing API
      const invitation = await this.nodeOneCore.connectionsModel.pairing.createInvitation();

      if (!invitation) {
        return {
          success: false,
          error: 'Failed to create pairing invitation'
        };
      }

      console.log('[IOMHandler] Invitation created:', {
        url: invitation.url,
        publicKey: invitation.publicKey
      });

      // Encode the entire invitation object for the URL fragment
      const invitationToken = encodeURIComponent(JSON.stringify(invitation));

      // Construct the invitation URL (platform-specific domain)
      const eddaDomain = 'edda.dev.refinio.one';
      const invitationUrl = `https://${eddaDomain}/invites/invitePartner/?invited=true/#${invitationToken}`;

      return {
        success: true,
        invitation: {
          url: invitationUrl,
          token: invitationToken
        }
      };
    } catch (error) {
      console.error('[IOMHandler] Failed to create pairing invitation:', error);
      return {
        success: false,
        error: (error as Error).message || 'Failed to create pairing invitation'
      };
    }
  }

  /**
   * Accept pairing invitation - delegates to ConnectionsModel.pairing
   */
  async acceptPairingInvitation(request: AcceptPairingInvitationRequest): Promise<AcceptPairingInvitationResponse> {
    try {
      if (!this.nodeOneCore.initialized) {
        return {
          success: false,
          error: 'Node instance not initialized. Please login first.'
        };
      }

      if (!this.nodeOneCore.connectionsModel?.pairing) {
        return {
          success: false,
          error: 'Pairing not available. Node instance may not be fully initialized.'
        };
      }

      console.log('[IOMHandler] Accepting pairing invitation:', request.invitationUrl);

      // Parse the invitation from the URL fragment
      const hashIndex = request.invitationUrl.indexOf('#');
      if (hashIndex === -1) {
        return {
          success: false,
          error: 'Invalid invitation URL: no fragment found'
        };
      }

      const fragment = request.invitationUrl.substring(hashIndex + 1);
      const invitationJson = decodeURIComponent(fragment);

      let invitation: any;
      try {
        invitation = JSON.parse(invitationJson);
      } catch (error) {
        console.error('[IOMHandler] Failed to parse invitation:', error);
        return {
          success: false,
          error: 'Invalid invitation format'
        };
      }

      const { token, url } = invitation;

      if (!token || !url) {
        return {
          success: false,
          error: 'Invalid invitation: missing token or URL'
        };
      }

      console.log('[IOMHandler] Accepting invitation with token:', String(token).substring(0, 20) + '...');
      console.log('[IOMHandler] Connection URL:', url);

      // Use one.models pairing API
      await this.nodeOneCore.connectionsModel.pairing.connectUsingInvitation(invitation);

      console.log('[IOMHandler] ✅ Connected using invitation');

      return {
        success: true,
        message: 'Invitation accepted successfully'
      };
    } catch (error) {
      console.error('[IOMHandler] Failed to accept invitation:', error);
      return {
        success: false,
        error: (error as Error).message || 'Failed to accept pairing invitation'
      };
    }
  }

  /**
   * Get connection status - delegates to ConnectionsModel
   */
  async getConnectionStatus(request: GetConnectionStatusRequest): Promise<GetConnectionStatusResponse> {
    try {
      const status = this.getConnectionStatusFromModel();
      return status;
    } catch (error) {
      console.error('[IOMHandler] Failed to get connection status:', error);
      return {
        connections: [],
        syncing: false
      };
    }
  }

  /**
   * Helper: Get connection status from ConnectionsModel
   */
  private getConnectionStatusFromModel(): GetConnectionStatusResponse {
    if (!this.nodeOneCore.connectionsModel) {
      return { connections: [], syncing: false };
    }

    // Use one.models APIs to get connection state
    const connections: any[] = [];
    let syncing = false;

    // ConnectionsModel tracks active connections
    if (this.nodeOneCore.connectionsModel.getActiveConnections) {
      const activeConnections = this.nodeOneCore.connectionsModel.getActiveConnections();
      connections.push(...activeConnections);
      syncing = activeConnections.length > 0;
    }

    return { connections, syncing };
  }

  /**
   * Helper: Get default storage info when provider not available
   */
  private getDefaultStorage(): StorageInfo {
    return {
      used: 0,
      total: 0,
      percentage: 0
    };
  }
}
