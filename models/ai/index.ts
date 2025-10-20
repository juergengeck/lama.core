/**
 * AI Models Package Exports
 *
 * Central export point for all AI assistant components, types, and interfaces.
 * This file provides a clean API surface for importing AI functionality.
 */

// Type exports
export type {
  AIMode,
  AITaskType,
  AITaskConfig,
  LLMModelInfo,
  PromptResult,
  RestartContext,
  MessageQueueEntry,
  AIContactCreationResult,
  TopicAnalysisResult,
  LLMGenerationOptions,
  LLMGenerationResult,
} from './types.js';

// Interface exports
export type {
  IAITopicManager,
  IAIMessageProcessor,
  IAIPromptBuilder,
  IAIContactManager,
  IAITaskManager,
} from './interfaces.js';

// Component exports (will be added as components are implemented)
export { AITopicManager } from './AITopicManager.js';
// export { AIMessageProcessor } from './AIMessageProcessor.js';
export { AIPromptBuilder } from './AIPromptBuilder.js';
export { AIContactManager } from './AIContactManager.js';
export { AITaskManager } from './AITaskManager.js';
