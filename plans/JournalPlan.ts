/**
 * Journal Plan - Records LLM interactions using Plan + Story pattern
 *
 * @deprecated Use assembly.core's JournalPlan.queryAssemblies() instead.
 * The conversion layer (JournalEntry types) is no longer needed - JournalView
 * now works with AssemblyWithStory directly, filtering by assembly.domain.
 *
 * This class remains for backward compatibility but should not be used for new code.
 * See: @assembly/core/plans/JournalPlan.ts
 *
 * Architecture (following assembly.core canonical pattern):
 * 1. Create Plan for each LLM call (learned pattern for future matching)
 * 2. Create Story documenting the execution (audit trail with all metadata)
 *
 * This follows the Plan/Story pattern from assembly.core:
 * - Plan = Learned pattern from this LLM call (demand/supply patterns)
 * - Story = Audit trail documenting execution (prompt, response, tokens, timing, error)
 *
 * All data (prompt, response, tokens, etc.) is stored in Story.metadata Map.
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getInstanceIdHash } from '@refinio/one.core/lib/instance.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

export interface LLMCallMetadata {
  conversationId: string;       // Conversation context
  userId: SHA256IdHash<Person>; // User who triggered this
  modelId: string;              // Which model was used
  prompt: string;               // User's input
  response?: string;            // AI's response (may be streaming)
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  timing?: {
    start: number;
    firstToken?: number;
    complete?: number;
  };
  error?: string;               // Error message if call failed
}

/**
 * Unified Journal Entry Types (Discriminated Union)
 *
 * All journal entries have a common base with `type` discriminator.
 */

// Base entry with common fields
interface BaseJournalEntry {
  id: string;
  timestamp: number;
  type: string;
}

// Conversation message entry (from ChatPlan)
export interface ConversationEntry extends BaseJournalEntry {
  type: 'conversation';
  conversationId: string;
  messageId: string;
  sender: string;
  senderName: string;
  content: string;
  attachments?: any[];
  isAI?: boolean;
}

// Memory entry - Subject (from SubjectsPlan)
export interface MemoryEntry extends BaseJournalEntry {
  type: 'memory';
  subjectId: string;
  subjectName: string;
  topicId: string;
  keywords: string[];
  messageCount: number;
  createdAt: number;
  lastSeenAt: number;
}

// LLM call entry (from JournalPlan Plan/Story)
export interface LLMCallEntry extends BaseJournalEntry {
  type: 'llm-call';
  conversationId: string;
  userId: string;
  modelId: string;
  prompt: string;
  response?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  timing?: {
    start: number;
    firstToken?: number;
    complete?: number;
  };
  error?: string;
}

// AI contact created entry (from JournalPlan Plan/Story)
export interface AIContactEntry extends BaseJournalEntry {
  type: 'ai-contact';
  userId: string;
  aiPersonId: string;
  modelId: string;
  displayName: string;
}

// Other event types (extensible)
export interface SystemEventEntry extends BaseJournalEntry {
  type: 'system-event';
  eventType: string;
  description: string;
  metadata?: any;
}

// Unified Journal Entry (discriminated union)
export type JournalEntry =
  | ConversationEntry
  | MemoryEntry
  | LLMCallEntry
  | AIContactEntry
  | SystemEventEntry;

/**
 * Storage dependencies for JournalPlan
 */
export interface JournalPlanDeps {
  storeVersionedObject: typeof storeVersionedObject;
  getInstanceIdHash: typeof getInstanceIdHash;
  calculateIdHashOfObj: typeof calculateIdHashOfObj;
}

/**
 * External dependencies for unified journal aggregation
 */
export interface JournalPlanExternalDeps {
  chatPlan?: any;      // ChatPlan for conversation entries
  subjectsPlan?: any;  // SubjectsPlan for memory entries
}

/**
 * Journal Plan for recording LLM interactions
 * @deprecated Use assembly.core's JournalPlan instead.
 */
export class JournalPlan {
  private chatPlan?: any;
  private subjectsPlan?: any;

  constructor(
    private deps: JournalPlanDeps,
    externalDeps?: JournalPlanExternalDeps
  ) {
    this.chatPlan = externalDeps?.chatPlan;
    this.subjectsPlan = externalDeps?.subjectsPlan;
  }

