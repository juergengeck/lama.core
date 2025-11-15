/**
 * AIContactManager
 *
 * Manages AI contact creation and lookups (Person/Profile/Someone).
 * This component handles the lifecycle of AI identities in the ONE.core
 * Leute model.
 *
 * Responsibilities:
 * - Create AI Person/Profile/Someone objects
 * - Cache AI contact mappings (modelId ↔ personId)
 * - Load existing AI contacts from storage
 * - Validate and sync AI contacts with available models
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import { ensureIdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, Instance, Keys } from '@refinio/one.core/lib/recipes.js';
import type { KeyPair } from '@refinio/one.core/lib/crypto/encryption.js';
import type { SignKeyPair } from '@refinio/one.core/lib/crypto/sign.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type { IAIContactManager } from './interfaces.js';
import type { LLMModelInfo } from './types.js';

// CRITICAL: Storage functions passed as dependencies to avoid module duplication in Vite worker bundles
export interface AIContactManagerDeps {
  storeVersionedObject: (obj: any) => Promise<any>;
  storeUnversionedObject: (obj: any) => Promise<SHA256Hash<any> | {hash: SHA256Hash<any>, obj: any, status: string}>;
  getIdObject: (idHash: SHA256IdHash<any>) => Promise<any>;
  createDefaultKeys?: (owner: SHA256IdHash<Person | Instance>, encryptionKeyPair?: KeyPair, signKeyPair?: SignKeyPair) => Promise<SHA256Hash<Keys>>;
  hasDefaultKeys?: (owner: SHA256IdHash<Person | Instance>) => Promise<boolean>;
  queryLLMObjects?: () => AsyncIterable<any>;
  trustPlan?: any; // Optional TrustPlan for assigning trust levels
  journalPlan?: any; // Optional JournalPlan for recording creation
}

export class AIContactManager implements IAIContactManager {
  // modelId → personId cache
  private aiContacts: Map<string, SHA256IdHash<Person>>;

  // personId → modelId reverse lookup
  private personToModel: Map<SHA256IdHash<Person>, string>;

  constructor(
    private leuteModel: LeuteModel,
    private deps: AIContactManagerDeps,
    private llmObjectManager?: any // Optional - for LLM object storage
  ) {
    this.aiContacts = new Map();
    this.personToModel = new Map();
  }

  /**
   * Ensure AI contact exists for a model
   * Returns cached personId if exists, otherwise creates new contact
   */
  async ensureAIContactForModel(
    modelId: string,
    displayName: string
  ): Promise<SHA256IdHash<Person>> {
    // Check cache first
    const cached = this.aiContacts.get(modelId);
    if (cached) {
      // Verify the cached Person still exists in contacts
      const others = await this.leuteModel.others();
      for (const someone of others) {
        try {
          const existingPersonId = await someone.mainIdentity();
          if (existingPersonId === cached) {
            return cached;
          }
        } catch {
          // Continue checking
        }
      }

      // Cache was stale - Person not in contacts
      console.log(`[AIContactManager] Cached Person ID for ${modelId} not in contacts, recreating...`);
      this.aiContacts.delete(modelId);
      this.personToModel.delete(cached);
    }

    // Create new contact
    return await this.createAIContact(modelId, displayName);
  }

  /**
   * Create AI contact (Person/Profile/Someone)
   * This is idempotent - if contact already exists, returns existing personId
   */
  async createAIContact(
    modelId: string,
    displayName: string
  ): Promise<SHA256IdHash<Person>> {
    console.log(`[AIContactManager] Setting up AI contact for ${displayName} (${modelId})`);

    try {
      // Create Person object with AI email pattern
      const email = `${modelId.replace(/[^a-zA-Z0-9]/g, '_')}@ai.local`;
      const personData = {
        $type$: 'Person' as const,
        email,
        name: displayName,
      };

      console.log('[AIContactManager] About to call storeVersionedObject with:', personData);
      console.log('[AIContactManager] storeVersionedObject function:', this.deps.storeVersionedObject);

      const result: any = await this.deps.storeVersionedObject(personData);
      console.log('[AIContactManager] storeVersionedObject result:', result);
      const personIdHashResult = typeof result === 'object' && result?.idHash ? result.idHash : result;
      const personIdHash = ensureIdHash(personIdHashResult);

      console.log(`[AIContactManager] Person ID: ${personIdHash.toString().substring(0, 8)}...`);

      // Try to ensure cryptographic keys exist for this person
      // This may fail in browser if Keys recipe isn't registered - that's OK for AI contacts
      if (this.deps.hasDefaultKeys && this.deps.createDefaultKeys) {
        try {
          if (!(await this.deps.hasDefaultKeys(personIdHash))) {
            await this.deps.createDefaultKeys(personIdHash);
            console.log(`[AIContactManager] Created cryptographic keys`);
          }
        } catch (error) {
          console.log(`[AIContactManager] Skipping key creation (not available in this platform):`, (error as Error).message);
          // AI contacts don't need encryption keys, so this is fine
        }
      }

      // Check if Someone with this modelId already exists
      const others = await this.leuteModel.others();
      let existingSomeone = null;

      for (const someone of others) {
        try {
          const someoneId = (someone as any).someoneId;
          if (someoneId === modelId) {
            existingSomeone = someone;
            console.log(`[AIContactManager] Someone with modelId ${modelId} already exists in contacts`);
            break;
          }
        } catch {
          // Continue checking
        }
      }

      // If no Someone exists with this modelId, create Profile and Someone
      if (!existingSomeone) {
        const myId = await this.leuteModel.myMainIdentity();

        // Store PersonName as unversioned object and get its hash
        // Handle both wrapped (just hash) and unwrapped (full result) return types
        const personNameResult = await this.deps.storeUnversionedObject({
          $type$: 'PersonName' as const,
          name: displayName
        });
        const personNameHash = typeof personNameResult === 'object' && 'hash' in personNameResult
          ? personNameResult.hash
          : personNameResult;
        console.log(`[AIContactManager] Created PersonName: ${personNameHash.toString().substring(0, 8)}...`);

        // Create Profile object with hash reference to PersonName
        const profileObj: any = {
          $type$: 'Profile' as const,
          profileId: `ai-${modelId}`,  // ID property
          personId: personIdHash,  // referenceToId
          owner: myId,
          nickname: displayName,  // Profile recipe uses 'nickname' for display name
          personDescription: [personNameHash],  // Array of SHA256Hash references to PersonDescription objects
          communicationEndpoint: []  // Singular, not plural
        };

        const profileResult: any = await this.deps.storeVersionedObject(profileObj);
        const profileIdHash = typeof profileResult === 'object' && profileResult?.idHash ? profileResult.idHash : profileResult;
        console.log(`[AIContactManager] Created profile: ${profileIdHash.toString().substring(0, 8)}...`);

        // Create Someone object with all required properties
        const newSomeone: any = {
          $type$: 'Someone' as const,
          someoneId: modelId,
          mainProfile: profileIdHash,
          identities: new Map([[personIdHash, new Set([profileIdHash])]])
        };

        const someoneResult: any = await this.deps.storeVersionedObject(newSomeone);
        const someoneIdHash = typeof someoneResult === 'object' && someoneResult?.idHash ? someoneResult.idHash : someoneResult;

        // Register the Someone with LeuteModel so it appears in leuteModel.others()
        await this.leuteModel.addSomeoneElse(someoneIdHash);
        console.log(`[AIContactManager] Registered Someone with LeuteModel: ${someoneIdHash.toString().substring(0, 8)}...`);

        // NOTE: Do NOT call addProfile() here - it would try to create another Someone
        // The Person/Profile/Someone structure is already complete
        console.log(`[AIContactManager] Created Someone: ${someoneIdHash.toString().substring(0, 8)}...`);
        console.log(`[AIContactManager] AI contact creation complete - Person/Profile/Someone structure ready`);
      }

      // Cache the AI contact
      this.aiContacts.set(modelId, personIdHash);
      this.personToModel.set(personIdHash, modelId);

      // Create LLM object
      if (!this.llmObjectManager) {
        throw new Error(`[AIContactManager] llmObjectManager not initialized - required for AI contact creation`);
      }
      await this.createLLMObjectForAI(modelId, displayName, personIdHash);
      console.log(`[AIContactManager] Ensured LLM object for ${modelId}`);

      // Assign 'high' trust level to AI contacts
      if (this.deps.trustPlan) {
        try {
          const myId = await this.leuteModel.myMainIdentity();
          const trustResult = await this.deps.trustPlan.setTrustLevel({
            personId: personIdHash,
            trustLevel: 'high',
            establishedBy: myId,
            reason: 'AI assistant contact - system created'
          });

          if (trustResult.success) {
            console.log(`[AIContactManager] ✅ Assigned 'high' trust level to AI contact ${modelId}`);
          } else {
            console.warn(`[AIContactManager] ⚠️ Failed to assign trust level:`, trustResult.error);
          }
        } catch (error) {
          console.error(`[AIContactManager] Error assigning trust level to AI contact:`, error);
          // Don't throw - trust assignment failure shouldn't break AI contact creation
        }
      }

      // Record AI contact creation in journal as an assembly
      if (this.deps.journalPlan) {
        try {
          const myId = await this.leuteModel.myMainIdentity();
          await this.deps.journalPlan.recordAIContactCreation(
            myId,
            personIdHash,
            modelId,
            displayName
          );
          console.log(`[AIContactManager] 📝 Recorded AI contact creation in journal`);
        } catch (error) {
          console.error(`[AIContactManager] Error recording AI contact creation in journal:`, error);
          // Don't throw - journal recording failure shouldn't break AI contact creation
        }
      }

      return personIdHash;
    } catch (error) {
      console.error(`[AIContactManager] Failed to create AI contact for ${modelId}:`, error);
      throw error;
    }
  }

  /**
   * Get person ID for a model (from cache)
   */
  getPersonIdForModel(modelId: string): SHA256IdHash<Person> | null {
    return this.aiContacts.get(modelId) || null;
  }

  /**
   * Check if person ID is an AI person
   */
  isAIPerson(personId: SHA256IdHash<Person>): boolean {
    return this.personToModel.has(personId);
  }

  /**
   * Get model ID for a person ID (reverse lookup)
   */
  getModelIdForPersonId(personId: SHA256IdHash<Person>): string | null {
    return this.personToModel.get(personId) || null;
  }

  /**
   * Load existing AI contacts from storage
   * Uses LLM objects as the source of truth for modelId ↔ personId mappings
   */
  async loadExistingAIContacts(_models: LLMModelInfo[]): Promise<number> {
    console.log('[AIContactManager] Loading existing AI contacts from LLM objects...');

    if (!this.llmObjectManager) {
      throw new Error(`[AIContactManager] llmObjectManager not initialized - required for AI contact loading`);
    }

    try {
      // Get all LLM objects from storage (this is the source of truth)
      const allLLMs = this.llmObjectManager.getAllLLMObjects();
      console.log(`[AIContactManager] Found ${allLLMs.length} total LLM objects`);

      let aiContactCount = 0;

      for (const llm of allLLMs) {
        const llmData = llm as any;

        // Only process LLM objects that have a personId (AI contacts)
        if (llmData.personId && llmData.modelId) {
          console.log(`[AIContactManager] ✅ Found AI contact: ${llmData.modelId} (person: ${llmData.personId.toString().substring(0, 8)}...)`);

          // Rebuild caches from LLM objects
          this.aiContacts.set(llmData.modelId, llmData.personId);
          this.personToModel.set(llmData.personId, llmData.modelId);

          // Find the Someone object for this personId and register it with LeuteModel
          try {
            const someone = await this.leuteModel.getSomeone(llmData.personId);
            if (someone) {
              const someoneIdHash = someone.idHash;
              await this.leuteModel.addSomeoneElse(someoneIdHash);
              console.log(`[AIContactManager] Registered existing Someone with LeuteModel: ${someoneIdHash.toString().substring(0, 8)}...`);
            } else {
              console.warn(`[AIContactManager] Could not find Someone for personId ${llmData.personId.toString().substring(0, 8)}...`);
            }
          } catch (error) {
            console.warn(`[AIContactManager] Failed to register Someone for ${llmData.modelId}:`, error);
          }

          aiContactCount++;
        }
      }

      console.log(`[AIContactManager] ✅ Loaded ${aiContactCount} AI contacts from LLM objects`);
      return aiContactCount;
    } catch (error) {
      console.error('[AIContactManager] Failed to load AI contacts:', error);
      throw error;
    }
  }

  /**
   * Ensure contacts for all models
   * Creates missing contacts for available models
   */
  async ensureContactsForModels(models: LLMModelInfo[]): Promise<number> {
    console.log(`[AIContactManager] Ensuring contacts for ${models.length} models...`);

    let created = 0;
    for (const model of models) {
      try {
        const existing = this.aiContacts.get(model.id);
        if (!existing) {
          await this.ensureAIContactForModel(model.id, model.displayName || model.name);
          created++;
        }
      } catch (error) {
        console.warn(`[AIContactManager] Failed to ensure contact for ${model.id}:`, error);
      }
    }

    console.log(`[AIContactManager] Created ${created} new AI contacts`);
    return created;
  }

  /**
   * Create an LLM alias for an existing AI contact
   * Used for -private variants that share the same Person but have different modelIds
   */
  async createLLMAlias(
    aliasModelId: string,
    baseModelId: string,
    displayName: string
  ): Promise<void> {
    console.log(`[AIContactManager] Creating LLM alias ${aliasModelId} for base model ${baseModelId}`);

    // Get the Person ID from the base model
    const personId = this.aiContacts.get(baseModelId);
    if (!personId) {
      throw new Error(`Cannot create alias - base model ${baseModelId} not found in cache`);
    }

    // Cache the alias → same personId mapping
    this.aiContacts.set(aliasModelId, personId);
    console.log(`[AIContactManager] Cached alias ${aliasModelId} → person ${personId.toString().substring(0, 8)}...`);

    // Create LLM object for the alias
    if (!this.llmObjectManager) {
      throw new Error(`[AIContactManager] llmObjectManager not initialized - required for LLM alias creation`);
    }

    await this.llmObjectManager.create({
      modelId: aliasModelId,
      name: displayName,
      aiPersonId: personId
    });

    console.log(`[AIContactManager] Created LLM object for alias ${aliasModelId}`);
  }

  /**
   * Create LLM object for AI contact (platform-specific storage)
   * This is called if llmObjectManager is available
   */
  private async createLLMObjectForAI(
    modelId: string,
    displayName: string,
    personId: SHA256IdHash<Person>
  ): Promise<void> {
    if (!this.llmObjectManager) {
      return;
    }

    // Check if LLM object already exists
    const existing = await this.llmObjectManager.getByModelId(modelId);
    if (existing) {
      return;
    }

    // Create LLM object
    await this.llmObjectManager.create({
      modelId,
      name: displayName,
      aiPersonId: personId
    });
  }
}
