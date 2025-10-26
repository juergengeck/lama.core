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
import type { LLMModelInfo, AIContactCreationResult } from './types.js';

// CRITICAL: Storage functions passed as dependencies to avoid module duplication in Vite worker bundles
export interface AIContactManagerDeps {
  storeVersionedObject: (obj: any) => Promise<any>;
  getIdObject: (idHash: SHA256IdHash<any>) => Promise<any>;
  createDefaultKeys?: (owner: SHA256IdHash<Person | Instance>, encryptionKeyPair?: KeyPair, signKeyPair?: SignKeyPair) => Promise<SHA256Hash<Keys>>;
  hasDefaultKeys?: (owner: SHA256IdHash<Person | Instance>) => Promise<boolean>;
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

        // Create Profile object directly (using all required properties from recipe)
        const profileObj: any = {
          $type$: 'Profile' as const,
          profileId: `ai-${modelId}`,  // ID property
          personId: personIdHash,  // referenceToId
          owner: myId,
          nickname: displayName,  // Profile recipe uses 'nickname', not 'name'
          personDescription: [],  // Singular, not plural
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

        // Add to LeuteModel using addProfile (not addOther)
        await (this.leuteModel as any).addProfile(profileIdHash);
        console.log(`[AIContactManager] Created and added Someone to contacts: ${someoneIdHash.toString().substring(0, 8)}...`);
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
   * Scans LeuteModel for AI contacts and rebuilds caches
   */
  async loadExistingAIContacts(models: LLMModelInfo[]): Promise<number> {
    console.log('[AIContactManager] Loading existing AI contacts...');

    try {
      const others = await this.leuteModel.others();
      console.log(`[AIContactManager] Found ${others.length} total contacts`);

      let aiContactCount = 0;

      for (const someone of others) {
        try {
          const personId = await someone.mainIdentity();

          // Get Person object to check email
          const person = await this.deps.getIdObject(personId);
          const email = (person as any).email || '';

          // AI contacts have emails like "modelId@ai.local"
          if (email.endsWith('@ai.local')) {
            const emailPrefix = email.replace('@ai.local', '');

            // Find matching model by checking if emailPrefix matches model ID pattern
            for (const model of models) {
              const expectedEmailPrefix = model.id.replace(/[^a-zA-Z0-9]/g, '_');
              if (emailPrefix === expectedEmailPrefix) {
                console.log(`[AIContactManager] ✅ Found AI contact: ${model.id} (person: ${personId.toString().substring(0, 8)}...)`);

                // Cache the AI contact
                this.aiContacts.set(model.id, personId);
                this.personToModel.set(personId, model.id);

                // Ensure LLM object exists
                if (!this.llmObjectManager) {
                  throw new Error(`[AIContactManager] llmObjectManager not initialized - required for AI contact loading`);
                }
                await this.createLLMObjectForAI(model.id, model.name, personId);
                console.log(`[AIContactManager] Ensured LLM object for ${model.id}`);

                aiContactCount++;
                break;
              }
            }
          }
        } catch (err) {
          console.warn('[AIContactManager] Error processing contact:', err);
        }
      }

      console.log(`[AIContactManager] ✅ Loaded ${aiContactCount} AI contacts from ${others.length} total contacts`);
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
      aiPersonId: personId,
    });
  }
}
