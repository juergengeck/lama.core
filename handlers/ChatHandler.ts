/**
 * Chat Handler (Pure Business Logic)
 *
 * Transport-agnostic handler for chat operations.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Pattern based on refinio.api handler architecture.
 */

import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';

// Request/Response types
export interface InitializeDefaultChatsRequest {
  // No parameters
}

export interface InitializeDefaultChatsResponse {
  success: boolean;
  error?: string;
}

export interface UIReadyRequest {
  // No parameters
}

export interface UIReadyResponse {
  success: boolean;
  error?: string;
}

export interface SendMessageRequest {
  conversationId: string;
  text: string;
  attachments?: any[];
}

export interface SendMessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface GetMessagesRequest {
  conversationId: string;
  limit?: number;
  offset?: number;
}

export interface GetMessagesResponse {
  success: boolean;
  messages?: any[];
  total?: number;
  hasMore?: boolean;
  error?: string;
}

export interface CreateConversationRequest {
  type?: string;
  participants?: any[];
  name?: string | null;
}

export interface CreateConversationResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface GetConversationsRequest {
  limit?: number;
  offset?: number;
}

export interface GetConversationsResponse {
  success: boolean;
  data?: any[];
  error?: string;
}

export interface GetConversationRequest {
  conversationId: string;
}

export interface GetConversationResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface GetCurrentUserRequest {
  // No parameters
}

export interface GetCurrentUserResponse {
  success: boolean;
  user?: {
    id: string;
    name: string;
  };
  error?: string;
}

export interface AddParticipantsRequest {
  conversationId: string;
  participantIds: string[];
}

export interface AddParticipantsResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface ClearConversationRequest {
  conversationId: string;
}

export interface ClearConversationResponse {
  success: boolean;
  error?: string;
}

export interface EditMessageRequest {
  messageId: string;
  conversationId: string;
  newText: string;
  editReason?: string;
}

export interface EditMessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface DeleteMessageRequest {
  messageId: string;
  conversationId: string;
  reason?: string;
}

export interface DeleteMessageResponse {
  success: boolean;
  error?: string;
}

export interface GetMessageHistoryRequest {
  messageId: string;
}

export interface GetMessageHistoryResponse {
  success: boolean;
  history?: any[];
  error?: string;
}

export interface ExportMessageCredentialRequest {
  messageId: string;
}

export interface ExportMessageCredentialResponse {
  success: boolean;
  credential?: string;
  error?: string;
}

export interface VerifyMessageAssertionRequest {
  certificateHash: string;
  messageHash: string;
}

export interface VerifyMessageAssertionResponse {
  success: boolean;
  valid?: boolean;
  error?: string;
}

/**
 * ChatHandler - Pure business logic for chat operations
 *
 * Dependencies injected via constructor:
 * - nodeOneCore: The ONE.core instance with topicModel, leuteModel, etc.
 * - stateManager: State management service
 * - messageVersionManager: Message versioning manager
 * - messageAssertionManager: Message assertion/certificate manager
 */
export class ChatHandler {
  private nodeOneCore: any;
  private stateManager: any;
  private messageVersionManager: any;
  private messageAssertionManager: any;

  constructor(
    nodeOneCore: any,
    stateManager?: any,
    messageVersionManager?: any,
    messageAssertionManager?: any
  ) {
    this.nodeOneCore = nodeOneCore;
    this.stateManager = stateManager;
    this.messageVersionManager = messageVersionManager;
    this.messageAssertionManager = messageAssertionManager;
  }

  /**
   * Set message managers after initialization
   */
  setMessageManagers(versionManager: any, assertionManager: any): void {
    this.messageVersionManager = versionManager;
    this.messageAssertionManager = assertionManager;
  }

  /**
   * Initialize default chats
   */
  async initializeDefaultChats(request: InitializeDefaultChatsRequest): Promise<InitializeDefaultChatsResponse> {
    console.log('[ChatHandler] Initializing default chats');

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.topicModel) {
        return { success: false, error: 'Node not ready' };
      }

      // Don't create any chats here - they should only be created when we have an AI model
      console.log('[ChatHandler] Skipping chat creation - will create when model is selected');

