/**
 * Shared MCP types for lama.core
 * Platform-agnostic type definitions for Model Context Protocol integration
 */

/**
 * MCP Tool Definition
 * Describes a tool that can be called by AI assistants
 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, MCPToolParameter>;
    required?: string[];
  };
}

/**
 * MCP Tool Parameter
 * Describes a single parameter for a tool
 */
export interface MCPToolParameter {
  type: string;
  description?: string;
  default?: any;
}

/**
 * MCP Tool Result
 * Standard result format for tool execution
 */
export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * MCP Tool Context
 * Context provided to tool execution
 */
export interface MCPToolContext {
  userId?: string;
  topicId?: string;
  sessionId?: string;
  [key: string]: any;
}

/**
 * MCP Tool Executor Interface
 * Platform-agnostic tool executor
 */
export interface MCPToolExecutor {
  /**
   * Execute a tool with given parameters
   */
  execute(
    toolName: string,
    parameters: Record<string, any>,
    context?: MCPToolContext
  ): Promise<MCPToolResult>;

  /**
   * Get available tool definitions
   */
  getToolDefinitions(): MCPToolDefinition[];

  /**
   * Check if a tool is available
   */
  hasTool(toolName: string): boolean;
}

/**
 * MCP Tool Dependencies
 * Dependencies injected into tool executor
 */
export interface MCPToolDependencies {
  nodeOneCore: any;
  aiAssistantModel?: any;
  channelManager?: any;
  leuteModel?: any;
  topicModel?: any;
  connectionsModel?: any;
  memoryHandler?: any;
  chatMemoryHandler?: any;
}

/**
 * MCP Tool Category
 * Logical grouping of tools
 */
export type MCPToolCategory =
  | 'chat'
  | 'contacts'
  | 'connections'
  | 'llm'
  | 'ai-assistant'
  | 'memory'
  | 'system';

/**
 * MCP Tool Registration
 * Tool with metadata for registration
 */
export interface MCPToolRegistration extends MCPToolDefinition {
  category: MCPToolCategory;
  executor: (
    params: Record<string, any>,
    context: MCPToolContext,
    deps: MCPToolDependencies
  ) => Promise<MCPToolResult>;
}
