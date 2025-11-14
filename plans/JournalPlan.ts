/**
 * Journal Plan - Records LLM interactions using AssemblyPlan + Assembly objects
 *
 * Architecture:
 * 1. Create AssemblyPlan for each LLM call (the "plan" that was executed)
 * 2. Create multiple Assembly objects referencing that plan (the "products")
 *    - One Assembly per property: prompt, response, model, tokens, timing, error
 *
 * Each Assembly is identified by: aiAssistantCall (plan reference) + property (composite ID)
 *
 * This follows the Plan/Product pattern:
 * - AssemblyPlan = The LLM call execution plan
 * - Assembly (Product) = Individual properties captured from that execution
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

// LLM call entry (from JournalPlan AssemblyPlan)
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

// AI contact created entry (from JournalPlan AssemblyPlan)
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
   * Create an AssemblyPlan for an LLM call
   *
   * The plan represents the "execution plan" - what was requested and how it should be matched.
   * In this case, the LLM call itself IS the plan.
   */
  private async createLLMCallPlan(metadata: LLMCallMetadata): Promise<SHA256IdHash<any>> {
    try {
      // Generate unique ID for this LLM call
      const callId = `llm-${metadata.userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create AssemblyPlan representing this LLM call
      const now = Date.now();
      const plan = {
        $type$: 'AssemblyPlan' as const,
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
      console.log(`[JournalPlan] Created AssemblyPlan: ${callId} (${result.idHash?.toString().substring(0, 8)})`);

      return result.idHash as SHA256IdHash<any>;
    } catch (error) {
      console.error('[JournalPlan] Failed to create AssemblyPlan:', error);
      throw error;
    }
  }

  /**
   * Create an Assembly (Product) for a specific property of the LLM call
   */
  private async createPropertyAssembly(
    planIdHash: SHA256IdHash<any>,
    property: string,
    value: string,
    metadata: LLMCallMetadata
  ): Promise<void> {
    try {
      const instanceVersion = this.deps.getInstanceIdHash();
      if (!instanceVersion) {
        console.warn('[JournalPlan] No instance version - skipping assembly');
        return;
      }

      // Create Assembly (Product) for this property
      const now = Date.now();
      const assembly = {
        $type$: 'CubeAssembly' as const,
        aiAssistantCall: planIdHash.toString(),  // References the AssemblyPlan
        property: property,            // Which property this captures
        supply: value,                 // The actual value
        demand: undefined,             // No demand for journal entries
        instanceVersion,
        children: undefined,
        plan: planIdHash.toString(),   // Also store in plan field for compatibility
        owner: metadata.userId.toString(),
        created: metadata.timing?.start || now,
        modified: now
      };

      // Store the assembly
      await this.deps.storeVersionedObject(assembly);
      console.log(`[JournalPlan] Created Assembly: ${property} for plan ${planIdHash.toString().substring(0, 8)}`);
    } catch (error) {
      console.error(`[JournalPlan] Failed to create Assembly for ${property}:`, error);
      // Don't throw - journal failures shouldn't break LLM calls
    }
  }

  /**
   * Record a complete LLM call with all its properties
   *
   * Steps:
   * 1. Create AssemblyPlan (the "plan" that was executed)
   * 2. Create Assembly objects for each property (the "products")
   */
  async recordLLMCall(metadata: LLMCallMetadata): Promise<void> {
    try {
      // Step 1: Create the AssemblyPlan
      const planIdHash = await this.createLLMCallPlan(metadata);

      // Step 2: Create Assembly objects for each property
      const properties: Array<{ property: string; value: string }> = [
        { property: 'prompt', value: metadata.prompt },
        { property: 'model', value: metadata.modelId }
      ];

      // Add response if available
      if (metadata.response) {
        properties.push({ property: 'response', value: metadata.response });
      }

      // Add tokens if available
      if (metadata.tokens) {
        properties.push({ property: 'tokens', value: JSON.stringify(metadata.tokens) });
      }

      // Add timing if available
      if (metadata.timing) {
        properties.push({ property: 'timing', value: JSON.stringify(metadata.timing) });
      }

      // Add error if present
      if (metadata.error) {
        properties.push({ property: 'error', value: metadata.error });
      }

      // Create all Assembly objects in parallel
      await Promise.all(
        properties.map(({ property, value }) =>
          this.createPropertyAssembly(planIdHash, property, value, metadata)
        )
      );

      console.log(`[JournalPlan] Recorded LLM call with ${properties.length} properties`);
    } catch (error) {
      console.error('[JournalPlan] Failed to record LLM call:', error);
      // Don't throw - journal failures shouldn't break LLM calls
    }
  }

  /**
   * Record AI contact creation as an assembly
   *
   * This records the creation of an AI assistant contact (Person/Profile/Someone)
   * as an assembly in the journal.
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

      // Create AssemblyPlan for AI contact creation
      const now = Date.now();
      const plan = {
        $type$: 'AssemblyPlan' as const,
        id: creationId,
        name: `AI Contact Created: ${displayName}`,
        description: `Created AI assistant contact for model ${modelId}`,
        demandPatterns: [
          {
            keywords: ['ai', 'assistant', 'contact', 'creation'],
            urgency: 1,
            criteria: {
              modelId: modelId,
              displayName: displayName
            }
          }
        ],
        supplyPatterns: [
          {
            keywords: ['model', modelId, 'ai-contact'],
            criteria: {
              modelId: modelId,
              personId: aiPersonId.toString()
            }
          }
        ],
        owner: userId.toString(),
        created: now,
        modified: now,
        status: 'executed'
      };

      // Store the plan (cast to any to work around strict typing for criteria)
      const result = await this.deps.storeVersionedObject(plan as any);
      const planIdHash = result.idHash as SHA256IdHash<any>;
      console.log(`[JournalPlan] Created AssemblyPlan for AI contact: ${creationId} (${planIdHash.toString().substring(0, 8)})`);

      // Create Assembly objects for each property
      const instanceVersion = this.deps.getInstanceIdHash();
      if (!instanceVersion) {
        console.warn('[JournalPlan] No instance version - skipping assembly');
        return;
      }

      const properties = [
        { property: 'modelId', value: modelId },
        { property: 'displayName', value: displayName },
        { property: 'aiPersonId', value: aiPersonId.toString() },
        { property: 'createdBy', value: userId.toString() },
        { property: 'trustLevel', value: 'high' },
        { property: 'type', value: 'ai-contact-creation' }
      ];

      // Create all Assembly objects in parallel
      await Promise.all(
        properties.map(({ property, value }) => {
          const assembly = {
            $type$: 'CubeAssembly' as const,
            aiAssistantCall: planIdHash.toString(),
            property: property,
            supply: value,
            demand: undefined,
            instanceVersion,
            children: undefined,
            plan: planIdHash.toString(),
            owner: userId.toString(),
            created: now,
            modified: now
          };
          return this.deps.storeVersionedObject(assembly);
        })
      );

      console.log(`[JournalPlan] Recorded AI contact creation with ${properties.length} properties`);
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
   * Aggregates:
   * 1. Conversations (from ChatPlan)
   * 2. Memory entries (from SubjectsPlan)
   * 3. LLM calls (from JournalPlan's own storage - TODO)
   * 4. AI contacts created (from JournalPlan's own storage - TODO)
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

    // 3. TODO: Aggregate LLM call entries (from AssemblyPlan/Assembly objects)
    // This requires implementing ONE.core reverse map queries
    // Query all AssemblyPlans where $type$ = 'AssemblyPlan' AND name starts with 'LLM Call:'
    // For each plan, query its Assembly objects and reconstruct the LLMCallEntry

    // 4. TODO: Aggregate AI contact entries (from AssemblyPlan/Assembly objects)
    // Query all AssemblyPlans where $type$ = 'AssemblyPlan' AND name starts with 'AI Contact Created:'
    // For each plan, query its Assembly objects and reconstruct the AIContactEntry

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
