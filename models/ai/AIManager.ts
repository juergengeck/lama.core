/**
 * AIManager
 *
 * Manages AI Person identities with LLM as interchangeable substrate.
 *
 * Key concepts:
 * - AI Person: Persistent assistant identity with Person/Profile/Someone
 * - LLM: Standalone configuration (modelId, server, provider) - no Person
 * - AI object points to LLM via llmId (or uses app default)
 *
 * Benefits:
 * - AI is persistent identity that accumulates memories
 * - LLMs are interchangeable substrates
 * - Switch models without losing AI identity or memories
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import { ensureIdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('AIManager');
import type { Person, Instance, Keys } from '@refinio/one.core/lib/recipes.js';
import type { Profile } from '@refinio/one.models/lib/recipes/Leute/Profile.js';
import type { KeyPair } from '@refinio/one.core/lib/crypto/encryption.js';
import type { SignKeyPair } from '@refinio/one.core/lib/crypto/sign.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type { StoryFactory, Plan } from '@refinio/api/plan-system';
import type { LLMCapabilities } from './types.js';

// Storage dependencies (injected to avoid module duplication)
export interface AIManagerDeps {
  storeVersionedObject: (obj: any) => Promise<any>;
  storeUnversionedObject: (obj: any) => Promise<SHA256Hash<any> | {hash: SHA256Hash<any>, obj: any, status: string}>;
  getIdObject: (idHash: SHA256IdHash<any>) => Promise<any>;
  getObject: (hash: SHA256Hash<any>) => Promise<any>;
  getObjectByIdHash: (idHash: SHA256IdHash<any>) => Promise<{obj: any, hash: SHA256Hash<any>}>;
  createDefaultKeys?: (owner: SHA256IdHash<Person | Instance>, encryptionKeyPair?: KeyPair, signKeyPair?: SignKeyPair) => Promise<SHA256Hash<Keys>>;
  hasDefaultKeys?: (owner: SHA256IdHash<Person | Instance>) => Promise<boolean>;
  channelManager: any;  // Required: for querying LLM objects
  trustPlan?: any;
  /** Instance idHash from ONE.core - used for Story tracking */
  instanceIdHash?: SHA256IdHash<Instance>;
}

// Response type for AI creation (includes Assembly tracking)
export interface CreateAIResponse {
  success: boolean;
  personIdHash: SHA256IdHash<Person>;
  profileIdHash: SHA256IdHash<Profile>;
  someoneIdHash: SHA256IdHash<any>;
  storyIdHash?: string;
  assemblyIdHash?: string;
}

// AIList - tracks all AI objects for easy enumeration
export type AIList = {
  $type$: 'AIList';
  id: string;  // Fixed: 'ai-list'
  aiIds: Set<SHA256IdHash<AI>>;
  modified: number;
};

// AI object - persistent identity with optional LLM override
export type AI = {
  $type$: 'AI';
  aiId: string;
  displayName: string;
  personId: SHA256IdHash<Person>;       // AI Person (with Profile, Someone)
  llmId?: SHA256IdHash<LLM>;            // Optional LLM override; undefined = use app default
  modelId: string;                       // Convenience/display (current model)
  owner: SHA256IdHash<Person> | SHA256IdHash<Instance>;
  created: number;
  modified: number;
  active: boolean;
  deleted: boolean;
  // AI behavior flags (global defaults, can be overridden per-topic)
  analyse?: boolean;                     // Run analytics extraction (default: true)
  respond?: boolean;                     // Generate AI responses (default: true)
  mute?: boolean;                        // Suppress notifications (default: false)
  ignore?: boolean;                      // Skip entirely (default: false)
  // AI-specific character data (not applicable to humans)
  /** Context from AI creation (device, locale, time, app) - immutable */
  creationContext?: {
    device: string;
    locale: string;
    time: number;
    app: string;
  };
  /** User-defined system prompt addition */
  systemPromptAddition?: string;
};

// LLM object - standalone configuration (no Person/Profile/Someone)
export type LLM = {
  $type$: 'LLM';
  modelId: string;                       // Primary identifier (e.g., "claude-sonnet-4-5")
  name: string;                          // Display name
  server: string;                        // Server URL
  provider: string;                      // Provider name (e.g., "anthropic", "ollama")
  filename: string;                      // Model filename for local models
  modelType: 'local' | 'remote';
  active: boolean;
  deleted: boolean;
  created: number;
  modified: number;
  createdAt: string;
  lastUsed: string;
  /** Model capabilities for prompt adaptation */
  capabilities?: LLMCapabilities;
};

