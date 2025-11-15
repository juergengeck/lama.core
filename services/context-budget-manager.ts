/**
 * Context Budget Manager
 *
 * Manages LLM context window budgets with abstraction-based compression.
 * Implements the 4-part prompt structure with caching support:
 *   Part 1: Stable system prompt (cacheable)
 *   Part 2: Past subjects as summaries (cacheable, grows slowly)
 *   Part 3: Current subject messages (maybe cacheable depending on API)
 *   Part 4: Current message (never cached)
 */

import type { CompressionMode } from './subject-summarizer.js';
import { summarizeSubjects, formatPastSubjectsForPrompt, type SubjectForSummary } from './subject-summarizer.js';

export interface ContextBudget {
  // Model constraints
  modelContextWindow: number;    // Total context window (e.g., 200k for Claude)

  // Budget allocation
  systemPromptTokens: number;    // Part 1 (fixed)
  pastSubjectsBudget: number;    // Part 2 (target budget)
  currentSubjectBudget: number;  // Part 3 (target budget)
  responseReserve: number;       // Reserved for response generation

  // Calculated
  totalUsed: number;             // Actually used tokens
  remaining: number;             // Remaining budget

  // Adjustable parameters
  pastSubjectCount: number;      // How many past subjects to include
  currentMessageLimit: number;   // Max messages from current subject
  compressionMode: CompressionMode; // Current compression level
}

export interface PromptParts {
  part1: {
    content: string;              // System prompt text
    tokens: number;
    cacheable: true;
    cacheKey: string;             // For cache invalidation
  };
  part2: {
    content: string;              // Past subjects summary
    tokens: number;
    cacheable: true;
    cacheKey: string;             // Hash of subject list
  };
  part3: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    tokens: number;
    cacheable: boolean;           // Depends on API capability
    cacheKey?: string;
  };
  part4: {
    message: string;              // Current user message
    tokens: number;
    cacheable: false;
  };

  totalTokens: number;
  budget: ContextBudget;
}

export interface BuildContextParams {
  // Model info
  modelId: string;
  modelContextWindow: number;

  // Content
  systemPrompt: string;
  pastSubjects: SubjectForSummary[];
  currentSubjectMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  currentMessage: string;

  // Optional overrides
  targetPastSubjectCount?: number;
  targetMessageLimit?: number;
  initialCompressionMode?: CompressionMode;
}

/**
 * Create initial context budget
 */
export function createBudget(params: {
  modelContextWindow: number;
  systemPromptTokens: number;
  targetPastSubjectCount?: number;
  targetMessageLimit?: number;
}): ContextBudget {
  const {
    modelContextWindow,
    systemPromptTokens,
    targetPastSubjectCount = 20,
    targetMessageLimit = 30
  } = params;

  // Reserve 25% for response generation
  const responseReserve = Math.floor(modelContextWindow * 0.25);
  const usableContext = modelContextWindow - responseReserve;

  // Allocate remaining budget
  const remainingAfterSystem = usableContext - systemPromptTokens;

  // Split remaining: 20% for past subjects, 80% for current messages
  const pastSubjectsBudget = Math.floor(remainingAfterSystem * 0.2);
  const currentSubjectBudget = Math.floor(remainingAfterSystem * 0.8);

  return {
    modelContextWindow,
    systemPromptTokens,
    pastSubjectsBudget,
    currentSubjectBudget,
    responseReserve,
    totalUsed: systemPromptTokens,
    remaining: usableContext - systemPromptTokens,
    pastSubjectCount: targetPastSubjectCount,
    currentMessageLimit: targetMessageLimit,
    compressionMode: 'balanced'
  };
}

/**
 * Build context with automatic budget management
 */
export function buildContextWithinBudget(params: BuildContextParams): PromptParts {
  const {
    modelContextWindow,
    systemPrompt,
    pastSubjects,
    currentSubjectMessages,
    currentMessage,
    targetPastSubjectCount = 20,
    targetMessageLimit = 30,
    initialCompressionMode = 'balanced'
  } = params;

  // Estimate token counts
  const systemPromptTokens = estimateTokens(systemPrompt);

  // Create initial budget
  let budget = createBudget({
    modelContextWindow,
    systemPromptTokens,
    targetPastSubjectCount,
    targetMessageLimit
  });

  // Build parts
  let parts = buildParts({
    systemPrompt,
    pastSubjects: pastSubjects.slice(0, budget.pastSubjectCount),
    currentSubjectMessages: currentSubjectMessages.slice(-budget.currentMessageLimit),
    currentMessage,
    budget
  });

  // Check if over budget and adjust
  while (parts.totalTokens > (modelContextWindow - budget.responseReserve)) {
    // Strategy 1: Reduce current messages first
    if (budget.currentMessageLimit > 5) {
      budget.currentMessageLimit = Math.max(5, budget.currentMessageLimit - 5);
    }
    // Strategy 2: Compress past subjects more
    else if (budget.compressionMode !== 'extreme') {
      budget.compressionMode = getNextCompressionMode(budget.compressionMode);
    }
    // Strategy 3: Reduce past subject count
    else if (budget.pastSubjectCount > 3) {
      budget.pastSubjectCount = Math.max(3, budget.pastSubjectCount - 5);
    }
    // Strategy 4: Emergency - minimal everything
    else {
      budget.currentMessageLimit = 3;
      budget.pastSubjectCount = 0;
      budget.compressionMode = 'extreme';
    }

    // Rebuild with new budget
    parts = buildParts({
      systemPrompt,
      pastSubjects: pastSubjects.slice(0, budget.pastSubjectCount),
      currentSubjectMessages: currentSubjectMessages.slice(-budget.currentMessageLimit),
      currentMessage,
      budget
    });

    // Prevent infinite loop
    if (budget.pastSubjectCount === 0 && budget.currentMessageLimit === 3) {
      break;
    }
  }

  return parts;
}

