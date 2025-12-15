/**
 * Tool Call Parser
 *
 * Extracts tool calls from LLM text output.
 * Supports JSON blocks with or without markdown code fences.
 */

import type { ToolCall } from './tool-trace.js';

/**
 * Parse result - either a tool call or null if none found
 */
export interface ParseResult {
  toolCall: ToolCall | null;
  textBefore: string;
  textAfter: string;
}

/**
 * Extract complete JSON object from text using brace counting
 */
function extractJsonFromText(text: string): { json: string; start: number; end: number } | null {
  const toolIndex = text.indexOf('"tool"');
  if (toolIndex === -1) return null;

  // Search backwards to find opening brace
  let startIdx = -1;
  for (let i = toolIndex - 1; i >= 0; i--) {
    const char = text[i];
    if (char === '{') {
      startIdx = i;
      break;
    }
    if (char !== ' ' && char !== '\n' && char !== '\t' && char !== '\r' && char !== '"' && char !== ':') {
      break;
    }
  }

  if (startIdx === -1) return null;

  // Count braces to find matching close
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          return {
            json: text.substring(startIdx, i + 1),
            start: startIdx,
            end: i + 1
          };
        }
      }
    }
  }

  return null;
}

/**
 * Parse LLM output for tool calls
 *
 * Looks for:
 * 1. ```json {"tool":"...", "params":{...}} ```
 * 2. {"tool":"...", "params":{...}}
 */
export function parseToolCall(text: string): ParseResult {
  // Try markdown code fence first
  const fenceMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);

  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (parsed.tool && typeof parsed.tool === 'string') {
        const fenceStart = text.indexOf(fenceMatch[0]);
        return {
          toolCall: {
            tool: parsed.tool,
            params: parsed.params || {}
          },
          textBefore: text.substring(0, fenceStart).trim(),
          textAfter: text.substring(fenceStart + fenceMatch[0].length).trim()
        };
      }
    } catch {
      // Invalid JSON in fence, continue to raw extraction
    }
  }

  // Try raw JSON extraction
  const extracted = extractJsonFromText(text);
  if (extracted) {
    try {
      const parsed = JSON.parse(extracted.json);
      if (parsed.tool && typeof parsed.tool === 'string') {
        return {
          toolCall: {
            tool: parsed.tool,
            params: parsed.params || {}
          },
          textBefore: text.substring(0, extracted.start).trim(),
          textAfter: text.substring(extracted.end).trim()
        };
      }
    } catch {
      // Invalid JSON
    }
  }

  return {
    toolCall: null,
    textBefore: text,
    textAfter: ''
  };
}

/**
 * Check if a tool name has a valid prefix
 */
export function isValidToolPrefix(tool: string): boolean {
  return tool.startsWith('plan:') || tool.startsWith('mcp:');
}

/**
 * Parse tool name into prefix and path
 * e.g., "plan:chat:sendMessage" → { prefix: "plan", domain: "chat", method: "sendMessage" }
 */
export function parseToolName(tool: string): { prefix: string; domain: string; method: string } | null {
  const parts = tool.split(':');
  if (parts.length !== 3) return null;

  const [prefix, domain, method] = parts;
  if (!prefix || !domain || !method) return null;

  return { prefix, domain, method };
}
