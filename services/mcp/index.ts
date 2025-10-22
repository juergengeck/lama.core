/**
 * MCP Module for lama.core
 *
 * Platform-agnostic Model Context Protocol integration components
 *
 * Usage:
 * ```typescript
 * import { createMCPToolInterface, MCPToolExecutor } from '@lama/core/services/mcp';
 *
 * const toolInterface = createMCPToolInterface({
 *   nodeOneCore,
 *   aiAssistantModel
 * });
 *
 * const result = await toolInterface.executeTool('send_message', {
 *   topicId: '...',
 *   message: 'Hello!'
 * });
 * ```
 */

// Types
export type {
  MCPToolDefinition,
  MCPToolParameter,
  MCPToolResult,
  MCPToolContext,
  MCPToolExecutor as IMCPToolExecutor,
  MCPToolDependencies,
  MCPToolCategory,
  MCPToolRegistration
} from './types.js';

// Tool Definitions
export {
  chatTools,
  contactTools,
  connectionTools,
  llmTools,
  aiAssistantTools,
  allTools,
  getToolsByCategory,
  getToolDefinition,
  getAllToolNames
} from './tool-definitions.js';
export type { ToolDefinitionWithCategory } from './tool-definitions.js';

// Tool Executor
export { MCPToolExecutor } from './tool-executor.js';

// Tool Interface
export { MCPToolInterface, createMCPToolInterface } from './mcp-tool-interface.js';
