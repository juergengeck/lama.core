/**
 * MCP Tool Definitions for LAMA
 * Platform-agnostic tool schemas that can be exposed via MCP
 */

import type { MCPToolDefinition, MCPToolCategory } from './types.js';

export interface ToolDefinitionWithCategory extends MCPToolDefinition {
  category: MCPToolCategory;
}

/**
 * Chat Tools
 * Tools for message and topic management
 */
export const chatTools: ToolDefinitionWithCategory[] = [
  {
    name: 'send_message',
    category: 'chat',
    description: 'Send a message in a chat topic',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: {
          type: 'string',
          description: 'The topic/chat ID to send message to'
        },
        message: {
          type: 'string',
          description: 'The message content to send'
        }
      },
      required: ['topicId', 'message']
    }
  },
  {
    name: 'get_messages',
    category: 'chat',
    description: 'Get messages from a chat topic',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: {
          type: 'string',
          description: 'The topic/chat ID to get messages from'
        },
        limit: {
          type: 'number',
          description: 'Number of messages to retrieve',
          default: 10
        }
      },
      required: ['topicId']
    }
  },
  {
    name: 'list_topics',
    category: 'chat',
    description: 'List all available chat topics',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

/**
 * Contact Tools
 * Tools for contact management
 */
export const contactTools: ToolDefinitionWithCategory[] = [
  {
    name: 'get_contacts',
    category: 'contacts',
    description: 'Get list of contacts',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'search_contacts',
    category: 'contacts',
    description: 'Search for contacts by name or ID',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        }
      },
      required: ['query']
    }
  }
];

/**
 * Connection Tools
 * Tools for network connection management
 */
export const connectionTools: ToolDefinitionWithCategory[] = [
  {
    name: 'list_connections',
    category: 'connections',
    description: 'List all network connections',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'create_invitation',
    category: 'connections',
    description: 'Create a pairing invitation for a new connection',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

/**
 * LLM Tools
 * Tools for AI model management
 */
export const llmTools: ToolDefinitionWithCategory[] = [
  {
    name: 'list_models',
    category: 'llm',
    description: 'List available AI models',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'load_model',
    category: 'llm',
    description: 'Load an AI model',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: {
          type: 'string',
          description: 'The model ID to load'
        }
      },
      required: ['modelId']
    }
  }
];

/**
 * AI Assistant Tools
 * Tools for AI assistant operations
 */
export const aiAssistantTools: ToolDefinitionWithCategory[] = [
  {
    name: 'create_ai_topic',
    category: 'ai-assistant',
    description: 'Create a new AI-enabled chat topic',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: {
          type: 'string',
          description: 'The AI model ID for the topic'
        }
      },
      required: ['modelId']
    }
  },
  {
    name: 'generate_ai_response',
    category: 'ai-assistant',
    description: 'Generate an AI response for a message',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to respond to'
        },
        modelId: {
          type: 'string',
          description: 'The AI model to use'
        },
        topicId: {
          type: 'string',
          description: 'Optional topic ID for context'
        }
      },
      required: ['message', 'modelId']
    }
  }
];

/**
 * All available tool definitions
 */
export const allTools: ToolDefinitionWithCategory[] = [
  ...chatTools,
  ...contactTools,
  ...connectionTools,
  ...llmTools,
  ...aiAssistantTools
];

/**
 * Get tool definitions by category
 */
export function getToolsByCategory(category: MCPToolCategory): ToolDefinitionWithCategory[] {
  return allTools.filter(tool => tool.category === category);
}

/**
 * Get a specific tool definition by name
 */
export function getToolDefinition(name: string): ToolDefinitionWithCategory | undefined {
  return allTools.find(tool => tool.name === name);
}

/**
 * Get all tool names
 */
export function getAllToolNames(): string[] {
  return allTools.map(tool => tool.name);
}
