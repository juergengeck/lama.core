/**
 * Example: Registering a Plan with Tool Definitions
 *
 * This shows how to register ChatPlan with LLM-friendly tool metadata.
 * Copy and adapt this pattern for other plans.
 */

import { planRegistry, type ToolDefinition } from '@mcp/core/tools/PlanRegistry.js';

// Define tools for ChatPlan
const chatTools: ToolDefinition[] = [
  {
    name: 'sendMessage',
    description: 'Send a message to a conversation',
    params: [
      {
        name: 'topicId',
        type: 'string',
        description: 'The conversation ID to send the message to',
        required: true,
        examples: ['conversation-hi', 'topic-abc123']
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
    description: 'Retrieve recent messages from a conversation',
    params: [
      {
        name: 'topicId',
        type: 'string',
        description: 'The conversation ID to retrieve messages from',
        required: true
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of messages to retrieve',
        required: false,
        examples: [10, 50]
      }
    ],
    returns: 'Array of message objects with sender, content, and timestamp'
  },
  {
    name: 'listTopics',
    description: 'List all available conversations',
    params: [],
    returns: 'Array of topic objects with id, name, and participant count'
  }
];

// Example registration (would be called during app initialization)
export function registerChatPlanWithTools(chatPlanInstance: any): void {
  planRegistry.registerPlan(
    'chat',
    'messaging',
    chatPlanInstance,
    'Chat and messaging operations',
    chatTools
  );
}