/**
 * AI creation context - captured at AI creation time
 * Used for the "Creation Certificate" display in the UI
 */
export interface AICreationContext {
  device: string;
  locale: string;
  time: number;
  app: string;
}

export class AIManager {
  // Plan constants for Assembly tracking
  static readonly PLAN_ID = 'AIPlan';
  static readonly PLAN_NAME = 'AI Contact Plan';
  static readonly PLAN_DESCRIPTION = 'Manages AI Person/Profile/Someone with Story/Assembly tracking';
  static readonly PLAN_DOMAIN = 'ai-contacts';

  // Lookup: AI Person ID → AI object
  private aiByPerson: Map<SHA256IdHash<Person>, AI>;

  // Lookup: modelId → LLM object
  private llmByModelId: Map<string, LLM>;

  /** Cached Plan idHash - populated when setStoryFactory is called */
  private planIdHash: SHA256IdHash<Plan> | null = null;

  constructor(
    private leuteModel: LeuteModel,
    private deps: AIManagerDeps
  ) {
    this.aiByPerson = new Map();
    this.llmByModelId = new Map();
  }

  // ==================== AIList Management ====================

  private static readonly AI_LIST_ID = 'ai-list';

  /**
   * Get or create the AIList singleton
   */
  private async getOrCreateAIList(): Promise<AIList> {
    try {
      // Calculate proper idHash from ID properties
      // CRITICAL: getObjectByIdHash expects SHA256IdHash, not a string literal
      const { calculateIdHashOfObj } = await import('@refinio/one.core/lib/util/object.js');
      const aiListIdHash = await calculateIdHashOfObj({ $type$: 'AIList', id: AIManager.AI_LIST_ID } as any);

      // Try to get existing AIList
      const result = await this.deps.getObjectByIdHash(aiListIdHash);
      if (result?.obj && result.obj.$type$ === 'AIList') {
        console.log(`[AIManager] Found existing AIList with ${result.obj.aiIds?.size || 0} AIs`);
        return result.obj as AIList;
      }
    } catch (error) {
      // AIList doesn't exist yet, create it
      console.log('[AIManager] AIList not found, creating new one');
    }

    // Create new AIList
    const aiList: AIList = {
      $type$: 'AIList',
      id: AIManager.AI_LIST_ID,
      aiIds: new Set(),
      modified: Date.now()
    };

    await this.deps.storeVersionedObject(aiList);
    console.log('[AIManager] Created new AIList');
    return aiList;
  }

  /**
   * Add an AI to the AIList
   */
  private async addToAIList(aiIdHash: SHA256IdHash<AI>): Promise<void> {
    const aiList = await this.getOrCreateAIList();
    aiList.aiIds.add(aiIdHash);
    aiList.modified = Date.now();
    await this.deps.storeVersionedObject(aiList);
    console.log(`[AIManager] Added AI ${aiIdHash.toString().substring(0, 8)}... to AIList (total: ${aiList.aiIds.size})`);
  }

  /**
   * Remove an AI from the AIList
   */
  private async removeFromAIList(aiIdHash: SHA256IdHash<AI>): Promise<void> {
    const aiList = await this.getOrCreateAIList();
    aiList.aiIds.delete(aiIdHash);
    aiList.modified = Date.now();
    await this.deps.storeVersionedObject(aiList);
    console.log(`[AIManager] Removed AI ${aiIdHash.toString().substring(0, 8)}... from AIList`);
  }

  // ==================== Plan Registration ====================

  /**
   * Register the Plan ONE object with StoryFactory.
   * Caches the Plan's real SHA256IdHash.
   */
  async setStoryFactory(factory: StoryFactory): Promise<void> {
    // Register the Plan ONE object and get its real hash
    this.planIdHash = await factory.registerPlan({
      id: AIManager.PLAN_ID,
      name: AIManager.PLAN_NAME,
      description: AIManager.PLAN_DESCRIPTION,
      domain: AIManager.PLAN_DOMAIN,
      demandPatterns: [
        { keywords: ['ai', 'assistant', 'contact', 'creation'] },
        { keywords: ['llm', 'model', 'chat', 'assistant'] }
      ],
      supplyPatterns: [
        { keywords: ['ai', 'person', 'profile', 'someone'] },
        { keywords: ['assistant', 'contact', 'identity'] }
      ]
    });

    MessageBus.send('debug', `Registered Plan with hash: ${this.planIdHash.substring(0, 8)}...`);
  }

