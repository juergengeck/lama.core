/**
 * MCP Module for lama.core
 *
 * Re-exports from @mcp/core for backward compatibility.
 * All MCP functionality is now consolidated in @mcp/core.
 *
 * For new code, import directly from @mcp/core:
 * - Tool definitions: import { allTools } from '@mcp/core'
 * - Tool interface: import { MCPToolInterface } from '@mcp/core'
 * - Adapters: import { MCPLocalAdapter } from '@mcp/core/router'
 */

// Re-export everything from @mcp/core interface
export * from '@mcp/core';
