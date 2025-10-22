/**
 * AITaskManager
 *
 * Manages dynamic task associations for Information over Messages (IoM).
 * This component handles task configuration and execution for AI topics,
 * including keyword extraction, subject creation, and summary generation.
 *
 * Responsibilities:
 * - Initialize subject channel for IoM storage
 * - Associate tasks with topics (e.g., keyword extraction, summary generation)
 * - Execute configured tasks for incoming messages
 * - Manage task parameters and state
 */

import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type { IAITaskManager } from './interfaces.js';
import type { AITaskType, AITaskConfig } from './types.js';

export class AITaskManager implements IAITaskManager {
  // Task associations (topicId → task configs)
  private topicTaskAssociations: Map<string, AITaskConfig[]>;

  // Subject channel ID (for IoM storage)
  private subjectChannelId: string | null;

  constructor(
    private channelManager: ChannelManager,
    private topicAnalysisModel?: any // Optional - for subject/keyword extraction
  ) {
    this.topicTaskAssociations = new Map();
    this.subjectChannelId = null;
  }

  /**
   * Initialize the subject channel for IoM storage
   * Creates a channel for storing subjects and keywords
   */
  async initializeSubjectChannel(): Promise<void> {
    console.log('[AITaskManager] Initializing subject channel...');

    try {
      // Check if subject channel already exists
      const existingChannels = await this.channelManager.getMatchingChannelInfos({ channelId: 'ai-subjects' });

      if (existingChannels.length > 0) {
        this.subjectChannelId = 'ai-subjects';
        console.log('[AITaskManager] Subject channel already exists');
        return;
      }

      // Create subject channel
      const channelInfo = await this.channelManager.createChannel('ai-subjects');

      this.subjectChannelId = (channelInfo as any).id;
      console.log('[AITaskManager] Created subject channel:', this.subjectChannelId);
    } catch (error) {
      console.error('[AITaskManager] Failed to initialize subject channel:', error);
      throw error;
    }
  }

  /**
   * Associate a task with a topic
   * Enables a specific task type for the topic
   */
  async associateTaskWithTopic(topicId: string, taskType: AITaskType): Promise<void> {
    console.log(`[AITaskManager] Associating task '${taskType}' with topic: ${topicId}`);

    // Get existing tasks for this topic
    const existingTasks = this.topicTaskAssociations.get(topicId) || [];

    // Check if task already exists
    const existingTask = existingTasks.find(t => t.type === taskType);
    if (existingTask) {
      console.log(`[AITaskManager] Task '${taskType}' already associated with topic: ${topicId}`);
      return;
    }

    // Add new task
    const newTask: AITaskConfig = {
      type: taskType,
      enabled: true,
      parameters: this.getDefaultParametersForTaskType(taskType),
    };

    existingTasks.push(newTask);
    this.topicTaskAssociations.set(topicId, existingTasks);

    console.log(`[AITaskManager] Associated task '${taskType}' with topic: ${topicId}`);
  }

  /**
   * Get tasks configured for a topic
   * Returns only enabled tasks
   */
  getTasksForTopic(topicId: string): AITaskConfig[] {
    const tasks = this.topicTaskAssociations.get(topicId) || [];
    return tasks.filter(t => t.enabled);
  }

  /**
   * Execute tasks for a message
   * Runs all enabled tasks configured for the topic
   */
  async executeTasksForMessage(topicId: string, message: string): Promise<any> {
    const tasks = this.getTasksForTopic(topicId);

    if (tasks.length === 0) {
      return null;
    }

    console.log(`[AITaskManager] Executing ${tasks.length} tasks for topic: ${topicId}`);

    const results: Record<string, any> = {};

    for (const task of tasks) {
      try {
        const result = await this.executeTask(topicId, task, message);
        results[task.type] = result;
      } catch (error) {
        console.warn(`[AITaskManager] Task '${task.type}' failed:`, error);
        results[task.type] = { error: error instanceof Error ? error.message : String(error) };
      }
    }

    return results;
  }

  /**
   * Execute a single task
   */
  private async executeTask(
    topicId: string,
    task: AITaskConfig,
    message: string
  ): Promise<any> {
    if (!this.topicAnalysisModel) {
      console.warn('[AITaskManager] TopicAnalysisModel not available, skipping task execution');
      return null;
    }

    switch (task.type) {
      case 'keyword-extraction':
        return await this.executeKeywordExtraction(topicId, message, task.parameters);

      case 'subject-creation':
        return await this.executeSubjectCreation(topicId, message, task.parameters);

      case 'summary-generation':
        return await this.executeSummaryGeneration(topicId, message, task.parameters);

      case 'research':
        return await this.executeResearch(topicId, message, task.parameters);

      case 'custom':
        return await this.executeCustomTask(topicId, message, task.parameters);

      default:
        console.warn(`[AITaskManager] Unknown task type: ${task.type}`);
        return null;
    }
  }