  /**
   * Get the Plan's real SHA256IdHash (must be initialized first)
   */
  getPlanIdHash(): SHA256IdHash<Plan> {
    if (!this.planIdHash) {
      throw new Error('[AIManager] Plan not registered - call setStoryFactory first');
    }
    return this.planIdHash;
  }

  /**
   * Create an AI Person with Person/Profile/Someone
   * Creates a persistent identity that can use different LLMs
   *
   * @param aiId - Unique identifier for the AI (e.g., "claude", "research-assistant")
   * @param name - Display name (e.g., "Claude", "Research Assistant")
   * @param llmId - Optional LLM ID hash to use; undefined = use app default
   * @param modelId - Optional explicit model ID (e.g., "granite:3b"); if not provided, derived from aiId
   * @param creationContext - Optional creation context (device, locale, time, app)
   * @param systemPromptAddition - Optional user-defined system prompt addition
   * @returns CreateAIResponse with personIdHash, profileIdHash, someoneIdHash
   */
  async createAI(
    aiId: string,
    name: string,
    llmId?: SHA256IdHash<LLM>,
    modelId?: string,
    creationContext?: AICreationContext,
    systemPromptAddition?: string
  ): Promise<CreateAIResponse> {
    MessageBus.send('debug', `Creating AI Person: ${name} (${aiId})`);

    // Check if already exists by aiId
    for (const [personId, ai] of this.aiByPerson.entries()) {
      if (ai.aiId === aiId) {
        MessageBus.send('debug', `AI ${aiId} already exists, returning cached`);
        // Get profile ID
        const profileIdHash = await this._getMainProfileForPerson(personId);
        const someone = await this.leuteModel.getSomeone(personId);
        return {
          success: true,
          personIdHash: personId,
          profileIdHash,
          someoneIdHash: someone?.idHash || ('' as any)
        };
      }
    }

    try {
      // 1. Create Person object
      const email = `${aiId.replace(/[^a-zA-Z0-9]/g, '_')}@ai.local`;
      const personData = {
        $type$: 'Person' as const,
        email,
        name,
      };

      const personResult: any = await this.deps.storeVersionedObject(personData);
      const personIdHash = ensureIdHash(typeof personResult === 'object' && personResult?.idHash ? personResult.idHash : personResult);

      // 2. Create PersonName
      const personNameResult = await this.deps.storeUnversionedObject({
        $type$: 'PersonName' as const,
        name
      });
      const personNameHash = typeof personNameResult === 'object' && 'hash' in personNameResult
        ? personNameResult.hash
        : personNameResult;

      // 3. Create standard Profile (NO AI-specific fields)
      const myId = await this.leuteModel.myMainIdentity();
      const profileObj: any = {
        $type$: 'Profile' as const,
        profileId: `ai:${aiId}`,
        personId: personIdHash,
        owner: myId,
        nickname: name,
        personDescription: [personNameHash],
        communicationEndpoint: []
      };

      const profileResult: any = await this.deps.storeVersionedObject(profileObj);
      const profileIdHash = ensureIdHash(typeof profileResult === 'object' && profileResult?.idHash ? profileResult.idHash : profileResult);
      MessageBus.send('debug', `Created standard Profile: ${profileIdHash.toString().substring(0, 8)}...`);

      // 4. Create AI metadata object
      const now = Date.now();
      // modelId is required - AI identity is independent of model per design
      // aiId is derived from AI creation (email prefix), not from modelId
      if (!modelId) {
        throw new Error('[AIManager] modelId is required - AI identity and model must be specified separately');
      }
      const aiObject: AI = {
        $type$: 'AI',
        aiId,
        displayName: name,
        personId: personIdHash,
        llmId,  // Optional - undefined means use app default
        modelId,
        owner: myId,
        created: now,
        modified: now,
        active: true,
        deleted: false,
        ...(creationContext && { creationContext }),
        ...(systemPromptAddition && { systemPromptAddition })
      };

      const aiResult: any = await this.deps.storeVersionedObject(aiObject);
      const aiIdHash = ensureIdHash(typeof aiResult === 'object' && aiResult?.idHash ? aiResult.idHash : aiResult);

      // Add to AIList for easy enumeration on reload
      await this.addToAIList(aiIdHash as SHA256IdHash<AI>);

      // Store in lookup table
      this.aiByPerson.set(personIdHash, aiObject);

      // 5. Create Someone
      const someoneObj: any = {
        $type$: 'Someone' as const,
        someoneId: `ai:${aiId}`,
        mainProfile: profileIdHash,
        identities: new Map([[personIdHash, new Set([profileIdHash])]])
      };

      const someoneResult: any = await this.deps.storeVersionedObject(someoneObj);
      const someoneIdHash = ensureIdHash(typeof someoneResult === 'object' && someoneResult?.idHash ? someoneResult.idHash : someoneResult);

      // 6. Register with LeuteModel
      await this.leuteModel.addSomeoneElse(someoneIdHash);

      // 7. Generate keys for the AI Person
      if (this.deps.createDefaultKeys && this.deps.hasDefaultKeys) {
        try {
          const hasKeys = await this.deps.hasDefaultKeys(personIdHash);
          if (!hasKeys) {
            await this.deps.createDefaultKeys(personIdHash);
          }
        } catch (error) {
          MessageBus.send('alert', 'Failed to generate keys for AI Person:', error);
        }
      } else {
        MessageBus.send('alert', 'createDefaultKeys not available - AI Person will not have keys');
      }

      // 8. Assign trust level (fire and forget - not critical for immediate use)
      if (this.deps.trustPlan) {
        this.deps.trustPlan.setTrustLevel({
          personId: personIdHash,
          trustLevel: 'high',
          establishedBy: myId,
          reason: `AI assistant: ${name}`
        }).catch((error: any) => {
          MessageBus.send('alert', 'Failed to assign trust level:', error);
        });
      }

      MessageBus.send('debug', `AI Person created: ${name}`);
      return {
        success: true,
        personIdHash,
        profileIdHash,
        someoneIdHash
      };
    } catch (error) {
      MessageBus.send('error', 'Failed to create AI Person:', error);
      throw error;
    }
  }

