/**
 * Capability Resolver
 * Resolves LLM capabilities from model metadata or known defaults
 */

import type { LLMCapabilities } from '../models/ai/types.js';

/**
 * Known model capability profiles
 * Used as fallback when capabilities aren't stored on LLM object
 */
const KNOWN_CAPABILITIES: Record<string, Partial<LLMCapabilities>> = {
  // Anthropic Claude models
  'claude-opus-4-5': {
    contextWindow: 200000,
    supportsVision: true,
    supportsThinking: true,
    supportsTools: true,
    supportsStreaming: true,
    responseStyle: 'detailed'
  },
  'claude-sonnet-4': {
    contextWindow: 200000,
    supportsVision: true,
    supportsThinking: true,
    supportsTools: true,
    supportsStreaming: true,
    responseStyle: 'balanced'
  },
  'claude-3-5-sonnet': {
    contextWindow: 200000,
    supportsVision: true,
    supportsThinking: false,
    supportsTools: true,
    supportsStreaming: true,
    responseStyle: 'balanced'
  },
  'claude-3-5-haiku': {
    contextWindow: 200000,
    supportsVision: true,
    supportsThinking: false,
    supportsTools: true,
    supportsStreaming: true,
    responseStyle: 'concise'
  },

  // OpenAI models
  'gpt-4o': {
    contextWindow: 128000,
    supportsVision: true,
    supportsThinking: false,
    supportsTools: true,
    supportsStreaming: true,
    responseStyle: 'balanced'
  },
  'gpt-4-turbo': {
    contextWindow: 128000,
    supportsVision: true,
    supportsThinking: false,
    supportsTools: true,
    supportsStreaming: true,
    responseStyle: 'detailed'
  },
  'o1': {
    contextWindow: 128000,
    supportsVision: false,
    supportsThinking: true,
    supportsTools: false,
    supportsStreaming: false,
    responseStyle: 'detailed'
  },

  // Local models (conservative defaults)
  'granite': {
    contextWindow: 8192,
    supportsVision: false,
    supportsThinking: false,
    supportsTools: false,
    supportsStreaming: true,
    responseStyle: 'concise'
  },
  'llama': {
    contextWindow: 8192,
    supportsVision: false,
    supportsThinking: false,
    supportsTools: false,
    supportsStreaming: true,
    responseStyle: 'balanced'
  },
  'qwen': {
    contextWindow: 32768,
    supportsVision: false,
    supportsThinking: false,
    supportsTools: true,
    supportsStreaming: true,
    responseStyle: 'balanced'
  }
};

/**
 * Default capabilities for unknown models
 */
const DEFAULT_CAPABILITIES: LLMCapabilities = {
  contextWindow: 4096,
  supportsVision: false,
  supportsThinking: false,
  supportsTools: false,
  supportsStreaming: true,
  responseStyle: 'balanced'
};

/**
 * Find matching capability profile by model ID
 */
function findMatchingProfile(modelId: string): Partial<LLMCapabilities> | null {
  const normalizedId = modelId.toLowerCase();

  // Try exact match first
  for (const [key, caps] of Object.entries(KNOWN_CAPABILITIES)) {
    if (normalizedId.includes(key)) {
      return caps;
    }
  }

  return null;
}

/**
 * Resolve capabilities for a model
 *
 * Priority:
 * 1. Capabilities stored on LLM object
 * 2. Known model profiles (by model ID pattern matching)
 * 3. Provider-based defaults
 * 4. Conservative defaults
 */
export function resolveCapabilities(
  modelId: string,
  storedCapabilities?: LLMCapabilities,
  provider?: string,
  contextLength?: number
): LLMCapabilities {
  // Start with defaults
  let capabilities: LLMCapabilities = { ...DEFAULT_CAPABILITIES };

  // Override with known profile if available
  const knownProfile = findMatchingProfile(modelId);
  if (knownProfile) {
    capabilities = { ...capabilities, ...knownProfile };
  }

  // Override with stored capabilities if available
  if (storedCapabilities) {
    capabilities = { ...capabilities, ...storedCapabilities };
  }

  // Override context window if explicitly provided
  if (contextLength) {
    capabilities.contextWindow = contextLength;
  }

  return capabilities;
}

/**
 * Get capability hint text for prompts
 */
export function getCapabilityHints(capabilities: LLMCapabilities): string[] {
  const hints: string[] = [];

  // Context window hints
  if (capabilities.contextWindow >= 100000) {
    hints.push('You have a large context window - feel free to be thorough when helpful.');
  } else if (capabilities.contextWindow < 8000) {
    hints.push('Keep responses focused due to context limitations.');
  }

  // Vision hint
  if (capabilities.supportsVision) {
    hints.push('You can analyze images when provided.');
  }

  // Thinking hint
  if (capabilities.supportsThinking) {
    hints.push('You support extended thinking for complex reasoning tasks.');
  }

  // Tools hint
  if (capabilities.supportsTools) {
    hints.push('You can use tools to help accomplish tasks.');
  }

  return hints;
}
