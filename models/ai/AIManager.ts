/**
 * AIManager
 *
 * Manages AI and LLM Person identities with Profile-based delegation.
 * Replaces AIContactManager with a Person-centric architecture.
 *
 * Key concepts:
 * - AI Person: Assistant identity (e.g., "Claude", "Research Assistant")
 * - LLM Person: Model identity (e.g., "claude-sonnet-4-5", "gpt-4")
 * - Delegation: AI Person → LLM Person (or AI → AI → LLM chains)
 * - Profile.delegatesTo: Stores the delegation relationship
 *
 * Benefits:
 * - Switch models without losing AI identity
 * - Support AI chaining (AI delegates to another AI)
 * - Clean separation of identity vs configuration
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import { ensureIdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, Instance, Keys } from '@refinio/one.core/lib/recipes.js';
import type { Profile } from '@refinio/one.models/lib/recipes/Leute/Profile.js';
import type { KeyPair } from '@refinio/one.core/lib/crypto/encryption.js';
import type { SignKeyPair } from '@refinio/one.core/lib/crypto/sign.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type { StoryFactory, ExecutionMetadata, ExecutionResult, Plan } from '@refinio/api/plan-system';

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
  aiObjectManager?: any;  // Optional: for creating AI storage objects
  llmObjectManager?: any;  // Optional: for creating LLM storage objects
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

// Import AI and LLM types
type AI = {
  $type$: 'AI';
  aiId: string;
  displayName: string;
  personId: SHA256IdHash<Person>;
  llmProfileId: SHA256IdHash<Profile>;  // Delegates to LLM Profile, not Person
  modelId: string;
  owner: SHA256IdHash<Person> | SHA256IdHash<Instance>;
  created: number;
  modified: number;
  active: boolean;
  deleted: boolean;
};

type LLM = {
  $type$: 'LLM';
  name: string;
  server: string;  // Mandatory (isId: true in LLMRecipe)
  filename: string;
  modelType: 'local' | 'remote';
  active: boolean;
  deleted: boolean;
  created: number;
  modified: number;
  createdAt: string;
  lastUsed: string;
  modelId?: string;
  personId?: SHA256IdHash<Person>;
  provider?: string;
};

export class AIManager {
  // Plan constants for Assembly tracking
  static readonly PLAN_ID = 'AIPlan';
  static readonly PLAN_NAME = 'AI Contact Plan';
  static readonly PLAN_DESCRIPTION = 'Manages AI Person/Profile/Someone with Story/Assembly tracking';
  static readonly PLAN_DOMAIN = 'ai-contacts';

  // Lookup tables: Person ID → AI/LLM metadata objects
  private aiByPerson: Map<SHA256IdHash<Person>, AI>;
  private llmByPerson: Map<SHA256IdHash<Person>, LLM>;

  // Cache: AI/LLM ID → Person ID
  private entities: Map<string, SHA256IdHash<Person>>;

  // Reverse lookup: Person ID → entity ID
  private personToEntity: Map<SHA256IdHash<Person>, string>;

  // Profile ID cache: Person ID → Profile ID (for LLMs)
  private llmProfileIdByPerson: Map<SHA256IdHash<Person>, SHA256IdHash<Profile>>;

  // StoryFactory for Assembly tracking
  private storyFactory: StoryFactory | null = null;
  /** Cached Plan idHash - populated when storyFactory is set */
  private planIdHash: SHA256IdHash<Plan> | null = null;

  constructor(
    private leuteModel: LeuteModel,
    private deps: AIManagerDeps
  ) {
    this.aiByPerson = new Map();
    this.llmByPerson = new Map();
    this.entities = new Map();
    this.personToEntity = new Map();
    this.llmProfileIdByPerson = new Map();
  }

  /**
   * Set the StoryFactory and register the Plan ONE object.
   * This stores the Plan and caches its real SHA256IdHash.
   */
  async setStoryFactory(factory: StoryFactory): Promise<void> {
    this.storyFactory = factory;

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

    console.log(`[AIManager] Registered Plan with hash: ${this.planIdHash.substring(0, 8)}...`);
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
   * Create an AI Person that delegates to an LLM Profile (or another AI Profile)
   * Wraps creation with StoryFactory for Assembly tracking (journal visibility)
   *
   * @param aiId - Unique identifier for the AI (e.g., "claude", "research-assistant")
   * @param name - Display name (e.g., "Claude", "Research Assistant")
   * @param delegatesTo - Profile ID to delegate to (LLM Profile or another AI Profile)
   * @returns Person ID of the created AI
   */
  async createAI(
    aiId: string,
    name: string,
    delegatesTo: SHA256IdHash<Profile>
  ): Promise<SHA256IdHash<Person>> {
    console.log(`[AIManager] Creating AI Person: ${name} (${aiId})`);

    // Check cache first
    const cached = this.entities.get(`ai:${aiId}`);
    if (cached) {
      console.log(`[AIManager] AI Person already exists: ${aiId}`);
      // Update delegation if changed
      await this.setAIDelegation(aiId, delegatesTo);
      return cached;
    }

    // If no StoryFactory, fall back to direct creation (no Assembly)
    if (!this.storyFactory) {
      console.warn('[AIManager] No StoryFactory - creating without Assembly');
      const result = await this.createAIInternal(aiId, name, delegatesTo);
      return result.personIdHash;
    }

    const myId = await this.leuteModel.myMainIdentity();
    const modelId = aiId.startsWith('started-as-') ? aiId.substring('started-as-'.length) : aiId;

    const metadata: ExecutionMetadata = {
      title: `AI Contact Created: ${name}`,
      description: `Created AI assistant contact for model ${modelId}`,
      planId: this.getPlanIdHash(),
      planTypeName: AIManager.PLAN_ID,
      owner: myId as string,
      domain: AIManager.PLAN_DOMAIN,
      instanceVersion: `instance-${Date.now()}`,

      // ASSEMBLY: Demand (need AI assistant) + Supply (AI provides assistant)
      demand: {
        domain: AIManager.PLAN_DOMAIN,
        keywords: ['ai', 'assistant', 'contact', 'creation'],
        trustLevel: 'trusted'
      },
      supply: {
        domain: AIManager.PLAN_DOMAIN,
        keywords: ['ai', 'person', 'profile', 'someone', modelId],
        subjects: ['ai-contact', name],
        ownerId: myId as string
      },
      matchScore: 1.0
    };

    const result = await this.storyFactory.recordExecution(
      metadata,
      async () => {
        return await this.createAIInternal(aiId, name, delegatesTo);
      }
    );

    console.log(`[AIManager] ✅ Created AI Person with Assembly: ${result.assemblyId?.toString().substring(0, 8)}...`);
    return result.result!.personIdHash;
  }

  /**
   * Internal implementation of AI Person creation
   * @private
   */
  private async createAIInternal(
    aiId: string,
    name: string,
    delegatesTo: SHA256IdHash<Profile>
  ): Promise<CreateAIResponse> {
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
      console.log(`[AIManager] Created AI Person: ${personIdHash.toString().substring(0, 8)}...`);

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
      console.log(`[AIManager] Created standard Profile: ${profileIdHash.toString().substring(0, 8)}...`);

      // 3a. Create AI metadata object (SEPARATE from Person/Profile)
      const now = Date.now();
      const modelId = aiId.startsWith('started-as-') ? aiId.substring('started-as-'.length) : aiId;
      const aiObject: AI = {
        $type$: 'AI',
        aiId,
        displayName: name,
        personId: personIdHash,
        llmProfileId: delegatesTo,  // Delegates to LLM Profile
        modelId,
        owner: myId,
        created: now,
        modified: now,
        active: true,
        deleted: false
      };

      const aiResult: any = await this.deps.storeVersionedObject(aiObject);
      const aiIdHash = ensureIdHash(typeof aiResult === 'object' && aiResult?.idHash ? aiResult.idHash : aiResult);
      console.log(`[AIManager] Created AI object: ${aiIdHash.toString().substring(0, 8)}...`);

      // Store in lookup table
      this.aiByPerson.set(personIdHash, aiObject);

      // 4. Create Someone
      const someoneObj: any = {
        $type$: 'Someone' as const,
        someoneId: `ai:${aiId}`,
        mainProfile: profileIdHash,
        identities: new Map([[personIdHash, new Set([profileIdHash])]])
      };

      const someoneResult: any = await this.deps.storeVersionedObject(someoneObj);
      const someoneIdHash = ensureIdHash(typeof someoneResult === 'object' && someoneResult?.idHash ? someoneResult.idHash : someoneResult);

      // 5. Register with LeuteModel
      await this.leuteModel.addSomeoneElse(someoneIdHash);
      console.log(`[AIManager] Registered AI Someone: ${someoneIdHash.toString().substring(0, 8)}...`);

      // 6. Generate keys for the AI Person
      if (this.deps.createDefaultKeys && this.deps.hasDefaultKeys) {
        try {
          const hasKeys = await this.deps.hasDefaultKeys(personIdHash);
          if (!hasKeys) {
            await this.deps.createDefaultKeys(personIdHash);
            console.log(`[AIManager] ✅ Generated keys for AI Person`);
          } else {
            console.log(`[AIManager] Keys already exist for AI Person`);
          }
        } catch (error) {
          console.warn(`[AIManager] Failed to generate keys (AI won't be able to sign messages):`, error);
        }
      } else {
        console.warn(`[AIManager] ⚠️  createDefaultKeys not available - AI Person will not have keys!`);
      }

      // 7. Cache the entity
      this.entities.set(`ai:${aiId}`, personIdHash);
      this.personToEntity.set(personIdHash, `ai:${aiId}`);

      // 8. Assign trust level
      if (this.deps.trustPlan) {
        try {
          await this.deps.trustPlan.setTrustLevel({
            personId: personIdHash,
            trustLevel: 'high',
            establishedBy: myId,
            reason: `AI assistant: ${name}`
          });
          console.log(`[AIManager] ✅ Assigned trust level to AI`);
        } catch (error) {
          console.warn(`[AIManager] Failed to assign trust level:`, error);
        }
      }

      // 9. Create AI storage object (CRITICAL: Must happen for all AI creations)
      if (this.deps.aiObjectManager) {
        try {
          await this.deps.aiObjectManager.create({
            aiId,
            displayName: name,
            aiPersonId: personIdHash,
            llmProfileId: delegatesTo,
            modelId
          });
          console.log(`[AIManager] 💾 Created AI storage object for ${aiId}`);
        } catch (error) {
          console.error(`[AIManager] Failed to create AI storage object:`, error);
        }
      } else {
        console.warn(`[AIManager] ⚠️  aiObjectManager not available - AI storage object NOT created!`);
      }

      // 10. Create LLM storage object (CRITICAL: Links modelId → aiPersonId)
      if (this.deps.llmObjectManager) {
        try {
          await this.deps.llmObjectManager.create({
            modelId,
            name,
            server: 'http://localhost:11434', // Default Ollama server
            aiPersonId: personIdHash
          });
          console.log(`[AIManager] 💾 Created LLM storage object linking ${modelId} → AI Person`);
        } catch (error) {
          console.error(`[AIManager] Failed to create LLM storage object:`, error);
        }
      } else {
        console.warn(`[AIManager] ⚠️  llmObjectManager not available - LLM storage object NOT created!`);
      }

      console.log(`[AIManager] ✅ AI Person created: ${name}`);
      return {
        success: true,
        personIdHash,
        profileIdHash,
        someoneIdHash
      };
    } catch (error) {
      console.error(`[AIManager] Failed to create AI Person:`, error);
      throw error;
    }
  }

  /**
   * Create an LLM Person representing a model
   *
   * @param modelId - Model identifier (e.g., "claude-sonnet-4-5", "gpt-4")
   * @param name - Display name (e.g., "Claude Sonnet 4.5")
   * @param provider - Provider name (e.g., "anthropic", "openai", "ollama")
   * @param llmConfigId - Optional reference to LLM config object
   * @param server - Optional server URL (defaults to localhost:11434 for ollama)
   * @returns Profile ID of the created LLM
   */
  async createLLM(
    modelId: string,
    name: string,
    provider: string,
    llmConfigId?: string,
    server?: string
  ): Promise<SHA256IdHash<Profile>> {
    console.log(`[AIManager] Creating LLM Person: ${name} (${modelId})`);

    // Check cache first - returns Person ID, need to get Profile ID
    const cachedPersonId = this.entities.get(`llm:${modelId}`);
    if (cachedPersonId) {
      console.log(`[AIManager] LLM Person already exists: ${modelId}`);
      // Return cached Profile ID
      const cachedProfileId = this.llmProfileIdByPerson.get(cachedPersonId);
      if (cachedProfileId) {
        console.log(`[AIManager] Returning cached Profile ID: ${cachedProfileId.toString().substring(0, 8)}...`);
        return cachedProfileId;
      }
      // If Profile ID not cached, query for it
      try {
        const profileIdHash = await this._getMainProfileForPerson(cachedPersonId);
        // Cache it for next time
        this.llmProfileIdByPerson.set(cachedPersonId, profileIdHash);
        return profileIdHash;
      } catch (error) {
        console.error(`[AIManager] Failed to get Profile for existing LLM:`, error);
        throw error;
      }
    }

    try {
      // 1. Create Person object
      const email = `${modelId.replace(/[^a-zA-Z0-9]/g, '_')}@llm.local`;
      const personData = {
        $type$: 'Person' as const,
        email,
        name,
      };

      const personResult: any = await this.deps.storeVersionedObject(personData);
      const personIdHash = ensureIdHash(typeof personResult === 'object' && personResult?.idHash ? personResult.idHash : personResult);
      console.log(`[AIManager] Created LLM Person: ${personIdHash.toString().substring(0, 8)}...`);

      // 2. Create PersonName
      const personNameResult = await this.deps.storeUnversionedObject({
        $type$: 'PersonName' as const,
        name
      });
      const personNameHash = typeof personNameResult === 'object' && 'hash' in personNameResult
        ? personNameResult.hash
        : personNameResult;

      // 3. Create standard Profile (NO LLM-specific fields)
      const myId = await this.leuteModel.myMainIdentity();
      const profileObj: any = {
        $type$: 'Profile' as const,
        profileId: `llm:${modelId}`,
        personId: personIdHash,
        owner: myId,
        nickname: name,
        personDescription: [personNameHash],
        communicationEndpoint: []
      };

      const profileResult: any = await this.deps.storeVersionedObject(profileObj);
      const profileIdHash = ensureIdHash(typeof profileResult === 'object' && profileResult?.idHash ? profileResult.idHash : profileResult);
      console.log(`[AIManager] Created standard Profile: ${profileIdHash.toString().substring(0, 8)}...`);

      // 3a. Create LLM metadata object (SEPARATE from Person/Profile)
      const now = Date.now();
      const llmObject: LLM = {
        $type$: 'LLM',
        name,
        server: server || (provider === 'ollama' ? 'http://localhost:11434' : ''), // Mandatory - use provided or default
        filename: modelId,
        modelType: provider === 'ollama' ? 'local' : 'remote',
        active: true,
        deleted: false,
        created: now,
        modified: now,
        createdAt: new Date(now).toISOString(),
        lastUsed: new Date(now).toISOString(),
        modelId,
        personId: personIdHash,
        provider
      };

      const llmResult: any = await this.deps.storeVersionedObject(llmObject);
      const llmIdHash = ensureIdHash(typeof llmResult === 'object' && llmResult?.idHash ? llmResult.idHash : llmResult);
      console.log(`[AIManager] Created LLM object: ${llmIdHash.toString().substring(0, 8)}...`);

      // Store in lookup table
      this.llmByPerson.set(personIdHash, llmObject);

      // 4. Create Someone
      const someoneObj: any = {
        $type$: 'Someone' as const,
        someoneId: `llm:${modelId}`,
        mainProfile: profileIdHash,
        identities: new Map([[personIdHash, new Set([profileIdHash])]])
      };

      const someoneResult: any = await this.deps.storeVersionedObject(someoneObj);
      const someoneIdHash = ensureIdHash(typeof someoneResult === 'object' && someoneResult?.idHash ? someoneResult.idHash : someoneResult);

      // 5. Register with LeuteModel
      await this.leuteModel.addSomeoneElse(someoneIdHash);
      console.log(`[AIManager] Registered LLM Someone: ${someoneIdHash.toString().substring(0, 8)}...`);

      // 6. Cache the entity (store Person ID for lookups)
      this.entities.set(`llm:${modelId}`, personIdHash);
      this.personToEntity.set(personIdHash, `llm:${modelId}`);
      this.llmProfileIdByPerson.set(personIdHash, profileIdHash);  // Cache Profile ID

      console.log(`[AIManager] ✅ LLM Person created: ${name}`);
      return profileIdHash;  // Return Profile ID, not Person ID
    } catch (error) {
      console.error(`[AIManager] Failed to create LLM Person:`, error);
      throw error;
    }
  }

  /**
   * Update which Profile an AI delegates to
   * Allows switching models or chaining AIs
   * Updates the AI object (not Profile)
   */
  async setAIDelegation(aiId: string, delegatesTo: SHA256IdHash<Profile>): Promise<void> {
    console.log(`[AIManager] Updating AI delegation: ${aiId} → ${delegatesTo.toString().substring(0, 8)}...`);

    const aiPersonId = this.entities.get(`ai:${aiId}`);
    if (!aiPersonId) {
      throw new Error(`[AIManager] AI not found: ${aiId}`);
    }

    try {
      // Get current AI object
      const aiObject = this.aiByPerson.get(aiPersonId);
      if (!aiObject) {
        throw new Error(`[AIManager] AI object not found for ${aiId}`);
      }

      // Update AI object
      const updatedAI: AI = {
        ...aiObject,
        llmProfileId: delegatesTo,
        modified: Date.now()
      };

      await this.deps.storeVersionedObject(updatedAI);
      this.aiByPerson.set(aiPersonId, updatedAI);

      console.log(`[AIManager] ✅ Updated AI delegation for ${aiId}`);
    } catch (error) {
      console.error(`[AIManager] Failed to update AI delegation:`, error);
      throw error;
    }
  }

  /**
   * Get which Profile an AI delegates to
   * Reads from AI object (not Profile)
   */
  async getAIDelegation(aiId: string): Promise<SHA256IdHash<Profile> | null> {
    const aiPersonId = this.entities.get(`ai:${aiId}`);
    if (!aiPersonId) {
      return null;
    }

    // Get from AI object
    const aiObject = this.aiByPerson.get(aiPersonId);
    return aiObject ? aiObject.llmProfileId : null;
  }

  /**
   * Resolve the final LLM Person by following the delegation chain
   * Handles: AI → LLM, AI → AI → LLM, AI → AI → AI → LLM, etc.
   * Uses AI objects (not Profile) for delegation tracking
   *
   * @param personId - Starting Person ID (AI or LLM)
   * @returns Final LLM Person ID (throws if chain is circular or too deep)
   */
  async resolveLLMPerson(personId: SHA256IdHash<Person>): Promise<SHA256IdHash<Person>> {
    const visited = new Set<string>();
    let current = personId;
    const maxDepth = 10;  // Prevent infinite loops

    while (visited.size < maxDepth) {
      const currentStr = current.toString();

      if (visited.has(currentStr)) {
        throw new Error(`[AIManager] Circular delegation detected in chain starting from ${personId.toString().substring(0, 8)}...`);
      }

      visited.add(currentStr);

      // Check if it's an LLM Person
      if (this.isLLM(current)) {
        return current;
      }

      // Check if it's an AI Person
      const aiObject = this.aiByPerson.get(current);
      if (aiObject) {
        // Follow delegation to Profile, then extract Person ID
        const profileResult = await this.deps.getObjectByIdHash(aiObject.llmProfileId);
        const profile = profileResult.obj as Profile;
        current = profile.personId;
        continue;
      }

      // Not found in lookup tables - not an AI or LLM Person
      throw new Error(`[AIManager] Person ${currentStr.substring(0, 8)}... is neither AI nor LLM`);
    }

    throw new Error(`[AIManager] Delegation chain too deep (max ${maxDepth})`);
  }

  /**
   * Get Person ID for an entity ID
   */
  getPersonId(entityId: string): SHA256IdHash<Person> | null {
    return this.entities.get(entityId) || null;
  }

  /**
   * Get entity ID for a Person ID
   */
  getEntityId(personId: SHA256IdHash<Person>): string | null {
    return this.personToEntity.get(personId) || null;
  }

  /**
   * Check if a Person is an AI
   * Uses lookup table instead of Profile pollution
   */
  isAI(personId: SHA256IdHash<Person>): boolean {
    return this.aiByPerson.has(personId);
  }

  /**
   * Check if a Person is an LLM
   * Uses lookup table instead of Profile pollution
   */
  isLLM(personId: SHA256IdHash<Person>): boolean {
    return this.llmByPerson.has(personId);
  }

  /**
   * Get model ID for a Person ID (reverse lookup)
   * Extracts the model ID from the entity ID naming convention
   *
   * @param personId - Person ID hash to look up
   * @returns Model ID (e.g., "gpt-oss:20b") or null if not found
   */
  getModelIdForPersonId(personId: SHA256IdHash<Person>): string | null {
    const entityId = this.personToEntity.get(personId);
    if (!entityId) {
      return null;
    }

    // AI entities: "ai:started-as-{modelId}" → extract {modelId}
    if (entityId.startsWith('ai:started-as-')) {
      return entityId.substring('ai:started-as-'.length);
    }

    // LLM entities: "llm:{modelId}" → extract {modelId}
    if (entityId.startsWith('llm:')) {
      return entityId.substring('llm:'.length);
    }

    return null;
  }

  /**
   * Get the LLM Profile ID that an AI Person delegates to
   * Synchronous lookup from the AI object
   *
   * @param aiPersonId - AI Person ID to look up
   * @returns LLM Profile ID or null if no delegation exists
   */
  getLLMProfileId(aiPersonId: SHA256IdHash<Person>): SHA256IdHash<Profile> | null {
    const aiObject = this.aiByPerson.get(aiPersonId);
    return aiObject ? aiObject.llmProfileId : null;
  }

  /**
   * Get AI ID from AI Person ID using AI object lookup
   *
   * @param personId - Person ID to look up
   * @returns AI ID (e.g., "started-as-gpt-oss-20b") or null if not an AI Person
   */
  async getAIId(personId: SHA256IdHash<Person> | string): Promise<string | null> {
    const aiObject = this.aiByPerson.get(personId as SHA256IdHash<Person>);
    return aiObject ? aiObject.aiId : null;
  }

  /**
   * Get LLM ID from AI or LLM Person ID by following delegation chain
   * Uses AI/LLM objects (not Profile) for lookups
   *
   * @param personId - Person ID to look up (can be AI Person or LLM Person)
   * @returns LLM ID/model ID (e.g., "gpt-oss:20b") or null if not found
   */
  async getLLMId(personId: SHA256IdHash<Person> | string): Promise<string | null> {
    try {
      // Check if it's an AI Person - return modelId directly
      const aiObject = this.aiByPerson.get(personId as SHA256IdHash<Person>);
      if (aiObject) {
        return aiObject.modelId || null;
      }

      // Check if it's an LLM Person
      const llmObject = this.llmByPerson.get(personId as SHA256IdHash<Person>);
      if (llmObject) {
        return llmObject.modelId || null;
      }

      // Not AI or LLM - return null silently (this is normal for user messages)
      return null;
    } catch (error) {
      console.error(`[AIManager] getLLMId: Failed to get LLM ID for ${(personId as string).substring(0, 8)}...`, error);
      return null;
    }
  }

  /**
   * Rename an AI Person by creating a new identity while preserving the old one
   * Creates a new Person/Profile and adds it to the Someone, keeping the old Person as past identity
   *
   * @param aiId - Current AI ID (e.g., "started-as-gpt-oss-20b")
   * @param newName - New display name (e.g., "Research Assistant")
   * @returns Person ID of the new identity
   */
  async renameAI(aiId: string, newName: string): Promise<SHA256IdHash<Person>> {
    console.log(`[AIManager] Renaming AI: ${aiId} → ${newName}`);

    const currentPersonId = this.entities.get(`ai:${aiId}`);
    if (!currentPersonId) {
      throw new Error(`[AIManager] AI not found: ${aiId}`);
    }

    try {
      // 1. Get the Someone for this AI
      const someone = await this.leuteModel.getSomeone(currentPersonId);
      if (!someone) {
        throw new Error(`[AIManager] No Someone found for AI ${aiId}`);
      }

      // 2. Get current delegation target (to preserve it in new identity)
      const aiObject = this.aiByPerson.get(currentPersonId);
      if (!aiObject) {
        throw new Error(`[AIManager] AI ${aiId} has no AI object`);
      }
      const delegatesTo = aiObject.llmProfileId;

      // 3. Create new Person with new name
      const newPersonData = {
        $type$: 'Person' as const,
        email: `${newName.toLowerCase().replace(/[^a-z0-9]/g, '_')}@ai.local`,
        name: newName,
      };

      const newPersonResult: any = await this.deps.storeVersionedObject(newPersonData);
      const newPersonId = ensureIdHash(typeof newPersonResult === 'object' && newPersonResult?.idHash ? newPersonResult.idHash : newPersonResult);
      console.log(`[AIManager] Created new Person: ${newPersonId.toString().substring(0, 8)}...`);

      // 4. Create PersonName for new Person
      const personNameResult = await this.deps.storeUnversionedObject({
        $type$: 'PersonName' as const,
        name: newName
      });
      const personNameHash = typeof personNameResult === 'object' && 'hash' in personNameResult
        ? personNameResult.hash
        : personNameResult;

      // 5. Create new Profile (standard Profile properties only)
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
        // Note: Delegation preserved in cache, not stored in Profile
      };

      const newProfileResult: any = await this.deps.storeVersionedObject(newProfileObj);
      const newProfileIdHash = ensureIdHash(typeof newProfileResult === 'object' && newProfileResult?.idHash ? newProfileResult.idHash : newProfileResult);
      console.log(`[AIManager] Created new Profile: ${newProfileIdHash.toString().substring(0, 8)}...`);

      // 6. Add new Person to Someone's identities and set as mainProfile
      await someone.addProfile(newProfileIdHash);
      await someone.setMainProfile(newProfileIdHash);
      console.log(`[AIManager] Added new Profile to Someone and set as mainProfile`);

      // 7. Generate keys for the new Person identity
      if (this.deps.createDefaultKeys && this.deps.hasDefaultKeys) {
        try {
          const hasKeys = await this.deps.hasDefaultKeys(newPersonId);
          if (!hasKeys) {
            await this.deps.createDefaultKeys(newPersonId);
            console.log(`[AIManager] ✅ Generated keys for renamed AI Person`);
          } else {
            console.log(`[AIManager] Keys already exist for renamed AI Person`);
          }
        } catch (error) {
          console.warn(`[AIManager] Failed to generate keys for renamed Person:`, error);
        }
      } else {
        console.warn(`[AIManager] ⚠️  createDefaultKeys not available - renamed Person will not have keys!`);
      }

      // 8. Update AI object with new Person ID
      const updatedAI: AI = {
        ...aiObject,
        personId: newPersonId,
        modified: Date.now()
      };
      await this.deps.storeVersionedObject(updatedAI);

      // 9. Update caches
      // Note: We keep the old entity mapping for backward compatibility
      // The aiId stays the same, but now points to the new Person
      this.entities.set(`ai:${aiId}`, newPersonId);
      this.personToEntity.set(newPersonId, `ai:${aiId}`);
      this.aiByPerson.set(newPersonId, updatedAI);

      // Remove old Person from lookup table
      this.aiByPerson.delete(currentPersonId);

      // Also cache the new Person under its new profileId for lookups
      this.entities.set(newProfileId, newPersonId);
      this.personToEntity.set(newPersonId, newProfileId);

      console.log(`[AIManager] ✅ AI renamed: ${aiId} → ${newName}`);
      return newPersonId;
    } catch (error) {
      console.error(`[AIManager] Failed to rename AI:`, error);
      throw error;
    }
  }

  /**
   * Get all past identities for an AI Person
   * Returns all Persons in the Someone except the current mainIdentity
   *
   * @param aiId - AI ID
   * @returns Array of {personId, name} for past identities
   */
  async getPastIdentities(aiId: string): Promise<Array<{personId: SHA256IdHash<Person>, name: string}>> {
    const currentPersonId = this.entities.get(`ai:${aiId}`);
    if (!currentPersonId) {
      return [];
    }

    try {
      const someone = await this.leuteModel.getSomeone(currentPersonId);
      if (!someone) {
        return [];
      }

      const mainIdentity = await someone.mainIdentity();
      const allProfiles = await someone.profiles();

      const pastIdentities: Array<{personId: SHA256IdHash<Person>, name: string}> = [];

      for (const profileInfo of allProfiles) {
        const profileResult = await this.deps.getObjectByIdHash(profileInfo.idHash);
        const profile = profileResult.obj as any; // Standard Profile

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
      console.error(`[AIManager] Failed to get past identities:`, error);
      return [];
    }
  }

  /**
   * Load AI object from storage by aiId
   * Uses calculateIdHashOfObj with just ID properties (following TopicAnalysisModel pattern)
   * @private
   */
  private async _loadAIObjectByAiId(aiId: string, personId: SHA256IdHash<Person>): Promise<AI | null> {
    try {
      const { calculateIdHashOfObj } = await import('@refinio/one.core/lib/util/object.js');

      // Calculate ID hash from just the ID properties
      const aiIdHash = await calculateIdHashOfObj({ $type$: 'AI', aiId } as any);

      // Fetch by ID hash
      const aiResult = await this.deps.getObjectByIdHash(aiIdHash);
      const aiObject = aiResult.obj as AI;

      // Store in lookup table
      this.aiByPerson.set(personId, aiObject);

      console.log(`[AIManager] 💾 Loaded AI object: ${aiId} → ${aiObject.llmProfileId.toString().substring(0, 8)}...`);
      return aiObject;
    } catch (error) {
      console.warn(`[AIManager] Failed to load AI object for aiId ${aiId}:`, error);
      return null;
    }
  }

  /**
   * Load LLM object from storage by modelId and server
   * Uses calculateIdHashOfObj with just ID properties (name + server)
   * @private
   */
  private async _loadLLMObjectByModelId(modelId: string, server: string, personId: SHA256IdHash<Person>): Promise<LLM | null> {
    try {
      const { calculateIdHashOfObj } = await import('@refinio/one.core/lib/util/object.js');

      // Calculate ID hash from just the ID properties (name + server)
      const llmIdHash = await calculateIdHashOfObj({ $type$: 'LLM', name: modelId, server } as any);

      // Fetch by ID hash
      const llmResult = await this.deps.getObjectByIdHash(llmIdHash);
      const llmObject = llmResult.obj as LLM;

      // Store in lookup table
      this.llmByPerson.set(personId, llmObject);

      console.log(`[AIManager] 💾 Loaded LLM object: ${modelId} (${llmObject.modelId})`);
      return llmObject;
    } catch (error) {
      console.warn(`[AIManager] Failed to load LLM object for modelId ${modelId}:`, error);
      return null;
    }
  }

  /**
   * Load LLM object from storage by personId
   * Queries all LLM objects and finds one with matching personId
   * @private
   */
  private async _loadLLMObjectByPersonId(modelId: string, personId: SHA256IdHash<Person>): Promise<LLM | null> {
    try {
      // Query all LLM objects from storage
      const iterator = this.deps.channelManager.objectIteratorWithType('LLM', {
        channelId: 'lama',
      });

      for await (const llmObj of iterator) {
        if (llmObj && llmObj.data) {
          const llm = llmObj.data as LLM;
          // Match by personId
          if (llm.personId === personId && llm.name === modelId) {
            // Store in lookup table
            this.llmByPerson.set(personId, llm);
            console.log(`[AIManager] 💾 Loaded LLM object: ${modelId} from ${llm.server || 'remote'}`);
            return llm;
          }
        }
      }

      console.warn(`[AIManager] No LLM object found for personId ${personId.substring(0, 8)}...`);
      return null;
    } catch (error) {
      console.warn(`[AIManager] Failed to load LLM object for personId ${personId}:`, error);
      return null;
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
   * Load existing AI and LLM Persons from storage
   * Loads AI and LLM metadata objects (not Profile pollution)
   */
  async loadExisting(): Promise<{aiCount: number, llmCount: number}> {
    console.log('[AIManager] Loading existing AI and LLM objects...');

    let aiCount = 0;
    let llmCount = 0;

    try {
      // TODO: Query storage for all AI objects
      // For now, we'll iterate through contacts and check entity IDs
      const others = await this.leuteModel.others();
      console.log(`[AIManager] 🔍 DEBUG: Found ${others.length} Someone objects in leuteModel.others()`);

      for (const someone of others) {
        try {
          // Load the raw Someone object to access someoneId
          const someoneResult = await this.deps.getObjectByIdHash(someone.idHash);
          const someoneId = someoneResult.obj.someoneId;
          const personId = await someone.mainIdentity();
          console.log(`[AIManager] 🔍 DEBUG: Someone - someoneId: "${someoneId}", personId: ${personId?.substring(0, 8)}...`);

          if (!someoneId) {
            console.log(`[AIManager] 🔍 DEBUG: Skipping - no someoneId`);
            continue;
          }

          // Check if this is an AI or LLM by entity ID prefix
          if (someoneId.startsWith('ai:')) {
            // Load AI object for this Person
            try {
              const aiId = someoneId.substring('ai:'.length);
              const aiObject = await this._loadAIObjectByAiId(aiId, personId);

              // Cache entity mapping
              this.entities.set(someoneId, personId);
              this.personToEntity.set(personId, someoneId);

              if (aiObject) {
                aiCount++;
                console.log(`[AIManager] ✅ Loaded AI: ${someoneId} with delegation`);
              } else {
                console.warn(`[AIManager] ⚠️  Could not load AI object for ${someoneId}`);
              }
            } catch (error) {
              console.warn(`[AIManager] Failed to load AI for ${someoneId}:`, error);
              // Still cache the entity mapping
              this.entities.set(someoneId, personId);
              this.personToEntity.set(personId, someoneId);
            }
          } else if (someoneId.startsWith('llm:')) {
            // Load LLM object for this Person
            try {
              const modelId = someoneId.substring('llm:'.length);

              // Query ALL LLM objects to find one matching this modelId (name field)
              // We can't query by modelId alone since LLM ID = (name + server)
              const llmObject = await this._loadLLMObjectByPersonId(modelId, personId);

              // Cache entity mapping
              this.entities.set(someoneId, personId);
              this.personToEntity.set(personId, someoneId);

              // Cache Profile ID
              try {
                const profileIdHash = await this._getMainProfileForPerson(personId);
                this.llmProfileIdByPerson.set(personId, profileIdHash);
              } catch (error) {
                console.warn(`[AIManager] Failed to cache Profile ID for ${someoneId}:`, error);
              }

              if (llmObject) {
                llmCount++;
                console.log(`[AIManager] ✅ Loaded LLM: ${someoneId} from server ${llmObject.server || 'remote'}`);
              } else {
                console.warn(`[AIManager] ⚠️  Could not load LLM object for ${someoneId}`);
              }
            } catch (error) {
              console.warn(`[AIManager] Failed to load LLM object for ${someoneId}:`, error);
              // Still cache the entity mapping
              this.entities.set(someoneId, personId);
              this.personToEntity.set(personId, someoneId);
            }
          }
        } catch (error) {
          console.warn('[AIManager] Failed to load Someone:', error);
        }
      }

      console.log(`[AIManager] ✅ Loaded ${aiCount} AI Persons, ${llmCount} LLM Persons from storage using ONE.core reverse map queries`);
      return { aiCount, llmCount };
    } catch (error) {
      console.error('[AIManager] Failed to load existing entities:', error);
      throw error;
    }
  }
}
