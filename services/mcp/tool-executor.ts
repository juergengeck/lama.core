/**
 * MCP Tool Executor
 * Platform-agnostic business logic for executing MCP tools
 */

import type {
  MCPToolResult,
  MCPToolContext,
  MCPToolDependencies,
  MCPToolExecutor as IMCPToolExecutor,
  MCPToolDefinition
} from './types.js';
import { allTools, getToolDefinition } from './tool-definitions.js';

/**
 * Create a text result
 */
function createTextResult(text: string, isError = false): MCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text
      }
    ],
    isError
  };
}

/**
 * Create an error result
 */
function createErrorResult(error: Error | string): MCPToolResult {
  const message = error instanceof Error ? error.message : error;
  return createTextResult(`Error: ${message}`, true);
}

/**
 * MCP Tool Executor Implementation
 */
export class MCPToolExecutor implements IMCPToolExecutor {
  constructor(private deps: MCPToolDependencies) {}

  getToolDefinitions(): MCPToolDefinition[] {
    return allTools;
  }

  hasTool(toolName: string): boolean {
    return getToolDefinition(toolName) !== undefined;
  }

  async execute(
    toolName: string,
    parameters: Record<string, any>,
    context?: MCPToolContext
  ): Promise<MCPToolResult> {
    const toolDef = getToolDefinition(toolName);
    if (!toolDef) {
      return createErrorResult(`Unknown tool: ${toolName}`);
    }

    if (!this.deps.nodeOneCore) {
      return createErrorResult('ONE.core not initialized. LAMA tools are not available yet.');
    }

    try {
      switch (toolName) {
        // Chat operations
        case 'send_message':
          return await this.sendMessage(parameters.topicId, parameters.message);
        case 'get_messages':
          return await this.getMessages(parameters.topicId, parameters.limit);
        case 'list_topics':
          return await this.listTopics();

        // Contact operations
        case 'get_contacts':
          return await this.getContacts();
        case 'search_contacts':
          return await this.searchContacts(parameters.query);

        // Connection operations
        case 'list_connections':
          return await this.listConnections();
        case 'create_invitation':
          return await this.createInvitation();

        // LLM operations
        case 'list_models':
          return await this.listModels();
        case 'load_model':
          return await this.loadModel(parameters.modelId);

        // AI Assistant operations
        case 'create_ai_topic':
          return await this.createAITopic(parameters.modelId);
        case 'generate_ai_response':
          return await this.generateAIResponse(
            parameters.message,
            parameters.modelId,
            parameters.topicId
          );

        // Memory operations - Chat integration
        case 'enable_chat_memories':
          return await this.enableChatMemories(
            parameters.topicId,
            parameters.autoExtract,
            parameters.keywords
          );
        case 'disable_chat_memories':
          return await this.disableChatMemories(parameters.topicId);
        case 'toggle_chat_memories':
          return await this.toggleChatMemories(parameters.topicId);
        case 'extract_chat_subjects':
          return await this.extractChatSubjects(
            parameters.topicId,
            parameters.limit
          );
        case 'find_chat_memories':
          return await this.findChatMemories(
            parameters.topicId,
            parameters.keywords,
            parameters.limit
          );
        case 'get_chat_memory_status':
          return await this.getChatMemoryStatus(parameters.topicId);

        // Memory operations - Subject storage
        case 'store_subject':
          return await this.storeSubject(parameters);
        case 'retrieve_subject':
          return await this.retrieveSubject(
            parameters.idHash,
            parameters.verifySignature
          );
        case 'list_subjects':
          return await this.listSubjects();
        case 'update_subject':
          return await this.updateSubject(parameters.idHash, parameters);
        case 'delete_subject':
          return await this.deleteSubject(parameters.idHash);
        case 'export_subject_html':
          return await this.exportSubjectHtml(parameters.idHash);

        default:
          return createErrorResult(`Tool ${toolName} not implemented`);
      }
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  // Chat tool implementations
  private async sendMessage(topicId: string, message: string): Promise<MCPToolResult> {
    try {
      const topicRoom = await this.deps.nodeOneCore.topicModel.enterTopicRoom(topicId);
      await topicRoom.sendMessage(message);
      return createTextResult(`Message sent to topic ${topicId}`);
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async getMessages(topicId: string, limit = 10): Promise<MCPToolResult> {
    try {
      const messages = await this.deps.nodeOneCore.topicModel.getMessages(topicId, limit);
      return createTextResult(JSON.stringify(messages, null, 2));
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async listTopics(): Promise<MCPToolResult> {
    try {
      const topics = await this.deps.nodeOneCore.topicModel.getTopics();
      const topicList = topics.map((t: any) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        memberCount: t.members?.length
      }));
      return createTextResult(JSON.stringify(topicList, null, 2));
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  // Contact tool implementations
  private async getContacts(): Promise<MCPToolResult> {
    try {
      const contacts = await this.deps.nodeOneCore.getContacts();
      return createTextResult(JSON.stringify(contacts, null, 2));
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async searchContacts(query: string): Promise<MCPToolResult> {
    try {
      const contacts = await this.deps.nodeOneCore.getContacts();
      const filtered = contacts.filter(
        (c: any) =>
          c.name?.toLowerCase().includes(query.toLowerCase()) || c.id?.includes(query)
      );
      return createTextResult(JSON.stringify(filtered, null, 2));
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  // Connection tool implementations
  private async listConnections(): Promise<MCPToolResult> {
    try {
      const connections = this.deps.nodeOneCore.connectionsModel?.connectionsInfo() || [];
      return createTextResult(JSON.stringify(connections, null, 2));
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async createInvitation(): Promise<MCPToolResult> {
    try {
      if (!this.deps.nodeOneCore.connectionsModel?.pairing) {
        throw new Error('Pairing manager not available');
      }

      const invitation: any = await this.deps.nodeOneCore.connectionsModel.pairing.createInvitation();
      return createTextResult(`Invitation created:\n${invitation.url}`);
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  // LLM tool implementations
  private async listModels(): Promise<MCPToolResult> {
    try {
      const models = this.deps.aiAssistantModel?.getAvailableLLMModels
        ? this.deps.aiAssistantModel.getAvailableLLMModels()
        : [];
      const modelList = models.map((m: any) => ({
        id: m.id,
        name: m.name,
        displayName: m.displayName,
        personId: m.personId
      }));
      return createTextResult(JSON.stringify(modelList, null, 2));
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async loadModel(modelId: string): Promise<MCPToolResult> {
    try {
      if (!this.deps.aiAssistantModel?.llmManager) {
        throw new Error('LLM Manager not available');
      }

      await this.deps.aiAssistantModel.llmManager.loadModel(modelId);
      return createTextResult(`Model ${modelId} loaded successfully`);
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  // AI Assistant tool implementations
  private async createAITopic(modelId: string): Promise<MCPToolResult> {
    try {
      if (!this.deps.aiAssistantModel) {
        throw new Error('AI Assistant not initialized');
      }

      const topicId = await this.deps.aiAssistantModel.getOrCreateAITopic(modelId);
      return createTextResult(`AI topic created: ${topicId} for model: ${modelId}`);
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async generateAIResponse(
    message: string,
    modelId: string,
    topicId?: string
  ): Promise<MCPToolResult> {
    try {
      if (!this.deps.aiAssistantModel) {
        throw new Error('AI Assistant not initialized');
      }

      const response = await this.deps.aiAssistantModel.generateResponse({
        message,
        modelId,
        topicId
      });
      return createTextResult(response);
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  // Memory tool implementations
  private async storeSubject(params: Record<string, any>): Promise<MCPToolResult> {
    try {
      if (!this.deps.memoryHandler) {
        throw new Error('Memory handler not initialized');
      }

      const metadata = params.metadata
        ? new Map(Object.entries(params.metadata))
        : undefined;

      const result = await this.deps.memoryHandler.createSubject({
        id: params.id,
        name: params.name,
        description: params.description,
        metadata,
        sign: params.sign || false,
        theme: params.theme || 'auto'
      });

      return createTextResult(
        `Subject stored successfully:\n` +
          `ID: ${params.id}\n` +
          `ID Hash: ${result.idHash}\n` +
          `File: ${result.filePath}`
      );
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async retrieveSubject(
    idHash: string,
    verifySignature = false
  ): Promise<MCPToolResult> {
    try {
      if (!this.deps.memoryHandler) {
        throw new Error('Memory handler not initialized');
      }

      const subject = await this.deps.memoryHandler.getSubject(idHash, { verifySignature });

      if (!subject) {
        throw new Error(`Subject not found: ${idHash}`);
      }

      const metadataObj = subject.metadata
        ? Object.fromEntries(subject.metadata)
        : {};

      const result = {
        id: subject.id,
        name: subject.name,
        description: subject.description,
        metadata: metadataObj,
        created: subject.created,
        modified: subject.modified
      };

      return createTextResult(JSON.stringify(result, null, 2));
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async listSubjects(): Promise<MCPToolResult> {
    try {
      if (!this.deps.memoryHandler) {
        throw new Error('Memory handler not initialized');
      }

      const idHashes = await this.deps.memoryHandler.listSubjects();

      const subjects = [];
      for (const idHash of idHashes) {
        const subject = await this.deps.memoryHandler.getSubject(idHash);
        if (subject) {
          subjects.push({
            idHash,
            id: subject.id,
            name: subject.name,
            created: subject.created
          });
        }
      }

      return createTextResult(JSON.stringify(subjects, null, 2));
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async updateSubject(
    idHash: string,
    params: Record<string, any>
  ): Promise<MCPToolResult> {
    try {
      if (!this.deps.memoryHandler) {
        throw new Error('Memory handler not initialized');
      }

      const metadata = params.metadata
        ? new Map(Object.entries(params.metadata))
        : undefined;

      const result = await this.deps.memoryHandler.updateSubject(idHash, {
        name: params.name,
        description: params.description,
        metadata,
        sign: params.sign,
        theme: params.theme
      });

      return createTextResult(
        `Subject updated successfully:\n` +
          `ID Hash: ${result.idHash}\n` +
          `File: ${result.filePath}`
      );
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async deleteSubject(idHash: string): Promise<MCPToolResult> {
    try {
      if (!this.deps.memoryHandler) {
        throw new Error('Memory handler not initialized');
      }

      const deleted = await this.deps.memoryHandler.deleteSubject(idHash);

      if (!deleted) {
        throw new Error(`Subject not found: ${idHash}`);
      }

      return createTextResult(`Subject deleted: ${idHash}`);
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async exportSubjectHtml(idHash: string): Promise<MCPToolResult> {
    try {
      if (!this.deps.memoryHandler) {
        throw new Error('Memory handler not initialized');
      }

      const html = await this.deps.memoryHandler.getSubjectHtml(idHash);

      if (!html) {
        throw new Error(`Subject HTML not found: ${idHash}`);
      }

      return createTextResult(html);
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  // Chat-Memory integration tool implementations
  private async enableChatMemories(
    topicId: string,
    autoExtract = true,
    keywords: string[] = []
  ): Promise<MCPToolResult> {
    try {
      if (!this.deps.chatMemoryHandler) {
        throw new Error('Chat memory handler not initialized');
      }

      const config = await this.deps.chatMemoryHandler.enableMemories(
        topicId as any,
        autoExtract,
        keywords
      );

      return createTextResult(
        `Memories enabled for topic ${topicId}\n` +
          `Auto-extract: ${config.autoExtract}\n` +
          `Keywords: ${keywords.join(', ') || 'none'}`
      );
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async disableChatMemories(topicId: string): Promise<MCPToolResult> {
    try {
      if (!this.deps.chatMemoryHandler) {
        throw new Error('Chat memory handler not initialized');
      }

      await this.deps.chatMemoryHandler.disableMemories(topicId as any);

      return createTextResult(`Memories disabled for topic ${topicId}`);
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async toggleChatMemories(topicId: string): Promise<MCPToolResult> {
    try {
      if (!this.deps.chatMemoryHandler) {
        throw new Error('Chat memory handler not initialized');
      }

      const enabled = await this.deps.chatMemoryHandler.toggleMemories(topicId as any);

      return createTextResult(
        `Memories ${enabled ? 'enabled' : 'disabled'} for topic ${topicId}`
      );
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async extractChatSubjects(
    topicId: string,
    limit = 50
  ): Promise<MCPToolResult> {
    try {
      if (!this.deps.chatMemoryHandler) {
        throw new Error('Chat memory handler not initialized');
      }

      const result = await this.deps.chatMemoryHandler.extractSubjects({
        topicId: topicId as any,
        limit
      });

      const summary = `Extracted ${result.subjects.length} subjects from ${result.totalMessages} messages\n` +
        `Processing time: ${result.processingTime}ms\n\n` +
        `Subjects:\n${result.subjects
          .map(s => `- ${s.name} (confidence: ${s.confidence.toFixed(2)})`)
          .join('\n')}`;

      return createTextResult(summary);
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async findChatMemories(
    topicId: string,
    keywords: string[],
    limit = 10
  ): Promise<MCPToolResult> {
    try {
      if (!this.deps.chatMemoryHandler) {
        throw new Error('Chat memory handler not initialized');
      }

      const result = await this.deps.chatMemoryHandler.findRelatedMemories(
        topicId as any,
        keywords,
        limit
      );

      const response = {
        totalFound: result.totalFound,
        searchKeywords: result.searchKeywords,
        memories: result.memories.map(m => ({
          name: m.name,
          keywords: m.keywords,
          relevance: m.relevanceScore.toFixed(2),
          lastUpdated: new Date(m.lastUpdated).toISOString()
        }))
      };

      return createTextResult(JSON.stringify(response, null, 2));
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }

  private async getChatMemoryStatus(topicId: string): Promise<MCPToolResult> {
    try {
      if (!this.deps.chatMemoryHandler) {
        throw new Error('Chat memory handler not initialized');
      }

      const status = this.deps.chatMemoryHandler.getMemoryStatus(topicId as any);

      const response = {
        enabled: status.enabled,
        config: status.config
          ? {
              autoExtract: status.config.autoExtract,
              updateInterval: status.config.updateInterval,
              minConfidence: status.config.minConfidence,
              keywords: status.config.keywords
            }
          : null
      };

      return createTextResult(JSON.stringify(response, null, 2));
    } catch (error) {
      return createErrorResult(error as Error);
    }
  }
}
