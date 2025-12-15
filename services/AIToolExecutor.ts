/**
 * AIToolExecutor
 *
 * Unified tool execution for all AI in the app.
 * Routes by prefix: plan: → PlanRouter, mcp: → MCPManager
 * All calls go through PolicyEngine for access control.
 */

import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';

import {
  type ToolTrace,
  type ToolStep,
  type PolicyResult,
  createToolTrace,
  addTraceStep,
  finalizeTrace,
  serializeTrace
} from './tool-trace.js';

import {
  parseToolCall,
  parseToolName,
  isValidToolPrefix,
  type ParseResult
} from './tool-parser.js';

const MessageBus = createMessageBus('AIToolExecutor');

/**
 * Execution context for tool calls
 */
export interface ToolExecutionContext {
  /** AI Person making the call */
  callerId: SHA256IdHash<Person>;
  /** Current topic/conversation */
  topicId?: string;
  /** Entry point identifier */
  entryPoint: 'ai-assistant' | 'agent-mode';
  /** Request ID for correlation */
  requestId: string;
}

/**
 * Result of tool execution
 */
export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Dependencies for AIToolExecutor
 */
export interface AIToolExecutorDeps {
  /** PlanRouter for internal plan access */
  planRouter?: {
    call: (context: any, plan: string, method: string, params: any) => Promise<any>;
  };
  /** MCPManager for external tool access */
  mcpManager?: {
    executeTool: (tool: string, params: any, context?: any) => Promise<any>;
  };
  /** PolicyEngine for access control (used via PlanRouter) */
  policyEngine?: any;
}

/**
 * AIToolExecutor configuration
 */
export interface AIToolExecutorConfig {
  /** Max tool calls per turn in chat mode (default: 5) */
  maxIterations: number;
  /** Enable agent mode (unlimited iterations) */
  agentModeEnabled: boolean;
}

const DEFAULT_CONFIG: AIToolExecutorConfig = {
  maxIterations: 5,
  agentModeEnabled: false
};

export class AIToolExecutor {
  private deps: AIToolExecutorDeps;
  private config: AIToolExecutorConfig;

  constructor(deps: AIToolExecutorDeps, config: Partial<AIToolExecutorConfig> = {}) {
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<AIToolExecutorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Parse LLM output for tool call
   */
  parse(output: string): ParseResult {
    return parseToolCall(output);
  }

  /**
   * Execute a single tool call
   */
  async execute(
    tool: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<{ result: ToolExecutionResult; policy: PolicyResult; duration: number }> {
    const startTime = Date.now();

    // Validate tool prefix
    if (!isValidToolPrefix(tool)) {
      return {
        result: { success: false, error: `Invalid tool prefix: ${tool}. Must start with plan: or mcp:` },
        policy: { allowed: false, matchedRules: [], reason: 'Invalid prefix' },
        duration: Date.now() - startTime
      };
    }

    const parsed = parseToolName(tool);
    if (!parsed) {
      return {
        result: { success: false, error: `Invalid tool format: ${tool}. Expected prefix:domain:method` },
        policy: { allowed: false, matchedRules: [], reason: 'Invalid format' },
        duration: Date.now() - startTime
      };
    }

    const { prefix, domain, method } = parsed;

    try {
      if (prefix === 'plan') {
        return await this.executePlanTool(domain, method, params, context, startTime);
      } else if (prefix === 'mcp') {
        return await this.executeMCPTool(domain, method, params, context, startTime);
      } else {
        return {
          result: { success: false, error: `Unknown prefix: ${prefix}` },
          policy: { allowed: false, matchedRules: [], reason: 'Unknown prefix' },
          duration: Date.now() - startTime
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      MessageBus.send('error', `Tool execution failed: ${tool}`, error);
      return {
        result: { success: false, error: errorMessage },
        policy: { allowed: true, matchedRules: [] }, // Execution failed, not policy
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Execute a plan tool via PlanRouter
   */
  private async executePlanTool(
    domain: string,
    method: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext,
    startTime: number
  ): Promise<{ result: ToolExecutionResult; policy: PolicyResult; duration: number }> {
    if (!this.deps.planRouter) {
      return {
        result: { success: false, error: 'PlanRouter not available' },
        policy: { allowed: false, matchedRules: [], reason: 'No PlanRouter' },
        duration: Date.now() - startTime
      };
    }

    // Build request context for PlanRouter
    const requestContext = {
      callerId: context.callerId.toString(),
      callerType: 'ai' as const,
      entryPoint: context.entryPoint,
      topicId: context.topicId,
      timestamp: Date.now(),
      requestId: context.requestId
    };

    MessageBus.send('debug', `Executing plan tool: ${domain}:${method}`);

    const planResult = await this.deps.planRouter.call(requestContext, domain, method, params);

    // PlanRouter returns { success, data, error }
    const policy: PolicyResult = {
      allowed: true,
      matchedRules: planResult.matchedRules || []
    };

    return {
      result: {
        success: planResult.success,
        data: planResult.data,
        error: planResult.error
      },
      policy,
      duration: Date.now() - startTime
    };
  }

  /**
   * Execute an MCP tool via MCPManager
   */
  private async executeMCPTool(
    domain: string,
    method: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext,
    startTime: number
  ): Promise<{ result: ToolExecutionResult; policy: PolicyResult; duration: number }> {
    if (!this.deps.mcpManager) {
      return {
        result: { success: false, error: 'MCPManager not available' },
        policy: { allowed: false, matchedRules: [], reason: 'No MCPManager' },
        duration: Date.now() - startTime
      };
    }

    // MCP tool names: mcp:server:tool → server:tool
    const mcpToolName = `${domain}:${method}`;

    MessageBus.send('debug', `Executing MCP tool: ${mcpToolName}`);

    const mcpResult = await this.deps.mcpManager.executeTool(mcpToolName, params, {
      topicId: context.topicId,
      callerId: context.callerId
    });

    // MCP returns content array format
    let data: unknown;
    if (mcpResult.content && Array.isArray(mcpResult.content)) {
      const textParts = mcpResult.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);
      data = textParts.join('\n\n');
    } else {
      data = mcpResult;
    }

    return {
      result: { success: true, data },
      policy: { allowed: true, matchedRules: ['mcp-access'] },
      duration: Date.now() - startTime
    };
  }

  /**
   * Format tool result for LLM consumption
   */
  formatResultForLLM(result: ToolExecutionResult): string {
    if (!result.success) {
      return `Error: ${result.error}`;
    }
    if (result.data === undefined || result.data === null) {
      return 'Operation completed successfully';
    }
    if (typeof result.data === 'string') {
      return result.data;
    }
    return JSON.stringify(result.data, null, 2);
  }

  /**
   * Create a new tool trace
   */
  createTrace(agentMode = false): ToolTrace {
    return createToolTrace(agentMode);
  }

  /**
   * Add step to trace
   */
  addStep(
    trace: ToolTrace,
    tool: string,
    params: Record<string, unknown>,
    result: ToolExecutionResult,
    policy: PolicyResult,
    duration: number
  ): void {
    addTraceStep(trace, tool, params, { ...result }, policy, duration);
  }

  /**
   * Finalize and serialize trace
   */
  finalizeTrace(trace: ToolTrace): string {
    finalizeTrace(trace);
    return serializeTrace(trace);
  }

  /**
   * Check if max iterations reached (for chat mode)
   */
  isMaxIterationsReached(trace: ToolTrace): boolean {
    if (trace.agentMode) return false;
    return trace.steps.length >= this.config.maxIterations;
  }
}