  /**
   * Create an LLM configuration object
   * LLM is standalone config - NO Person/Profile/Someone
   *
   * @param modelId - Model identifier (e.g., "claude-sonnet-4-5", "gpt-4")
   * @param name - Display name (e.g., "Claude Sonnet 4.5")
   * @param provider - Provider name (e.g., "anthropic", "openai", "ollama")
   * @param server - Optional server URL (defaults to localhost:11434 for ollama)
   * @returns SHA256IdHash<LLM> of the created LLM config
   */
  async createLLM(
    modelId: string,
    name: string,
    provider: string,
    server?: string
  ): Promise<SHA256IdHash<LLM>> {
    MessageBus.send('debug', `Creating LLM config: ${name} (${modelId})`);

    // Check cache first
    const cached = this.llmByModelId.get(modelId);
    if (cached) {
      MessageBus.send('debug', `LLM ${modelId} already cached`);
      // Calculate and return ID hash
      const { calculateIdHashOfObj } = await import('@refinio/one.core/lib/util/object.js');
      return await calculateIdHashOfObj({ $type$: 'LLM', name, server: server || '' } as any);
    }

    try {
      // Create LLM metadata object only - NO Person/Profile/Someone
      const now = Date.now();
      const llmObject: LLM = {
        $type$: 'LLM',
        modelId,
        name,
        server: server || (provider === 'ollama' ? 'http://localhost:11434' : ''),
        filename: modelId,
        modelType: provider === 'ollama' ? 'local' : 'remote',
        provider,
        active: true,
        deleted: false,
        created: now,
        modified: now,
        createdAt: new Date(now).toISOString(),
        lastUsed: new Date(now).toISOString()
      };

      const llmResult: any = await this.deps.storeVersionedObject(llmObject);
      const llmIdHash = ensureIdHash(typeof llmResult === 'object' && llmResult?.idHash ? llmResult.idHash : llmResult);

      // Store in lookup table
      this.llmByModelId.set(modelId, llmObject);

      MessageBus.send('debug', `LLM config created: ${name}`);
      return llmIdHash;
    } catch (error) {
      MessageBus.send('error', 'Failed to create LLM config:', error);
      throw error;
    }
  }