      return { success: true };
    } catch (error) {
      console.error('[ChatHandler] Error initializing default chats:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * UI ready signal
   */
  async uiReady(request: UIReadyRequest): Promise<UIReadyResponse> {
    console.log('[ChatHandler] UI signaled ready for messages');

    try {
      // Notify the PeerMessageListener that UI is ready (platform-specific)
      if (this.nodeOneCore.peerMessageListener) {
        // This will be handled by the platform-specific adapter
        console.log('[ChatHandler] PeerMessageListener available');
      }
      return { success: true };
    } catch (error) {
      console.error('[ChatHandler] Error in uiReady:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    console.log('[ChatHandler] Send message:', { conversationId: request.conversationId, text: request.text });

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.topicModel) {
        throw new Error('TopicModel not initialized');
      }

      const userId = this.nodeOneCore.ownerId || this.stateManager?.getState('user.id');
      if (!userId) {
        throw new Error('User not authenticated');
      }

      // Validate conversationId
      if (!request.conversationId || typeof request.conversationId !== 'string') {
        throw new Error(`Invalid conversationId: ${request.conversationId}`);
      }

      if (!request.text || request.text.trim().length === 0) {
        throw new Error('Message text cannot be empty');
      }

      // Get topic room
      let topicRoom: any;
      try {
        topicRoom = await this.nodeOneCore.topicModel.enterTopicRoom(request.conversationId);
      } catch (error) {
        console.error('[ChatHandler] Topic does not exist for conversation:', request.conversationId);
        throw new Error(`Topic ${request.conversationId} not found. Topics should be created before sending messages.`);
      }

      // Determine if P2P or group
      const isP2P = request.conversationId.includes('<->');
      const channelOwner = isP2P ? null : this.nodeOneCore.ownerId;

      // Send message with or without attachments
      if (request.attachments && request.attachments.length > 0) {
        const attachmentHashes = request.attachments.map(att => {
          if (typeof att === 'string') return att;
          return att.hash || att.id;
        }).filter(Boolean);

        await topicRoom.sendMessageWithAttachmentAsHash(
          request.text || '',
          attachmentHashes,
          undefined,
          channelOwner
        );
      } else {
        await topicRoom.sendMessage(request.text, undefined, channelOwner);
      }

      return {
        success: true,
        data: {
          conversationId: request.conversationId,
          text: request.text,
          attachments: request.attachments || [],
          timestamp: Date.now()
        }
      };
    } catch (error) {
      console.error('[ChatHandler] Error sending message:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(request: GetMessagesRequest): Promise<GetMessagesResponse> {
    console.log('[ChatHandler] Get messages:', request.conversationId);

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.topicModel) {
        throw new Error('TopicModel not initialized');
      }

      const limit = request.limit || 50;
      const offset = request.offset || 0;

      // Get topic room
      const topicRoom = await this.nodeOneCore.topicModel.enterTopicRoom(request.conversationId);
      if (!topicRoom) {
        throw new Error(`Topic not found: ${request.conversationId}`);
      }

      // Retrieve all messages
      const allMessages = await topicRoom.retrieveAllMessages();

      // Sort by timestamp descending (newest first)
      const sortedMessages = allMessages.sort((a: any, b: any) => {
        const timeA = a.creationTime || 0;
        const timeB = b.creationTime || 0;
        return timeB - timeA;
      });

      // Apply pagination
      const paginatedMessages = sortedMessages.slice(offset, offset + limit);
      const hasMore = sortedMessages.length > offset + limit;

      return {
        success: true,
        messages: paginatedMessages,
        total: sortedMessages.length,
        hasMore
      };
    } catch (error) {
      console.error('[ChatHandler] Error getting messages:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Create a new conversation
   */
  async createConversation(request: CreateConversationRequest): Promise<CreateConversationResponse> {
    console.log('[ChatHandler] Create conversation:', request);

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.topicModel) {
        throw new Error('Models not initialized');
      }

      const userId = this.nodeOneCore.ownerId || this.stateManager?.getState('user.id');
      if (!userId) {
        throw new Error('User not authenticated');
      }

      const type = request.type || 'direct';
      const participants = request.participants || [];
      const name = request.name || `Conversation ${Date.now()}`;

      // Create topic using TopicModel
      const topic = await this.nodeOneCore.topicModel.createTopic(name);
      const topicId = String(await topic.idHash());

      console.log('[ChatHandler] Created topic:', topicId);

      return {
        success: true,
        data: {
          id: topicId,
          name,
          type,
          participants: [String(userId), ...participants],
          created: Date.now()
        }
      };
    } catch (error) {
      console.error('[ChatHandler] Error creating conversation:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get all conversations
   */
  async getConversations(request: GetConversationsRequest): Promise<GetConversationsResponse> {
    console.log('[ChatHandler] Get conversations');

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.topicModel) {
        throw new Error('TopicModel not initialized');
      }

      const limit = request.limit || 20;
      const offset = request.offset || 0;

      // Get all topics
      const topics = await this.nodeOneCore.topicModel.getAllTopics();

      // Convert to conversation format
      const conversations = await Promise.all(
        topics.map(async (topic: any) => {
          const topicId = String(await topic.idHash());
          const name = await topic.name();

          // Check if AI topic
          let isAITopic = false;
          let aiModelId = null;
          if (this.nodeOneCore.aiAssistantModel) {
            isAITopic = this.nodeOneCore.aiAssistantModel.isAITopic(topicId);
            if (isAITopic) {
              aiModelId = this.nodeOneCore.aiAssistantModel.getModelIdForTopic(topicId);
            }
          }

          return {
            id: topicId,
            name: name || topicId,
            type: 'chat',
            participants: topic.members || [],
            lastActivity: topic.lastActivity || Date.now(),
            unreadCount: 0,
            isAITopic,
            aiModelId
          };
        })
      );

      // Sort by last activity
      const sortedConversations = conversations.sort((a, b) => b.lastActivity - a.lastActivity);

      // Apply pagination
      const paginatedConversations = sortedConversations.slice(offset, offset + limit);

      return {
        success: true,
        data: paginatedConversations
      };
    } catch (error) {
      console.error('[ChatHandler] Error getting conversations:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get a single conversation
   */
  async getConversation(request: GetConversationRequest): Promise<GetConversationResponse> {
    console.log('[ChatHandler] Get conversation:', request.conversationId);

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.topicModel) {
        throw new Error('Node not initialized');
      }

      // Try to get the topic
      const topic: any = await this.nodeOneCore.topicModel.topics.queryById(request.conversationId);

      if (!topic) {
        throw new Error(`Conversation not found: ${request.conversationId}`);
      }

      // Convert to conversation format
      const conversation: any = {
        id: topic.id,
        name: topic.name || topic.id,
        createdAt: topic.creationTime ? new Date(topic.creationTime).toISOString() : new Date().toISOString(),
        participants: topic.members || []
      };

      // Add AI participant info
      if (this.nodeOneCore.aiAssistantModel) {
        const aiContacts = this.nodeOneCore.aiAssistantModel.getAllContacts();

        conversation.isAITopic = this.nodeOneCore.aiAssistantModel.isAITopic(conversation.id);
        conversation.hasAIParticipant = conversation.participants?.some((participantId: string) =>
          aiContacts.some((contact: any) => contact.personId === participantId)
        ) || false;

        if (conversation.isAITopic) {
          conversation.aiModelId = this.nodeOneCore.aiAssistantModel.getModelIdForTopic(conversation.id);
        }
      }

      return {
        success: true,
        data: conversation
      };
    } catch (error) {
      console.error('[ChatHandler] Error getting conversation:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get current user
   */
  async getCurrentUser(request: GetCurrentUserRequest): Promise<GetCurrentUserResponse> {
    console.log('[ChatHandler] Get current user');

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.ownerId) {
        // Fallback to state manager
        const userId = this.stateManager?.getState('user.id');
        const userName = this.stateManager?.getState('user.name');

        if (userId) {
          return {
            success: true,
            user: {
              id: userId,
              name: userName || 'User'
            }
          };
        }

        return {
          success: false,
          error: 'User not authenticated'
        };
      }

      // Get from ONE.core instance
      const ownerId = this.nodeOneCore.ownerId;
      let userName = 'User';

      // Try to get name from LeuteModel
      if (this.nodeOneCore.leuteModel) {
        try {
          const me: any = await this.nodeOneCore.leuteModel.me();
          if (me) {
            const profile: any = await me.mainProfile();
            if (profile?.personDescriptions?.length > 0) {
              const nameDesc = profile.personDescriptions.find((d: any) =>
                d.$type$ === 'PersonName' && d.name
              );
              if (nameDesc?.name) {
                userName = nameDesc.name;
              }
            }
          }
        } catch (e) {
          console.warn('[ChatHandler] Could not get user profile:', e);
        }
      }

      return {
        success: true,
        user: {
          id: String(ownerId),
          name: userName
        }
      };
    } catch (error) {
      console.error('[ChatHandler] Error getting current user:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Add participants to a conversation
   */
  async addParticipants(request: AddParticipantsRequest): Promise<AddParticipantsResponse> {
    console.log('[ChatHandler] Add participants:', request);

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.topicModel) {
        throw new Error('Models not initialized');
      }

      // Get topic room
      const topicRoom = await this.nodeOneCore.topicModel.enterTopicRoom(request.conversationId);
      if (!topicRoom) {
        throw new Error(`Topic not found: ${request.conversationId}`);
      }

      // Add participants
      // TODO: Implement actual participant addition logic
      console.log('[ChatHandler] Adding participants:', request.participantIds);

      return {
        success: true,
        data: {
          conversationId: request.conversationId,
          addedParticipants: request.participantIds
        }
      };
    } catch (error) {
      console.error('[ChatHandler] Error adding participants:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Clear a conversation
   */
  async clearConversation(request: ClearConversationRequest): Promise<ClearConversationResponse> {
    console.log('[ChatHandler] Clear conversation:', request.conversationId);

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.topicModel) {
        throw new Error('Models not initialized');
      }

      // Get topic room
      const topicRoom = await this.nodeOneCore.topicModel.enterTopicRoom(request.conversationId);
      if (!topicRoom) {
        throw new Error(`Topic not found: ${request.conversationId}`);
      }

      // Clear conversation
      // TODO: Implement actual clear logic
      console.log('[ChatHandler] Clearing conversation:', request.conversationId);

      return { success: true };
    } catch (error) {
      console.error('[ChatHandler] Error clearing conversation:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Edit a message
   */
  async editMessage(request: EditMessageRequest): Promise<EditMessageResponse> {
    console.log('[ChatHandler] Edit message:', request.messageId);

    try {
      if (!this.messageVersionManager) {
        throw new Error('Message version manager not initialized');
      }

      // Create new version
      const result = await this.messageVersionManager.createNewVersion(
        request.messageId,
        request.newText,
        request.editReason
      );

      return {
        success: true,
        data: {
          messageId: request.messageId,
          newVersion: result.newVersionHash,
          editedAt: Date.now()
        }
      };
    } catch (error) {
      console.error('[ChatHandler] Error editing message:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(request: DeleteMessageRequest): Promise<DeleteMessageResponse> {
    console.log('[ChatHandler] Delete message:', request.messageId);

    try {
      if (!this.messageVersionManager) {
        throw new Error('Message version manager not initialized');
      }

      // Mark as deleted
      await this.messageVersionManager.markAsDeleted(request.messageId, request.reason);

      return { success: true };
    } catch (error) {
      console.error('[ChatHandler] Error deleting message:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get message history
   */
  async getMessageHistory(request: GetMessageHistoryRequest): Promise<GetMessageHistoryResponse> {
    console.log('[ChatHandler] Get message history:', request.messageId);

    try {
      if (!this.messageVersionManager) {
        throw new Error('Message version manager not initialized');
      }

      const history = await this.messageVersionManager.getVersionHistory(request.messageId);

      return {
        success: true,
        history
      };
    } catch (error) {
      console.error('[ChatHandler] Error getting message history:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Export message credential
   */
  async exportMessageCredential(request: ExportMessageCredentialRequest): Promise<ExportMessageCredentialResponse> {
    console.log('[ChatHandler] Export message credential:', request.messageId);

    try {
      if (!this.messageAssertionManager) {
        throw new Error('Message assertion manager not initialized');
      }

      const credential = await this.messageAssertionManager.exportCredential(request.messageId);

      return {
        success: true,
        credential
      };
    } catch (error) {
      console.error('[ChatHandler] Error exporting credential:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Verify message assertion
   */
  async verifyMessageAssertion(request: VerifyMessageAssertionRequest): Promise<VerifyMessageAssertionResponse> {
    console.log('[ChatHandler] Verify message assertion');

    try {
      if (!this.messageAssertionManager) {
        throw new Error('Message assertion manager not initialized');
      }

      const valid = await this.messageAssertionManager.verifyAssertion(
        request.certificateHash,
        request.messageHash
      );

      return {
        success: true,
        valid
      };
    } catch (error) {
      console.error('[ChatHandler] Error verifying assertion:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
}
