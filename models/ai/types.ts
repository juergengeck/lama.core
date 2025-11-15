/**
 * Shared Types for AI Assistant Components
 *
 * These types are used across all AI assistant components in lama.core.
 * They define the data structures for AI modes, tasks, models, prompts, and context.
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { PromptParts } from '../../services/context-budget-manager.js';

/**
 * AI operating modes
 */
export type AIMode = 'assistant' | 'iom' | 'knowledge';

/**
 * AI task types for Information over Messages (IoM)
 */
export type AITaskType =
  | 'keyword-extraction'
  | 'subject-creation'
  | 'summary-generation'
  | 'research'
  | 'custom';

/**
 * Configuration for an AI task
 */
export interface AITaskConfig {
  /** Task type identifier */
  type: AITaskType;

  /** Whether this task is enabled for the topic */
  enabled: boolean;

  /** Optional task-specific parameters */
  parameters?: Record<string, any>;
}

/**
 * LLM model information
 */
export interface LLMModelInfo {
  /** Unique model identifier (e.g., "gpt-oss:20b") */
  id: string;

  /** Model name (e.g., "GPT-OSS") */
  name: string;

  /** Optional display name for UI */
  displayName?: string;

  /** Person ID hash for this AI contact (if created) */
  personId?: SHA256IdHash<Person>;

  /** LLM provider (e.g., "ollama", "lmstudio", "claude") */
  provider?: string;

  /** Context window size in tokens */
  contextLength?: number;
}

/**
 * Result of prompt building with context
 */
export interface PromptResult {
  /** @deprecated Use promptParts instead - messages will be empty when promptParts is present */
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;

  /** Whether context window limit was reached */
  needsRestart: boolean;

  /** Optional summary context for conversation restart */
  restartContext?: string;

  /** New: Abstraction-based context with budget management and caching support */
  promptParts?: PromptParts;
}

/**
 * Context window restart information
 */
export interface RestartContext {
  /** Whether restart is needed */
  needsRestart: boolean;

  /** Summary of conversation for restart, or null if no restart */
  restartContext: string | null;
}

/**
 * Message processing queue entry
 */
export interface MessageQueueEntry {
  /** Topic ID */
  topicId: string;

  /** Message text */
  text: string;

  /** Sender person ID */
  senderId: SHA256IdHash<Person>;

  /** Timestamp when queued */
  queuedAt: number;
}

/**
 * AI contact creation result
 */
export interface AIContactCreationResult {
  /** Person ID hash for the AI contact */
  personId: SHA256IdHash<Person>;

  /** Whether this was a new contact (true) or existing (false) */
  isNew: boolean;

  /** Model ID associated with this contact */
  modelId: string;
}

/**
 * Topic analysis result for IoM
 */
export interface TopicAnalysisResult {
  /** Extracted keywords */
  keywords: string[];

  /** Identified subjects */
  subjects: Array<{
    /** Subject ID */
    id: string;

    /** Subject name */
    name: string;

    /** Subject description */
    description: string;

    /** Associated keywords */
    keywords: string[];
  }>;

  /** Generated summary */
  summary?: string;
}

/**
 * LLM generation options
 */
export interface LLMGenerationOptions {
  /** Model ID to use */
  modelId: string;

  /** Messages array (system, user, assistant) */
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;

  /** Temperature (0.0 to 1.0) */
  temperature?: number;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Whether to stream responses */
  stream?: boolean;

  /** Callback for streaming chunks */
  onChunk?: (chunk: string) => void;

  /** Callback for progress updates */
  onProgress?: (progress: number) => void;
}

/**
 * LLM generation result
 */
export interface LLMGenerationResult {
  /** Generated text (complete) */
  text: string;

  /** Number of tokens used (if available) */
  tokensUsed?: number;

  /** Finish reason (e.g., "stop", "length", "error") */
  finishReason?: string;

  /** Model ID that generated this */
  modelId: string;
}
