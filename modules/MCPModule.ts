/**
 * MCPModule - Remote MCP client for browser/mobile platforms
 *
 * Provides MCP tool execution via chat messages to Node.js peers.
 * Uses @mcp/core/remote which is platform-agnostic.
 *
 * Demands:
 * - LeuteModel (for person ID)
 * - ChatPlan (for sending messages)
 *
 * Supplies:
 * - MCPDemandManager (credential management)
 * - MCPRemoteClient (tool execution)
 */
import type { Module } from '@refinio/api';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import { MCPDemandManager, MCPRemoteClient } from '@mcp/core/remote';

export interface MCPModuleDependencies {
  leuteModel?: LeuteModel;
  chatPlan?: {
    sendMessage: (params: { conversationId: string; content: any }) => Promise<void>;
  };
}

/**
 * MCPModule - Remote MCP client
 *
 * Enables browser/mobile clients to execute MCP tools on Node.js peers
 * by sending requests via chat messages and receiving responses.
 */
export class MCPModule implements Module {
  readonly name = 'MCPModule';

  static demands = [
    { targetType: 'LeuteModel', required: true },
    { targetType: 'ChatPlan', required: true }
  ];

  static supplies = [
    { targetType: 'MCPDemandManager' },
    { targetType: 'MCPRemoteClient' }
  ];

  private deps: MCPModuleDependencies = {};

  public demandManager!: MCPDemandManager;
  public remoteClient!: MCPRemoteClient;

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('MCPModule missing required dependencies (LeuteModel, ChatPlan)');
    }

    console.log('[MCPModule] Initializing...');

    // Create demand manager
    this.demandManager = new MCPDemandManager();

    // Initialize with our person ID
    const myPersonId = await this.deps.leuteModel!.myMainIdentity();
    if (myPersonId) {
      this.demandManager.initialize(myPersonId as SHA256IdHash);
      console.log('[MCPModule] Initialized demand manager with person ID:', String(myPersonId).substring(0, 8));
    } else {
      console.warn('[MCPModule] No person ID available yet - demand manager not initialized');
    }

    // Create remote client
    this.remoteClient = new MCPRemoteClient({
      demandManager: this.demandManager,
      sendMessage: async (topicId: SHA256IdHash, message: any) => {
        // Send MCP request via chat
        await this.deps.chatPlan!.sendMessage({
          conversationId: String(topicId),
          content: message
        });
      }
    });

    console.log('[MCPModule] Initialized successfully');
  }

  async shutdown(): Promise<void> {
    console.log('[MCPModule] Shutting down...');

    // Cancel any pending requests
    this.remoteClient?.cancelAllRequests?.();

    console.log('[MCPModule] Shutdown complete');
  }

  setDependency(targetType: string, instance: any): void {
    const key = targetType.charAt(0).toLowerCase() + targetType.slice(1);
    this.deps[key as keyof MCPModuleDependencies] = instance;
  }

  emitSupplies(registry: any): void {
    registry.supply('MCPDemandManager', this.demandManager);
    registry.supply('MCPRemoteClient', this.remoteClient);
  }

  private hasRequiredDeps(): boolean {
    return !!this.deps.leuteModel && !!this.deps.chatPlan;
  }

  /**
   * Request MCP access in a topic
   * This creates an MCPDemand that Node.js peers can respond to
   */
  async requestAccess(topicId: SHA256IdHash): Promise<void> {
    await this.demandManager.createDemand(topicId);
    console.log('[MCPModule] Requested MCP access in topic:', String(topicId).substring(0, 8));
  }

  /**
   * Call a tool on a remote Node.js peer
   */
  async callTool(params: {
    toolName: string;
    parameters: Record<string, unknown>;
    topicId: SHA256IdHash;
    targetPersonId: SHA256IdHash;
  }): Promise<any> {
    return await this.remoteClient.callTool(params);
  }

  /**
   * Get available MCP providers in a topic
   */
  getAvailableProviders(topicId: SHA256IdHash): SHA256IdHash[] {
    return this.remoteClient.getAvailableProviders(topicId);
  }

  /**
   * Check if we have MCP access to a provider
   */
  hasAccess(topicId: SHA256IdHash, providerPersonId: SHA256IdHash): boolean {
    return this.remoteClient.hasAccess(topicId, providerPersonId);
  }
}
