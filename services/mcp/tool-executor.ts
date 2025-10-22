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
}
