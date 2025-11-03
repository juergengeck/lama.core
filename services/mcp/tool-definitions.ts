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
 * Memory Tools
 * Tools for storing and retrieving assembly objects with styling and signatures
 */
export const memoryTools: ToolDefinitionWithCategory[] = [
  // Chat-Memory Integration Tools
  {
    name: 'enable_chat_memories',
    category: 'memory',
    description: 'Enable automatic subject extraction and memory creation for a chat topic',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: {
          type: 'string',
          description: 'Chat topic ID to enable memories for'
        },
        autoExtract: {
          type: 'boolean',
          description: 'Automatically extract subjects from new messages',
          default: true
        },
        keywords: {
          type: 'array',
          description: 'Additional keywords to track'
        }
      },
      required: ['topicId']
    }
  },
  {
    name: 'disable_chat_memories',
    category: 'memory',
    description: 'Disable memory extraction for a chat topic',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: {
          type: 'string',
          description: 'Chat topic ID to disable memories for'
        }
      },
      required: ['topicId']
    }
  },
  {
    name: 'toggle_chat_memories',
    category: 'memory',
    description: 'Toggle memory extraction on/off for a chat topic',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: {
          type: 'string',
          description: 'Chat topic ID to toggle memories for'
        }
      },
      required: ['topicId']
    }
  },
  {
    name: 'extract_chat_subjects',
    category: 'memory',
    description: 'Extract subjects from chat messages and store as memories',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: {
          type: 'string',
          description: 'Chat topic ID to extract from'
        },
        limit: {
          type: 'number',
          description: 'Number of recent messages to analyze',
          default: 50
        }
      },
      required: ['topicId']
    }
  },
  {
    name: 'find_chat_memories',
    category: 'memory',
    description: 'Find related memories for a chat based on keywords',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: {
          type: 'string',
          description: 'Chat topic ID'
        },
        keywords: {
          type: 'array',
          description: 'Keywords to search for'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return',
          default: 10
        }
      },
      required: ['topicId', 'keywords']
    }
  },
  {
    name: 'get_chat_memory_status',
    category: 'memory',
    description: 'Get memory extraction status for a chat topic',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: {
          type: 'string',
          description: 'Chat topic ID'
        }
      },
      required: ['topicId']
    }
  },
  // Subject Storage Tools
  {
    name: 'store_subject',
    category: 'memory',
    description: 'Store a subject assembly in memory with optional styling and cryptographic signature',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Unique identifier for the subject'
        },
        name: {
          type: 'string',
          description: 'Subject name/title'
        },
        description: {
          type: 'string',
          description: 'Detailed description of the subject'
        },
        metadata: {
          type: 'object',
          description: 'Key-value metadata pairs'
        },
        sign: {
          type: 'boolean',
          description: 'Sign with verifiable credentials',
          default: false
        },
        theme: {
          type: 'string',
          description: 'HTML theme for styling (light, dark, auto)',
          default: 'auto'
        }
      },
      required: ['id', 'name']
    }
  },
  {
    name: 'retrieve_subject',
    category: 'memory',
    description: 'Retrieve a subject assembly from memory by ID hash',
    inputSchema: {
      type: 'object',
      properties: {
        idHash: {
          type: 'string',
          description: 'The ID hash of the subject to retrieve'
        },
        verifySignature: {
          type: 'boolean',
          description: 'Verify cryptographic signature if present',
          default: false
        }
      },
      required: ['idHash']
    }
  },
  {
    name: 'list_subjects',
    category: 'memory',
    description: 'List all subjects stored in memory',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'update_subject',
    category: 'memory',
    description: 'Update an existing subject assembly',
    inputSchema: {
      type: 'object',
      properties: {
        idHash: {
          type: 'string',
          description: 'The ID hash of the subject to update'
        },
        name: {
          type: 'string',
          description: 'Updated subject name'
        },
        description: {
          type: 'string',
          description: 'Updated description'
        },
        metadata: {
          type: 'object',
          description: 'Updated metadata'
        },
        sign: {
          type: 'boolean',
          description: 'Sign the updated version',
          default: false
        },
        theme: {
          type: 'string',
          description: 'HTML theme (light, dark, auto)',
          default: 'auto'
        }
      },
      required: ['idHash']
    }
  },
  {
    name: 'delete_subject',
    category: 'memory',
    description: 'Delete a subject assembly from memory storage',
    inputSchema: {
      type: 'object',
      properties: {
        idHash: {
          type: 'string',
          description: 'The ID hash of the subject to delete'
        }
      },
      required: ['idHash']
    }
  },
  {
    name: 'export_subject_html',
    category: 'memory',
    description: 'Export a subject as styled HTML for viewing in browser',
    inputSchema: {
      type: 'object',
      properties: {
        idHash: {
          type: 'string',
          description: 'The ID hash of the subject to export'
        }
      },
      required: ['idHash']
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
  ...aiAssistantTools,
  ...memoryTools
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
