/**
 * Plan Registration Service for lama.core
 *
 * Registers all lama.core plan instances with the MCP plan registry.
 * This allows headless servers and all platforms to expose lama.core
 * functionality via MCP without manual registration.
 *
 * Usage (headless server):
 * ```typescript
 * import { registerLamaCorePlans } from '@lama/core/services/plan-registration.js';
 * import { planRegistry } from '@mcp/core';
 *
 * // Initialize your handlers
 * const aiAssistantHandler = new AIAssistantHandler(nodeOneCore, ...);
 *
 * // Register all lama.core plans
 * registerLamaCorePlans({
 *   nodeOneCore,
 *   aiAssistantHandler,
 *   // ... other handlers
 * });
 *
 * // Now MCP can discover and call these plans
 * ```
 */

import { planRegistry, type ToolDefinition } from '@mcp/core';

// Tool definitions for AI Assistant Plan
const aiAssistantTools: ToolDefinition[] = [
  {
    name: 'sendMessage',
    description: 'Send a message in a conversation on behalf of the AI',
    params: [
      {
        name: 'topicId',
        type: 'string',
        description: 'The conversation/topic ID to send the message to',
        required: true
      },
      {
        name: 'message',
        type: 'string',
        description: 'The message content to send',
        required: true
      }
    ],
    returns: 'Message hash on success'
  },
  {
    name: 'getMessages',
    description: 'Retrieve messages from a conversation',
    params: [
      {
        name: 'topicId',
        type: 'string',
        description: 'The conversation/topic ID to retrieve messages from',
        required: true
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of messages to retrieve (default: 50)',
        required: false,
        examples: [10, 50, 100]
      }
    ],
    returns: 'Array of message objects with sender, content, and timestamp'
  },
  {
    name: 'getTopics',
    description: 'List available conversations/topics',
    params: [],
    returns: 'Array of topic objects with id, name, and participant info'
  }
];

// Tool definitions for Memory Plan
const memoryTools: ToolDefinition[] = [
  {
    name: 'storeMemory',
    description: 'Store a memory/note for later retrieval',
    params: [
      {
        name: 'content',
        type: 'string',
        description: 'The memory content to store',
        required: true
      },
      {
        name: 'keywords',
        type: 'string[]',
        description: 'Keywords for categorization and retrieval',
        required: false,
        examples: [['meeting', 'project'], ['idea', 'feature']]
      }
    ],
    returns: 'Memory ID hash on success'
  },
  {
    name: 'searchMemories',
    description: 'Search stored memories by keywords or content',
    params: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query string',
        required: true
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of results (default: 10)',
        required: false
      }
    ],
    returns: 'Array of matching memory objects'
  }
];

// Tool definitions for Subject Service
const subjectTools: ToolDefinition[] = [
  {
    name: 'getSubjects',
    description: 'Get subjects extracted from a topic',
    params: [
      {
        name: 'topicId',
        type: 'string',
        description: 'The topic ID to get subjects for',
        required: true
      }
    ],
    returns: 'Array of subject objects with keywords and descriptions'
  },
  {
    name: 'getKeywords',
    description: 'Get keywords from a topic',
    params: [
      {
        name: 'topicId',
        type: 'string',
        description: 'The topic ID to get keywords for',
        required: true
      }
    ],
    returns: 'Array of keyword strings'
  }
];

export interface LamaCoreDependencies {
  nodeOneCore: any;
  aiAssistantHandler?: any;
  chatMemoryHandler?: any;
  subjectService?: any;
  proposalEngine?: any;
  llmManager?: any;
  meaningPlan?: any;
}

/**
 * Register all lama.core handlers/services with the plan registry
 */
export function registerLamaCorePlans(deps: LamaCoreDependencies): void {
  console.log('[lama.core] Registering plans with MCP registry...');

  // Register AI Assistant Handler with tool definitions
  if (deps.aiAssistantHandler) {
    planRegistry.registerPlan(
      'ai-assistant',
      'llm',
      deps.aiAssistantHandler,
      'AI assistant operations (contacts, topics, messages)',
      aiAssistantTools
    );
  }

  // Register Chat Memory Handler with tool definitions
  if (deps.chatMemoryHandler) {
    planRegistry.registerPlan(
      'chat-memory',
      'memory',
      deps.chatMemoryHandler,
      'Chat memory and subject extraction',
      memoryTools
    );
  }

  // Register Subject Service with tool definitions
  if (deps.subjectService) {
    planRegistry.registerPlan(
      'subjects',
      'analysis',
      deps.subjectService,
      'Subject and keyword management',
      subjectTools
    );
  }

  // Register Proposal Engine
  if (deps.proposalEngine) {
    planRegistry.registerPlan(
      'proposals',
      'recommendations',
      deps.proposalEngine,
      'Context-aware proposal generation'
    );
  }

  // Register LLM Manager
  if (deps.llmManager) {
    planRegistry.registerPlan(
      'llm',
      'llm',
      deps.llmManager,
      'LLM provider management (Ollama, Claude, LMStudio)'
    );
  }

  // Register Meaning Plan (semantic similarity dimension)
  if (deps.meaningPlan) {
    planRegistry.registerPlan(
      'meaning',
      'semantic',
      deps.meaningPlan,
      'Semantic similarity search - find content by meaning using embeddings'
    );
  }

  console.log('[lama.core] Plan registration complete');
}

/**
 * Get lama.core plan dependencies from a NodeOneCore instance
 * Convenience function to extract plan instances from NodeOneCore
 */
export function getLamaCoreDepend(nodeOneCore: any): LamaCoreDependencies {
  return {
    nodeOneCore,
    aiAssistantHandler: nodeOneCore.aiAssistantModel,
    chatMemoryHandler: nodeOneCore.chatMemoryHandler,
    subjectService: nodeOneCore.subjectService,
    proposalEngine: nodeOneCore.proposalEngine,
    llmManager: nodeOneCore.llmManager,
    meaningPlan: nodeOneCore.meaningPlan
  };
}