  /**
   * Set which LLM an AI uses
   * Updates the AI object's llmId field
   *
   * @param aiPersonId - AI Person ID
   * @param llmId - LLM ID hash (or undefined to use app default)
   */
  async setAIModel(aiPersonId: SHA256IdHash<Person>, llmId?: SHA256IdHash<LLM>): Promise<void> {
    MessageBus.send('debug', `Setting AI model for ${aiPersonId.toString().substring(0, 8)}...`);

    const aiObject = this.aiByPerson.get(aiPersonId);
    if (!aiObject) {
      throw new Error(`[AIManager] AI not found for Person ${aiPersonId.toString().substring(0, 8)}...`);
    }

    // Get modelId from LLM if provided
    let modelId = aiObject.modelId;
    if (llmId) {
      try {
        const llmResult = await this.deps.getObjectByIdHash(llmId);
        const llm = llmResult.obj as LLM;
        modelId = llm.modelId;
      } catch (error) {
        MessageBus.send('alert', 'Failed to get LLM for modelId update:', error);
      }
    }

    // Update AI object
    const updatedAI: AI = {
      ...aiObject,
      llmId,
      modelId,
      modified: Date.now()
    };

    await this.deps.storeVersionedObject(updatedAI);
    this.aiByPerson.set(aiPersonId, updatedAI);

    MessageBus.send('debug', `AI model set to ${modelId}`);
  }

  /**
   * Update AI's modelId directly (without LLM object)
   * Simpler approach - just updates the modelId field on the AI object
   *
   * @param aiPersonId - AI Person ID
   * @param newModelId - New model ID (e.g., "claude-sonnet-4", "gpt-4")
   * @returns Store result with hash of the new AI version
   */
  async updateModelId(aiPersonId: SHA256IdHash<Person>, newModelId: string): Promise<{ hash: SHA256Hash<AI> }> {
    MessageBus.send('debug', `Updating AI modelId for ${aiPersonId.toString().substring(0, 8)}... to ${newModelId}`);

    const aiObject = this.aiByPerson.get(aiPersonId);
    if (!aiObject) {
      throw new Error(`[AIManager] AI not found for Person ${aiPersonId.toString().substring(0, 8)}...`);
    }

    // Update AI object with new modelId (leave llmId unchanged)
    const updatedAI: AI = {
      ...aiObject,
      modelId: newModelId,
      modified: Date.now()
    };

    const result = await this.deps.storeVersionedObject(updatedAI);
    this.aiByPerson.set(aiPersonId, updatedAI);

    MessageBus.send('debug', `AI modelId updated to ${newModelId}`);
    return { hash: result.hash as SHA256Hash<AI> };
  }

  /**
   * Update AI's systemPromptAddition
   * Creates a new AI version with the updated system prompt
   *
   * @param aiPersonId - AI Person ID
   * @param systemPromptAddition - New system prompt addition (or undefined to remove)
   * @returns Store result with hash of the new AI version
   */
  async updateSystemPromptAddition(
    aiPersonId: SHA256IdHash<Person>,
    systemPromptAddition: string | undefined
  ): Promise<{ hash: SHA256Hash<AI> }> {
    MessageBus.send('debug', `Updating AI systemPromptAddition for ${aiPersonId.toString().substring(0, 8)}...`);

    const aiObject = this.aiByPerson.get(aiPersonId);
    if (!aiObject) {
      throw new Error(`[AIManager] AI not found for Person ${aiPersonId.toString().substring(0, 8)}...`);
    }

    // Update AI object with new systemPromptAddition
    const updatedAI: AI = {
      ...aiObject,
      systemPromptAddition,
      modified: Date.now()
    };

    const result = await this.deps.storeVersionedObject(updatedAI);
    this.aiByPerson.set(aiPersonId, updatedAI);

    MessageBus.send('debug', `AI systemPromptAddition updated`);
    return { hash: result.hash as SHA256Hash<AI> };
  }

  /**
   * Get AI object by Person ID
   */
  getAI(personId: SHA256IdHash<Person>): AI | null {
    return this.aiByPerson.get(personId) || null;
  }

  /**
   * Get AI object by aiId
   */
  getAIByAiId(aiId: string): AI | null {
    for (const ai of this.aiByPerson.values()) {
      if (ai.aiId === aiId) {
        return ai;
      }
    }
    return null;
  }

  /**
   * Get LLM object by modelId
   */
  getLLM(modelId: string): LLM | null {
    return this.llmByModelId.get(modelId) || null;
  }