/**
 * Build the 4 prompt parts
 */
function buildParts(params: {
  systemPrompt: string;
  pastSubjects: SubjectForSummary[];
  currentSubjectMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  currentMessage: string;
  budget: ContextBudget;
}): PromptParts {
  const { systemPrompt, pastSubjects, currentSubjectMessages, currentMessage, budget } = params;

  // Part 1: System prompt (stable, cacheable)
  const part1Tokens = estimateTokens(systemPrompt);
  const part1 = {
    content: systemPrompt,
    tokens: part1Tokens,
    cacheable: true as const,
    cacheKey: hashString(systemPrompt)
  };

  // Part 2: Past subjects (growing, cacheable)
  const pastSubjectsText = formatPastSubjectsForPrompt(
    pastSubjects,
    budget.pastSubjectsBudget,
    budget.compressionMode
  );
  const part2Tokens = estimateTokens(pastSubjectsText);
  const part2 = {
    content: pastSubjectsText,
    tokens: part2Tokens,
    cacheable: true as const,
    cacheKey: hashString(pastSubjects.map(s => s.id).join(','))
  };

  // Part 3: Current subject messages (maybe cacheable)
  const part3Tokens = currentSubjectMessages.reduce((sum, msg) =>
    sum + estimateTokens(msg.content), 0
  );
  const part3 = {
    messages: currentSubjectMessages,
    tokens: part3Tokens,
    cacheable: false, // Conservative - only Anthropic supports this well
    cacheKey: hashString(JSON.stringify(currentSubjectMessages))
  };

  // Part 4: Current message (never cacheable)
  const part4Tokens = estimateTokens(currentMessage);
  const part4 = {
    message: currentMessage,
    tokens: part4Tokens,
    cacheable: false as const
  };

  const totalTokens = part1Tokens + part2Tokens + part3Tokens + part4Tokens;

  // Update budget
  budget.totalUsed = totalTokens;
  budget.remaining = (budget.modelContextWindow - budget.responseReserve) - totalTokens;

  return {
    part1,
    part2,
    part3,
    part4,
    totalTokens,
    budget
  };
}

/**
 * Get next compression mode in sequence
 */
function getNextCompressionMode(current: CompressionMode): CompressionMode {
  const sequence: CompressionMode[] = ['rich', 'balanced', 'minimal', 'extreme'];
  const currentIndex = sequence.indexOf(current);
  return sequence[Math.min(currentIndex + 1, sequence.length - 1)];
}

/**
 * Estimate token count (1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Simple hash function for cache keys
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Format for Anthropic API with prompt caching
 */
export function formatForAnthropicWithCaching(parts: PromptParts): {
  system: Array<{
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral' };
  }>;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const system: Array<{
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral' };
  }> = [];

  // Part 1: System prompt (cached)
  system.push({
    type: 'text',
    text: parts.part1.content,
    cache_control: { type: 'ephemeral' }
  });

  // Part 2: Past subjects (cached)
  if (parts.part2.content.trim()) {
    system.push({
      type: 'text',
      text: parts.part2.content,
      cache_control: { type: 'ephemeral' }
    });
  }

  // Part 3 + 4: Messages (not cached)
  // Filter out system messages for Anthropic (they go in the system field)
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...(parts.part3.messages.filter(m => m.role !== 'system') as Array<{ role: 'user' | 'assistant'; content: string }>),
    { role: 'user' as const, content: parts.part4.message }
  ];

  return { system, messages };
}

/**
 * Format for standard OpenAI/Ollama APIs (no caching)
 */
export function formatForStandardAPI(parts: PromptParts): {
  messages: Array<{ role: string; content: string }>;
} {
  const messages: Array<{ role: string; content: string }> = [];

  // Combine part1 + part2 into system message
  const systemContent = [parts.part1.content, parts.part2.content]
    .filter(Boolean)
    .join('\n\n');

  messages.push({
    role: 'system',
    content: systemContent
  });

  // Add part3 messages
  messages.push(...parts.part3.messages);

  // Add part4 current message
  messages.push({
    role: 'user',
    content: parts.part4.message
  });

  return { messages };
}

/**
 * Get budget statistics
 */
export function getBudgetStats(budget: ContextBudget): {
  utilizationPercent: number;
  efficiency: {
    systemPrompt: string;
    pastSubjects: string;
    currentMessages: string;
    reserved: string;
  };
  status: 'healthy' | 'tight' | 'critical';
} {
  const total = budget.modelContextWindow;
  const utilizationPercent = (budget.totalUsed / total) * 100;

  return {
    utilizationPercent,
    efficiency: {
      systemPrompt: `${((budget.systemPromptTokens / total) * 100).toFixed(1)}%`,
      pastSubjects: `${((budget.pastSubjectsBudget / total) * 100).toFixed(1)}%`,
      currentMessages: `${((budget.currentSubjectBudget / total) * 100).toFixed(1)}%`,
      reserved: `${((budget.responseReserve / total) * 100).toFixed(1)}%`
    },
    status: utilizationPercent > 90 ? 'critical' : utilizationPercent > 75 ? 'tight' : 'healthy'
  };
}