  /**
   * Set external dependencies after construction (for dependency injection)
   */
  setExternalDeps(externalDeps: JournalPlanExternalDeps): void {
    this.chatPlan = externalDeps.chatPlan;
    this.subjectsPlan = externalDeps.subjectsPlan;
  }

  /**
   * Create a Plan for an LLM call
   *
   * The plan represents the "execution plan" - what was requested and how it should be matched.
   * In this case, the LLM call itself IS the plan.
   */
  private async createLLMCallPlan(metadata: LLMCallMetadata): Promise<SHA256IdHash<any>> {
    try {
      // Generate unique ID for this LLM call
      const callId = `llm-${metadata.userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create Plan representing this LLM call
      const now = Date.now();
      const plan = {
        $type$: 'Plan' as const,
        id: callId,
        name: `LLM Call: ${metadata.modelId}`,
        description: `Conversation ${metadata.conversationId} - User ${metadata.userId.substring(0, 8)}`,
        demandPatterns: [
          {
            keywords: ['llm', 'chat', 'prompt'],
            urgency: 1,
            criteria: {
              conversationId: metadata.conversationId,
              prompt: metadata.prompt.substring(0, 100) // First 100 chars for pattern
            }
          }
        ],
        supplyPatterns: [
          {
            keywords: ['model', metadata.modelId],
            criteria: { modelId: metadata.modelId }
          }
        ],
        owner: metadata.userId.toString(),
        created: metadata.timing?.start || now,
        modified: now,
        status: 'executed'
      };

      // Store the plan
      const result = await this.deps.storeVersionedObject(plan);
      console.log(`[JournalPlan] Created Plan: ${callId} (${result.idHash?.toString().substring(0, 8)})`);

      return result.idHash as SHA256IdHash<any>;
    } catch (error) {
      console.error('[JournalPlan] Failed to create Plan:', error);
      throw error;
    }
  }

  /**
   * Create a Story documenting the LLM call execution
   */
  private async createStory(
    planIdHash: SHA256IdHash<any>,
    metadata: LLMCallMetadata
  ): Promise<void> {
    try {
      const instanceVersion = this.deps.getInstanceIdHash();
      if (!instanceVersion) {
        console.warn('[JournalPlan] No instance version - skipping story');
        return;
      }

      // Generate unique story ID
      const storyId = `story-${metadata.userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Build metadata map
      const storyMetadata = new Map<string, string>();
      storyMetadata.set('prompt', metadata.prompt);
      storyMetadata.set('model', metadata.modelId);
      storyMetadata.set('conversationId', metadata.conversationId);

      if (metadata.response) {
        storyMetadata.set('response', metadata.response);
      }
      if (metadata.tokens) {
        storyMetadata.set('tokens', JSON.stringify(metadata.tokens));
      }
      if (metadata.error) {
        storyMetadata.set('error', metadata.error);
      }

      const now = Date.now();
      const startTime = metadata.timing?.start || now;
      const duration = metadata.timing?.complete ? metadata.timing.complete - startTime : undefined;

      // Create Story documenting the LLM call execution
      const story = {
        $type$: 'Story' as const,
        id: storyId,
        title: `LLM Call: ${metadata.modelId}`,
        description: `${metadata.prompt.substring(0, 100)}...`,
        plan: planIdHash,
        product: planIdHash,  // For now, reference the plan as product (can be refined later)
        instanceVersion: instanceVersion.toString(),
        outcome: metadata.response?.substring(0, 200) || metadata.error || 'No response',
        success: !metadata.error,
        metadata: storyMetadata,
        actor: metadata.userId.toString(),
        created: startTime,
        duration,
        owner: metadata.userId.toString(),
        domain: 'llm-journal'
      };

      // Store the story
      await this.deps.storeVersionedObject(story);
      console.log(`[JournalPlan] Created Story: ${storyId} for plan ${planIdHash.toString().substring(0, 8)}`);
    } catch (error) {
      console.error(`[JournalPlan] Failed to create Story:`, error);
      // Don't throw - journal failures shouldn't break LLM calls
    }
  }

  /**
   * Record a complete LLM call
   *
   * Steps:
   * 1. Create Plan (the learned pattern from this LLM call)
   * 2. Create Story (audit trail documenting the execution)
   */
  async recordLLMCall(metadata: LLMCallMetadata): Promise<void> {
    try {
      // Step 1: Create the Plan
      const planIdHash = await this.createLLMCallPlan(metadata);

      // Step 2: Create the Story documenting execution
      await this.createStory(planIdHash, metadata);

      console.log(`[JournalPlan] Recorded LLM call with Plan and Story`);
    } catch (error) {
      console.error('[JournalPlan] Failed to record LLM call:', error);
      // Don't throw - journal failures shouldn't break LLM calls
    }
  }

  /**
   * Record AI contact creation
   *
   * This records the creation of an AI assistant contact (Person/Profile/Someone)
   * using Plan/Story pattern.
   */
  async recordAIContactCreation(
    userId: SHA256IdHash<Person>,
    aiPersonId: SHA256IdHash<Person>,
    modelId: string,
    displayName: string
  ): Promise<void> {
    try {
      // Generate unique ID for this AI contact creation
      const creationId = `ai-contact-${modelId}-${Date.now()}`;
      const now = Date.now();

      // Create Plan for AI contact creation
      const plan = {
        $type$: 'Plan' as const,
        id: creationId,
        name: `AI Contact Created: ${displayName}`,
        description: `Created AI assistant contact for model ${modelId}`,
        demandPatterns: [
          {
            keywords: ['ai', 'assistant', 'contact', 'creation'],
            urgency: 1
          }
        ],
        supplyPatterns: [
          {
            keywords: ['model', modelId, 'ai-contact']
          }
        ],
        owner: userId.toString(),
        created: now,
        modified: now,
        status: 'executed',
        domain: 'ai-contacts'
      };

      // Store the plan
      const result = await this.deps.storeVersionedObject(plan);
      const planIdHash = result.idHash as SHA256IdHash<any>;
      console.log(`[JournalPlan] Created Plan for AI contact: ${creationId} (${planIdHash.toString().substring(0, 8)})`);

      // Create Story documenting the creation
      const instanceVersion = this.deps.getInstanceIdHash();
      if (!instanceVersion) {
        console.warn('[JournalPlan] No instance version - skipping story');
        return;
      }

      const storyId = `story-ai-contact-${modelId}-${Date.now()}`;
      const storyMetadata = new Map<string, string>();
      storyMetadata.set('modelId', modelId);
      storyMetadata.set('displayName', displayName);
      storyMetadata.set('aiPersonId', aiPersonId.toString());
      storyMetadata.set('createdBy', userId.toString());
      storyMetadata.set('trustLevel', 'high');

      const story = {
        $type$: 'Story' as const,
        id: storyId,
        title: `AI Contact Created: ${displayName}`,
        description: `Created AI assistant contact for model ${modelId}`,
        plan: planIdHash,
        product: planIdHash,  // Reference plan as product
        instanceVersion: instanceVersion.toString(),
        outcome: `AI contact ${displayName} created successfully`,
        success: true,
        metadata: storyMetadata,
        actor: userId.toString(),
        created: now,
        owner: userId.toString(),
        domain: 'ai-contacts'
      };

      await this.deps.storeVersionedObject(story);
      console.log(`[JournalPlan] Recorded AI contact creation with Plan and Story`);
    } catch (error) {
      console.error('[JournalPlan] Failed to record AI contact creation:', error);
      // Don't throw - journal failures shouldn't break AI contact creation
    }
  }

  /**
   * Query journal entries for a specific LLM call (by plan ID)
   */
  async getCallEntries(_planIdHash: SHA256IdHash<any>): Promise<Map<string, string>> {
    // TODO: Implement query using ONE.core reverse maps
    // Query all Assemblies where aiAssistantCall = planIdHash
    console.warn('[JournalPlan] Query not implemented yet - use ONE.core reverse maps');
    return new Map();
  }

  /**
   * Query all journal entries for a conversation
   */
  async getConversationHistory(_conversationId: string): Promise<any[]> {
    // TODO: Implement query using ONE.core reverse maps
    // Query all AssemblyPlans where metadata.conversationId = conversationId
    console.warn('[JournalPlan] Query not implemented yet - use ONE.core reverse maps');
    return [];
  }

  /**
   * Get all journal entries from all sources in chronological order
   *
   * @deprecated Use assembly.core's JournalPlan.queryAssemblies() instead.
   * This method aggregates from multiple sources and converts to JournalEntry format.
   * The new approach queries Assembly objects directly by domain, eliminating conversion.
   *
   * Aggregates:
   * 1. Conversations (from ChatPlan)
   * 2. Memory entries (from SubjectsPlan)
   * 3. LLM calls (from JournalPlan's Plan/Story storage - TODO)
   * 4. AI contacts created (from JournalPlan's Plan/Story storage - TODO)
   * 5. Other events
   *
   * @param options - Filtering options (conversationId, type, limit, offset)
   * @returns Unified chronological journal feed
   */
  async getAllEntries(options?: {
    conversationId?: string;
    type?: JournalEntry['type'] | JournalEntry['type'][];
    limit?: number;
    offset?: number;
  }): Promise<JournalEntry[]> {
    const allEntries: JournalEntry[] = [];

    // 1. Aggregate conversation entries (from ChatPlan)
    if (this.chatPlan) {
      try {
        const conversationsResponse = await this.chatPlan.getConversations({});
        if (conversationsResponse.success && conversationsResponse.data) {
          for (const conversation of conversationsResponse.data) {
            // Skip if filtering by conversationId
            if (options?.conversationId && conversation.id !== options.conversationId) {
              continue;
            }

            const messagesResponse = await this.chatPlan.getMessages({
              conversationId: conversation.id,
              limit: 1000 // Get all messages for now
            });

            if (messagesResponse.success && messagesResponse.messages) {
              for (const message of messagesResponse.messages) {
                const entry: ConversationEntry = {
                  type: 'conversation',
                  id: message.id || `msg-${message.timestamp}`,
                  timestamp: message.timestamp,
                  conversationId: conversation.id,
                  messageId: message.id || '',
                  sender: message.sender || '',
                  senderName: message.senderName || 'Unknown',
                  content: message.content || '',
                  attachments: message.attachments,
                  isAI: message.isAI
                };
                allEntries.push(entry);
              }
            }
          }
        }
      } catch (error) {
        console.error('[JournalPlan] Failed to aggregate conversation entries:', error);
      }
    }

    // 2. Aggregate memory entries (from SubjectsPlan)
    if (this.subjectsPlan) {
      try {
        const subjectsResponse = await this.subjectsPlan.getAll({});
        if (subjectsResponse.success && subjectsResponse.subjects) {
          for (const subject of subjectsResponse.subjects) {
            const entry: MemoryEntry = {
              type: 'memory',
              id: subject.id || `subject-${subject.createdAt}`,
              timestamp: subject.createdAt || Date.now(),
              subjectId: subject.id || '',
              subjectName: subject.description || subject.id || '', // Use description or id as name
              topicId: subject.topic || '',
              // Convert keyword hashes to strings (just use hash as string for now)
              keywords: (subject.keywords || []).map(k => k?.toString() || ''),
              messageCount: subject.messageCount || 0,
              createdAt: subject.createdAt || Date.now(),
              lastSeenAt: subject.lastSeenAt || Date.now()
            };
            allEntries.push(entry);
          }
        }
      } catch (error) {
        console.error('[JournalPlan] Failed to aggregate memory entries:', error);
      }
    }

    // 3. TODO: Aggregate LLM call entries (from Plan/Story objects)
    // This requires implementing ONE.core reverse map queries
    // Query all Plans where $type$ = 'Plan' AND domain = 'llm-journal'
    // For each plan, find corresponding Story and reconstruct the LLMCallEntry from Story.metadata

    // 4. TODO: Aggregate AI contact entries (from Plan/Story objects)
    // Query all Plans where $type$ = 'Plan' AND domain = 'ai-contacts'
    // For each plan, find corresponding Story and reconstruct the AIContactEntry from Story.metadata

    // Filter by type if specified
    let filteredEntries = allEntries;
    if (options?.type) {
      const types = Array.isArray(options.type) ? options.type : [options.type];
      filteredEntries = allEntries.filter(entry => types.includes(entry.type as any));
    }

    // Sort chronologically (oldest to newest)
    filteredEntries.sort((a, b) => a.timestamp - b.timestamp);

    // Apply pagination
    if (options?.offset !== undefined || options?.limit !== undefined) {
      const offset = options.offset || 0;
      const limit = options.limit || filteredEntries.length;
      filteredEntries = filteredEntries.slice(offset, offset + limit);
    }

    console.log(`[JournalPlan] Aggregated ${filteredEntries.length} journal entries`);
    return filteredEntries;
  }
}