  /**
   * Get LLM object by LLM ID hash
   */
  async getLLMById(llmId: SHA256IdHash<LLM>): Promise<LLM | null> {
    try {
      const result = await this.deps.getObjectByIdHash(llmId);
      return result.obj as LLM;
    } catch (error) {
      MessageBus.send('alert', 'Failed to get LLM by ID:', error);
      return null;
    }
  }

  /**
   * Get the LLM ID for an AI Person
   * Returns the explicit llmId or null if using app default
   */
  getLLMIdForAI(aiPersonId: SHA256IdHash<Person>): SHA256IdHash<LLM> | null {
    const ai = this.aiByPerson.get(aiPersonId);
    return ai?.llmId || null;
  }

  /**
   * Alias for getLLMIdForAI - used by AIPromptBuilder
   */
  async getLLMId(aiPersonId: SHA256IdHash<Person>): Promise<string | null> {
    // Return modelId (the string identifier) rather than llmId (the hash)
    // This is what AIPromptBuilder needs to resolve the model
    const ai = this.aiByPerson.get(aiPersonId);
    return ai?.modelId || null;
  }

  /**
   * Get modelId for an AI Person
   * This is the modelId stored on the AI object (convenience field)
   */
  getModelIdForAI(aiPersonId: SHA256IdHash<Person>): string | null {
    const ai = this.aiByPerson.get(aiPersonId);
    return ai?.modelId || null;
  }

  /**
   * Check if a Person is an AI
   */
  isAI(personId: SHA256IdHash<Person>): boolean {
    return this.aiByPerson.has(personId);
  }

  /**
   * Get AI ID from AI Person ID
   */
  getAIId(personId: SHA256IdHash<Person>): string | null {
    const ai = this.aiByPerson.get(personId);
    return ai?.aiId || null;
  }

  /**
   * Get Person ID by entity ID (prefixed string like "ai:dreizehn" or "llm:claude-sonnet")
   * This is the inverse of what getAIByAiId does internally
   *
   * Per design: aiId is derived from birth experience email prefix (e.g., "dreizehn" from "dreizehn@device.local")
   * NOT from modelId patterns like "started-as-X" or "ai-X"
   *
   * @param entityId - Entity ID with prefix (e.g., "ai:dreizehn", "llm:claude-sonnet")
   * @returns Person ID hash or null if not found
   */
  getPersonId(entityId: string): SHA256IdHash<Person> | null {
    // Parse prefix and id
    if (entityId.startsWith('ai:')) {
      const aiId = entityId.substring('ai:'.length);
      const ai = this.getAIByAiId(aiId);
      return ai?.personId || null;
    }

    // LLMs don't have Person IDs in the new architecture
    // They're just configuration objects
    if (entityId.startsWith('llm:')) {
      MessageBus.send('debug', `getPersonId called for LLM ${entityId} - LLMs don't have Person IDs`);
      return null;
    }

    // Unknown prefix - try direct aiId lookup
    const ai = this.getAIByAiId(entityId);
    return ai?.personId || null;
  }

  /**
   * Get all AI objects
   */
  getAllAIs(): AI[] {
    return Array.from(this.aiByPerson.values());
  }

  /**
   * Get all LLM objects
   */
  getAllLLMs(): LLM[] {
    return Array.from(this.llmByModelId.values());
  }