  /**
   * Execute keyword extraction task
   */
  private async executeKeywordExtraction(
    topicId: string,
    message: string,
    parameters?: Record<string, any>
  ): Promise<any> {
    console.log(`[AITaskManager] Extracting keywords for topic: ${topicId}`);

    try {
      const keywords = await this.topicAnalysisModel.extractKeywords(message, parameters);
      console.log(`[AITaskManager] Extracted ${keywords.length} keywords`);
      return { keywords };
    } catch (error) {
      console.error('[AITaskManager] Keyword extraction failed:', error);
      throw error;
    }
  }

  /**
   * Execute subject creation task
   */
  private async executeSubjectCreation(
    topicId: string,
    message: string,
    parameters?: Record<string, any>
  ): Promise<any> {
    console.log(`[AITaskManager] Creating subjects for topic: ${topicId}`);

    try {
      const subjects = await this.topicAnalysisModel.identifySubjects(topicId, message, parameters);
      console.log(`[AITaskManager] Created ${subjects.length} subjects`);
      return { subjects };
    } catch (error) {
      console.error('[AITaskManager] Subject creation failed:', error);
      throw error;
    }
  }

  /**
   * Execute summary generation task
   */
  private async executeSummaryGeneration(
    topicId: string,
    message: string,
    parameters?: Record<string, any>
  ): Promise<any> {
    console.log(`[AITaskManager] Generating summary for topic: ${topicId}`);

    try {
      const summary = await this.topicAnalysisModel.generateSummary(topicId, parameters);
      console.log('[AITaskManager] Generated summary');
      return { summary };
    } catch (error) {
      console.error('[AITaskManager] Summary generation failed:', error);
      throw error;
    }
  }

  /**
   * Execute research task
   */
  private async executeResearch(
    topicId: string,
    message: string,
    parameters?: Record<string, any>
  ): Promise<any> {
    console.log(`[AITaskManager] Executing research for topic: ${topicId}`);

    // Research task implementation would go here
    // This is a placeholder for future research capabilities
    return { status: 'not_implemented' };
  }

  /**
   * Execute custom task
   */
  private async executeCustomTask(
    topicId: string,
    message: string,
    parameters?: Record<string, any>
  ): Promise<any> {
    console.log(`[AITaskManager] Executing custom task for topic: ${topicId}`);

    // Custom task implementation would be provided via parameters
    if (parameters?.handler && typeof parameters.handler === 'function') {
      return await parameters.handler(topicId, message, parameters);
    }

    return { status: 'no_handler' };
  }

  /**
   * Get default parameters for a task type
   */
  private getDefaultParametersForTaskType(taskType: AITaskType): Record<string, any> {
    switch (taskType) {
      case 'keyword-extraction':
        return {
          maxKeywords: 10,
          minConfidence: 0.5,
        };

      case 'subject-creation':
        return {
          maxSubjects: 5,
          minKeywordsPerSubject: 2,
        };

      case 'summary-generation':
        return {
          maxLength: 500,
          updateInterval: 10, // Update summary every 10 messages
        };

      case 'research':
        return {
          depth: 'shallow',
          sources: [],
        };

      case 'custom':
        return {};

      default:
        return {};
    }
  }

  /**
   * Disable a task for a topic
   */
  disableTask(topicId: string, taskType: AITaskType): void {
    const tasks = this.topicTaskAssociations.get(topicId);
    if (!tasks) {
      return;
    }

    const task = tasks.find(t => t.type === taskType);
    if (task) {
      task.enabled = false;
      console.log(`[AITaskManager] Disabled task '${taskType}' for topic: ${topicId}`);
    }
  }

  /**
   * Enable a task for a topic
   */
  enableTask(topicId: string, taskType: AITaskType): void {
    const tasks = this.topicTaskAssociations.get(topicId);
    if (!tasks) {
      return;
    }

    const task = tasks.find(t => t.type === taskType);
    if (task) {
      task.enabled = true;
      console.log(`[AITaskManager] Enabled task '${taskType}' for topic: ${topicId}`);
    }
  }

  /**
   * Update task parameters
   */
  updateTaskParameters(
    topicId: string,
    taskType: AITaskType,
    parameters: Record<string, any>
  ): void {
    const tasks = this.topicTaskAssociations.get(topicId);
    if (!tasks) {
      return;
    }

    const task = tasks.find(t => t.type === taskType);
    if (task) {
      task.parameters = { ...task.parameters, ...parameters };
      console.log(`[AITaskManager] Updated parameters for task '${taskType}' on topic: ${topicId}`);
    }
  }
}
