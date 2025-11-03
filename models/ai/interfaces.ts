/**
 * Component Interfaces for AI Assistant
 *
 * Defines interfaces for all AI assistant components with clear
 * dependency contracts and responsibilities.
 *
 * Copied from specs/021-ai-assistant-core-refactor/contracts/components.ts
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type {
  AIMode,
  AITaskType,
  AITaskConfig,
  LLMModelInfo,
  PromptResult,
  RestartContext,
} from './types.js';

/**
 * AITopicManager: Manages topic-to-model mappings and topic lifecycle
 */
export interface IAITopicManager {
  /** Map of topicId → modelId */
  readonly topicModelMap: ReadonlyMap<string, string>;

  /** Map of topicId → isLoading */
  readonly topicLoadingState: ReadonlyMap<string, boolean>;

  /** Display names for topics */
  readonly topicDisplayNames: Readonly<Record<string, string>>;

  /** Register an AI topic with its model */
  registerAITopic(topicId: string, modelId: string): void;

  /** Check if a topic is an AI topic */
  isAITopic(topicId: string): boolean;

  /** Get model ID for a topic */
  getModelIdForTopic(topicId: string): string | null;

  /** Set loading state for a topic */
  setTopicLoadingState(topicId: string, isLoading: boolean): void;

  /** Check if topic is loading */
  isTopicLoading(topicId: string): boolean;

  /** Get topic display name */
  getTopicDisplayName(topicId: string): string | undefined;

  /** Set topic display name */
  setTopicDisplayName(topicId: string, name: string): void;

  /** Get all AI topic IDs */
  getAllAITopicIds(): string[];

  /** Set AI mode for a topic */
  setTopicAIMode(topicId: string, mode: AIMode): void;

  /** Get AI mode for a topic */
  getTopicAIMode(topicId: string): AIMode | undefined;
}

/**
 * AIMessageProcessor: Handles message queuing and processing
 */
export interface IAIMessageProcessor {
  /** Handle a new topic message */
  handleTopicMessage(topicId: string, message: any): Promise<void>;

  /** Process a message and generate AI response */
  processMessage(
    topicId: string,
    text: string,
    senderId: SHA256IdHash<Person>
  ): Promise<string | null>;

  /** Check if a message is from an AI */
  isAIMessage(message: any): boolean;

  /** Check if a person/profile ID is an AI contact */
  isAIContact(personId: SHA256IdHash<Person> | string): boolean;

  /** Set AI assistant handler (circular dependency resolution) */
  setAIAssistant(assistant: any): void;

  /** Set prompt builder (circular dependency resolution) */
  setPromptBuilder(builder: IAIPromptBuilder): void;

  /** Set task manager (circular dependency resolution) */
  setTaskManager(manager: IAITaskManager): void;

  /** Set available LLM models */
  setAvailableLLMModels(models: LLMModelInfo[]): void;

  /** Callback for generation progress */
  onGenerationProgress?: (topicId: string, progress: number) => void;
}

/**
 * AIPromptBuilder: Constructs prompts with context
 */
export interface IAIPromptBuilder {
  /** Build a prompt for a message */
  buildPrompt(
    topicId: string,
    newMessage: string,
    senderId: SHA256IdHash<Person>
  ): Promise<PromptResult>;

  /** Check if context window restart is needed */
  checkContextWindowAndPrepareRestart(
    topicId: string,
    messages: any[]
  ): Promise<RestartContext>;

  /** Generate conversation summary for restart */
  generateConversationSummaryForRestart(
    topicId: string,
    messages: any[]
  ): Promise<string>;

  /** Set message processor (circular dependency resolution) */
  setMessageProcessor(processor: IAIMessageProcessor): void;

  /** Add a new message to the cache (updates cache instead of invalidating) */
  addMessageToCache(topicId: string, message: any): void;

  /** Invalidate message cache for a topic (call when cache is unreliable) */
  invalidateMessageCache(topicId: string): void;

  /** Clear all message caches */
  clearMessageCache(): void;
}

/**
 * AIContactManager: Manages AI contacts (Person/Profile/Someone)
 */
export interface IAIContactManager {
  /** Ensure AI contact exists for a model */
  ensureAIContactForModel(
    modelId: string,
    displayName: string
  ): Promise<SHA256IdHash<Person>>;

  /** Create AI contact */
  createAIContact(
    modelId: string,
    displayName: string
  ): Promise<SHA256IdHash<Person>>;

  /** Get person ID for a model */
  getPersonIdForModel(modelId: string): SHA256IdHash<Person> | null;

  /** Check if person ID is an AI person */
  isAIPerson(personId: SHA256IdHash<Person>): boolean;

  /** Get model ID for a person ID (reverse lookup) */
  getModelIdForPersonId(personId: SHA256IdHash<Person>): string | null;

  /** Ensure contacts for all models */
  ensureContactsForModels(models: LLMModelInfo[]): Promise<number>;
}

/**
 * AITaskManager: Manages dynamic task associations (IoM)
 */
export interface IAITaskManager {
  /** Initialize the subject channel */
  initializeSubjectChannel(): Promise<void>;

  /** Associate a task with a topic */
  associateTaskWithTopic(topicId: string, taskType: AITaskType): Promise<void>;

  /** Get tasks configured for a topic */
  getTasksForTopic(topicId: string): AITaskConfig[];

  /** Execute tasks for a message */
  executeTasksForMessage(topicId: string, message: string): Promise<any>;
}

/**
 * Component dependency graph
 *
 * AIHandler
 * ├── AITopicManager (no circular deps)
 * ├── AIContactManager (no circular deps)
 * ├── AITaskManager (no circular deps)
 * ├── AIPromptBuilder <-> AIMessageProcessor (circular, resolved via setters)
 * └── AIMessageProcessor <-> AIPromptBuilder (circular, resolved via setters)
 *                         └-> AITaskManager (injected via setter)
 */

/**
 * Example two-phase initialization:
 *
 * ```typescript
 * // Phase 1: Construct components with non-circular dependencies
 * const topicManager = new AITopicManager(
 *   topicModel, channelManager, leuteModel, llmManager
 * );
 *
 * const contactManager = new AIContactManager(leuteModel, llmObjectManager);
 *
 * const taskManager = new AITaskManager(channelManager, topicAnalysisModel);
 *
 * const promptBuilder = new AIPromptBuilder(
 *   channelManager, llmManager, topicManager, contextEnrichmentService
 * );
 *
 * const messageProcessor = new AIMessageProcessor(
 *   channelManager, llmManager, leuteModel, topicManager, stateManager
 * );
 *
 * // Phase 2: Resolve circular dependencies via setters
 * promptBuilder.setMessageProcessor(messageProcessor);
 * messageProcessor.setPromptBuilder(promptBuilder);
 * messageProcessor.setTaskManager(taskManager);
 * ```
 */
