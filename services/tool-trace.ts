/**
 * Tool Trace Types
 *
 * Defines the format for tool execution traces stored as CLOB attachments.
 */

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
}

export interface PolicyResult {
  allowed: boolean;
  matchedRules: string[];
  reason?: string;
}

export interface ToolStep {
  seq: number;
  tool: string;
  params: Record<string, unknown>;
  result: {
    success: boolean;
    data?: unknown;
    error?: string;
  };
  duration: number;
  policy: PolicyResult;
  timestamp: number;
}

export interface ToolTrace {
  version: '1.0';
  startedAt: number;
  completedAt?: number;
  steps: ToolStep[];
  agentMode: boolean;
}

/**
 * Create a new empty tool trace
 */
export function createToolTrace(agentMode = false): ToolTrace {
  return {
    version: '1.0',
    startedAt: Date.now(),
    steps: [],
    agentMode
  };
}

/**
 * Add a step to the tool trace
 */
export function addTraceStep(
  trace: ToolTrace,
  tool: string,
  params: Record<string, unknown>,
  result: ToolStep['result'],
  policy: PolicyResult,
  duration: number
): void {
  trace.steps.push({
    seq: trace.steps.length + 1,
    tool,
    params,
    result,
    duration,
    policy,
    timestamp: Date.now()
  });
}

/**
 * Finalize the tool trace
 */
export function finalizeTrace(trace: ToolTrace): void {
  trace.completedAt = Date.now();
}

/**
 * Serialize trace for storage as CLOB
 */
export function serializeTrace(trace: ToolTrace): string {
  return JSON.stringify(trace, null, 2);
}
