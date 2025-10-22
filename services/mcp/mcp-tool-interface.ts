/**
 * MCP Tool Interface for lama.core
 * Platform-agnostic interface for MCP tool management and execution
 *
 * This provides a unified way for platforms to:
 * - Register and manage tools
 * - Execute tools with dependency injection
 * - Convert tools to MCP/Assistant formats
 */

import type {
  MCPToolDefinition,
  MCPToolResult,
  MCPToolContext,
  MCPToolDependencies,
  MCPToolCategory
} from './types.js';
import { MCPToolExecutor } from './tool-executor.js';
import { allTools, getToolDefinition, getToolsByCategory } from './tool-definitions.js';

/**
 * MCP Tool Interface
 * Main interface for interacting with LAMA tools via MCP
 */
export class MCPToolInterface {
  private executor: MCPToolExecutor;
  private enabledCategories: Set<MCPToolCategory>;

  constructor(dependencies: MCPToolDependencies) {
    this.executor = new MCPToolExecutor(dependencies);
    this.enabledCategories = new Set(['chat', 'contacts', 'connections', 'llm', 'ai-assistant']);
  }

  /**
   * Get all available tool definitions
   */
  getToolDefinitions(): MCPToolDefinition[] {
    return allTools.filter(tool => this.enabledCategories.has(tool.category));
  }

  /**
   * Get tool definitions by category
   */
  getToolsByCategory(category: MCPToolCategory): MCPToolDefinition[] {
    if (!this.enabledCategories.has(category)) {
      return [];
    }
    return getToolsByCategory(category);
  }

  /**
   * Check if a tool is available
   */
  hasTool(toolName: string): boolean {
    const tool = getToolDefinition(toolName);
    return tool !== undefined && this.enabledCategories.has(tool.category);
  }

  /**
   * Execute a tool
   */
  async executeTool(
    toolName: string,
    parameters: Record<string, any>,
    context?: MCPToolContext
  ): Promise<MCPToolResult> {
    const tool = getToolDefinition(toolName);
    if (!tool || !this.enabledCategories.has(tool.category)) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: Tool ${toolName} not available`
          }
        ],
        isError: true
      };
    }

    return await this.executor.execute(toolName, parameters, context);
  }

  /**
   * Enable or disable a category of tools
   */
  setCategoryEnabled(category: MCPToolCategory, enabled: boolean): void {
    if (enabled) {
      this.enabledCategories.add(category);
    } else {
      this.enabledCategories.delete(category);
    }
  }

  /**
   * Get enabled categories
   */
  getEnabledCategories(): MCPToolCategory[] {
    return Array.from(this.enabledCategories);
  }

  /**
   * Get tool description text for LLM prompts
   */
  getToolDescriptionText(): string {
    const tools = this.getToolDefinitions();
    if (tools.length === 0) {
      return '';
    }

    let description = '\n\n# Available Tools\n\n';
    description += 'You have access to the following tools:\n\n';

    // Group by category
    const byCategory = new Map<MCPToolCategory, MCPToolDefinition[]>();
    for (const tool of tools) {
      const category = (tool as any).category || 'general';
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category)!.push(tool);
    }

    // Output by category
    for (const [category, categoryTools] of byCategory) {
      description += `## ${category.charAt(0).toUpperCase() + category.slice(1)} Tools\n\n`;
      for (const tool of categoryTools) {
        description += `**${tool.name}**\n`;
        if (tool.description) {
          description += `${tool.description}\n`;
        }
        if (tool.inputSchema?.properties) {
          description += 'Parameters:\n';
          for (const [paramName, paramDef] of Object.entries(tool.inputSchema.properties)) {
            const def = paramDef as any;
            const required = tool.inputSchema.required?.includes(paramName)
              ? ' (required)'
              : ' (optional)';
            description += `  - ${paramName}${required}: ${def.description || def.type || 'no description'}\n`;
          }
        }
        description += '\n';
      }
    }

    description += '\n# Tool Usage\n\n';
    description +=
      'When you need to use a tool, respond with ONLY a JSON block (no thinking, no explanation):\n\n';
    description += '```json\n';
    description += '{"tool":"tool-name","parameters":{"param":"value"}}\n';
    description += '```\n\n';
    description +=
      'The system will execute the tool and provide you with the result. Then you can respond with the result formatted for the user.\n';
    description +=
      'IMPORTANT: Do NOT simulate tool execution - actually call the tool by responding with the JSON.\n';

    return description;
  }

  /**
   * Convert tool definitions to MCP format
   * Used by MCP servers when listing tools
   */
  toMCPFormat(): Array<{
    name: string;
    description: string;
    inputSchema: any;
  }> {
    return this.getToolDefinitions().map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }

  /**
   * Convert tool definitions to AI Assistant format
   * Used by AI assistants for tool discovery
   */
  toAssistantFormat(): Array<{
    id: string;
    name: string;
    description: string;
    parameters: any;
    category: string;
  }> {
    return this.getToolDefinitions().map(tool => ({
      id: tool.name,
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      category: (tool as any).category || 'general'
    }));
  }
}

/**
 * Create a new MCP Tool Interface with dependencies
 */
export function createMCPToolInterface(dependencies: MCPToolDependencies): MCPToolInterface {
  return new MCPToolInterface(dependencies);
}