  /**
   * Rename an AI Person by creating a new identity while preserving the old one
   * Creates a new Person/Profile and adds it to the Someone, keeping the old Person as past identity
   *
   * @param aiId - Current AI ID (e.g., "dreizehn" - derived from birth experience email prefix)
   * @param newName - New display name (e.g., "Research Assistant")
   * @returns Person ID of the new identity
   */
  async renameAI(aiId: string, newName: string): Promise<SHA256IdHash<Person>> {
    MessageBus.send('debug', `Renaming AI: ${aiId} → ${newName}`);

    const aiObject = this.getAIByAiId(aiId);
    if (!aiObject) {
      throw new Error(`[AIManager] AI not found: ${aiId}`);
    }

    const currentPersonId = aiObject.personId;

    try {
      // 1. Get the Someone for this AI
      const someone = await this.leuteModel.getSomeone(currentPersonId);
      if (!someone) {
        throw new Error(`[AIManager] No Someone found for AI ${aiId}`);
      }

      // 2. Create new Person with new name
      const newPersonData = {
        $type$: 'Person' as const,
        email: `${newName.toLowerCase().replace(/[^a-z0-9]/g, '_')}@ai.local`,
        name: newName,
      };

      const newPersonResult: any = await this.deps.storeVersionedObject(newPersonData);
      const newPersonId = ensureIdHash(typeof newPersonResult === 'object' && newPersonResult?.idHash ? newPersonResult.idHash : newPersonResult);

      // 3. Create PersonName for new Person
      const personNameResult = await this.deps.storeUnversionedObject({
        $type$: 'PersonName' as const,
        name: newName
      });
      const personNameHash = typeof personNameResult === 'object' && 'hash' in personNameResult
        ? personNameResult.hash
        : personNameResult;

      // 4. Create new Profile
      const myId = await this.leuteModel.myMainIdentity();
      const newProfileId = `ai:${newName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const newProfileObj: any = {
        $type$: 'Profile' as const,
        profileId: newProfileId,
        personId: newPersonId,
        owner: myId,
        nickname: newName,
        personDescription: [personNameHash],
        communicationEndpoint: []
      };

      const newProfileResult: any = await this.deps.storeVersionedObject(newProfileObj);
      const newProfileIdHash = ensureIdHash(typeof newProfileResult === 'object' && newProfileResult?.idHash ? newProfileResult.idHash : newProfileResult);

      // 5. Add new Person to Someone's identities and set as mainProfile
      await someone.addProfile(newProfileIdHash);
      await someone.setMainProfile(newProfileIdHash);

      // 6. Generate keys for the new Person identity
      if (this.deps.createDefaultKeys && this.deps.hasDefaultKeys) {
        try {
          const hasKeys = await this.deps.hasDefaultKeys(newPersonId);
          if (!hasKeys) {
            await this.deps.createDefaultKeys(newPersonId);
          }
        } catch (error) {
          MessageBus.send('alert', 'Failed to generate keys for renamed Person:', error);
        }
      }

      // 7. Update AI object with new Person ID
      const updatedAI: AI = {
        ...aiObject,
        personId: newPersonId,
        displayName: newName,
        modified: Date.now()
      };
      await this.deps.storeVersionedObject(updatedAI);

      // 8. Update caches
      this.aiByPerson.delete(currentPersonId);
      this.aiByPerson.set(newPersonId, updatedAI);

      MessageBus.send('debug', `AI renamed: ${aiId} → ${newName}`);
      return newPersonId;
    } catch (error) {
      MessageBus.send('error', 'Failed to rename AI:', error);
      throw error;
    }
  }

  /**
   * Get all past identities for an AI Person
   */
  async getPastIdentities(aiId: string): Promise<Array<{personId: SHA256IdHash<Person>, name: string}>> {
    const aiObject = this.getAIByAiId(aiId);
    if (!aiObject) {
      return [];
    }

    try {
      const someone = await this.leuteModel.getSomeone(aiObject.personId);
      if (!someone) {
        return [];
      }

      const mainIdentity = await someone.mainIdentity();
      const allProfiles = await someone.profiles();

      const pastIdentities: Array<{personId: SHA256IdHash<Person>, name: string}> = [];

      for (const profileInfo of allProfiles) {
        const profileResult = await this.deps.getObjectByIdHash(profileInfo.idHash);
        const profile = profileResult.obj as any;

        // Skip if this is the main identity
        if (profile.personId === mainIdentity) {
          continue;
        }

        // Get Person to extract name
        const personResult = await this.deps.getObjectByIdHash(profile.personId);
        const person = personResult.obj as any;

        pastIdentities.push({
          personId: profile.personId,
          name: person.name || profile.nickname || 'Unknown'
        });
      }

      return pastIdentities;
    } catch (error) {
      MessageBus.send('error', 'Failed to get past identities:', error);
      return [];
    }
  }

  /**
   * Get main Profile ID for a Person
   * @private
   */
  private async _getMainProfileForPerson(personId: SHA256IdHash<Person>): Promise<SHA256IdHash<Profile>> {
    // Check "me" first (current user)
    try {
      const me = await this.leuteModel.me();
      const myMainIdentity = await me.mainIdentity();
      if (myMainIdentity === personId) {
        const myMainProfile = await me.mainProfile();
        return myMainProfile.idHash;
      }
    } catch {
      // Not me, continue to others
    }

    // Find Someone in others
    const others = await this.leuteModel.others();
    for (const someone of others) {
      try {
        const mainIdentity = await someone.mainIdentity();
        if (mainIdentity === personId) {
          const mainProfile = await someone.mainProfile();
          return mainProfile.idHash;
        }
      } catch {
        // Continue searching
      }
    }

    throw new Error(`[AIManager] No Profile found for Person ${personId.toString().substring(0, 8)}...`);
  }

  /**
   * Load AI object from storage by aiId
   * @private
   */
  private async _loadAIObjectByAiId(aiId: string): Promise<AI | null> {
    try {
      const { calculateIdHashOfObj } = await import('@refinio/one.core/lib/util/object.js');

      // Calculate ID hash from just the ID properties
      const aiIdHash = await calculateIdHashOfObj({ $type$: 'AI', aiId } as any);

      // Fetch by ID hash
      const aiResult = await this.deps.getObjectByIdHash(aiIdHash);
      const aiObject = aiResult.obj as AI;

      // Store in lookup table
      this.aiByPerson.set(aiObject.personId, aiObject);

      return aiObject;
    } catch (error) {
      MessageBus.send('alert', `Failed to load AI object for aiId ${aiId}:`, error);
      return null;
    }
  }

  /**
   * Load LLM object from storage by modelId
   * @private
   */
  private async _loadLLMObjectByModelId(modelId: string): Promise<LLM | null> {
    try {
      // Query all LLM objects from storage
      const iterator = this.deps.channelManager.objectIteratorWithType('LLM', {
        channelId: 'lama',
      });

      for await (const llmObj of iterator) {
        if (llmObj && llmObj.data) {
          const llm = llmObj.data as LLM;
          if (llm.modelId === modelId) {
            // Store in lookup table
            this.llmByModelId.set(modelId, llm);
            return llm;
          }
        }
      }

      return null;
    } catch (error) {
      MessageBus.send('alert', `Failed to load LLM object for modelId ${modelId}:`, error);
      return null;
    }
  }

  /**
   * Load existing AI and LLM objects from storage
   *
   * AI objects are stored in ONE.core and linked to Person/Profile/Someone.
   * The aiByPerson map is populated from AI objects via the AIList.
   */
  async loadExisting(): Promise<{aiCount: number, llmCount: number}> {
    console.log('[AIManager.loadExisting] Starting to load existing AI and LLM objects...');
    MessageBus.send('debug', 'Loading existing AI and LLM objects...');

    let aiCount = 0;
    let llmCount = 0;

    try {
      // Load AI objects from AIList - simple enumeration
      try {
        const aiList = await this.getOrCreateAIList();
        console.log(`[AIManager.loadExisting] Found AIList with ${aiList.aiIds.size} AI IDs`);

        for (const aiIdHash of aiList.aiIds) {
          try {
            const result = await this.deps.getObjectByIdHash(aiIdHash);
            if (result?.obj && result.obj.$type$ === 'AI') {
              const ai = result.obj as AI;
              if (ai.personId && ai.active !== false) {
                this.aiByPerson.set(ai.personId, ai);
                aiCount++;
                console.log(`[AIManager.loadExisting] ✅ Loaded AI: ${ai.aiId} (${ai.displayName})`);
                MessageBus.send('debug', `Loaded AI: ${ai.aiId} (${ai.displayName})`);
              }
            }
          } catch (error) {
            console.warn(`[AIManager.loadExisting] Failed to load AI ${aiIdHash.substring(0, 8)}:`, error);
            // Remove stale reference from AIList
            await this.removeFromAIList(aiIdHash as SHA256IdHash<AI>);
          }
        }
      } catch (error) {
        console.error('[AIManager.loadExisting] ❌ Failed to load AI objects:', error);
        MessageBus.send('alert', 'Failed to load AI objects:', error);
      }

      // Load LLM objects from storage (these ARE channel objects in lama channel)
      try {
        const iterator = this.deps.channelManager.objectIteratorWithType('LLM', {
          channelId: 'lama',
        });

        for await (const llmObj of iterator) {
          if (llmObj && llmObj.data) {
            const llm = llmObj.data as LLM;
            this.llmByModelId.set(llm.modelId, llm);
            llmCount++;
            MessageBus.send('debug', `Loaded LLM: ${llm.modelId}`);
          }
        }
      } catch (error) {
        MessageBus.send('alert', 'Failed to load LLM objects:', error);
      }

      MessageBus.send('debug', `Loaded ${aiCount} AI Persons, ${llmCount} LLM configs`);
      return { aiCount, llmCount };
    } catch (error) {
      MessageBus.send('error', 'Failed to load existing entities:', error);
      throw error;
    }
  }
}
