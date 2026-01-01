/**
 * Character Plan
 *
 * Manages character data (traits, voice, AI-specific settings) for contacts.
 * Uses ProfileCharacterService for profile-level data and AIManager for AI-specific data.
 *
 * Key operations:
 * - getCharacter: Get combined character data for a contact
 * - updateCharacter: Update character data (creates new profile version)
 * - getCharacterHistory: Get version history for a contact's character
 * - restoreCharacter: Restore a previous character version
 *
 * For AI contacts, also manages:
 * - creationContext (read-only, set at AI creation)
 * - systemPromptAddition (editable)
 * - modelId (editable, triggers AI object version)
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { Profile } from '@refinio/one.models/lib/recipes/Leute/Profile.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import { ProfileCharacterService, type ProfileCharacterServiceDeps, type ProfileVersion } from '../services/ProfileCharacterService.js';
import type { AIManager, AI, AICreationContext } from '../models/ai/AIManager.js';
import type { PersonVoice } from '../recipes/PersonDescriptionRecipes.js';

// ============== Request/Response Types ==============

export interface GetCharacterRequest {
  personId: string;  // Person ID hash as string
}

export interface CharacterData {
  // Profile-level data (applies to all contacts)
  traits: string[];
  voice: PersonVoice | null;

  // AI-specific data (only present for AI contacts)
  isAI: boolean;
  creationContext?: AICreationContext;
  systemPromptAddition?: string;
  modelId?: string;
}

export interface GetCharacterResponse {
  success: boolean;
  character?: CharacterData;
  error?: string;
}

export interface UpdateCharacterRequest {
  personId: string;

  // Profile-level updates
  traits?: string[];
  voice?: PersonVoice | null;  // null = remove voice

  // AI-specific updates (ignored for non-AI contacts)
  systemPromptAddition?: string;
  modelId?: string;
}

export interface UpdateCharacterResponse {
  success: boolean;
  profileVersionHash?: string;
  aiVersionHash?: string;
  error?: string;
}

export interface GetCharacterHistoryRequest {
  personId: string;
}

export interface CharacterHistoryEntry {
  versionHash: string;
  timestamp: number;
  traits?: string[];
  hasVoice: boolean;
}

export interface GetCharacterHistoryResponse {
  success: boolean;
  versions?: CharacterHistoryEntry[];
  error?: string;
}

export interface RestoreCharacterRequest {
  personId: string;
  versionHash: string;
}

export interface RestoreCharacterResponse {
  success: boolean;
  newVersionHash?: string;
  error?: string;
}

// ============== Plan Dependencies ==============

export interface CharacterPlanDeps extends ProfileCharacterServiceDeps {
  leuteModel: LeuteModel;
  aiManager?: AIManager;
}

// ============== Plan Class ==============

export class CharacterPlan {
  static get planName(): string { return 'Character.Management'; }
  static get description(): string { return 'Manages character data (traits, voice, AI settings)'; }
  static get version(): string { return '1.0.0'; }
  static get planId(): string { return '@lama/core/plans/CharacterPlan'; }

  private profileCharacterService: ProfileCharacterService;
  private leuteModel: LeuteModel;
  private aiManager?: AIManager;

  constructor(deps: CharacterPlanDeps) {
    this.profileCharacterService = new ProfileCharacterService(deps);
    this.leuteModel = deps.leuteModel;
    this.aiManager = deps.aiManager;
  }

  /**
   * Get the main Profile idHash for a Person
   */
  private async getMainProfileForPerson(personId: SHA256IdHash<Person>): Promise<SHA256IdHash<Profile> | null> {
    try {
      // Check if it's "me"
      const me = await this.leuteModel.me();
      const myMainIdentity = await me.mainIdentity();
      if (myMainIdentity === personId) {
        const myMainProfile = await me.mainProfile();
        return myMainProfile.idHash;
      }
    } catch {
      // Not me, continue to others
    }

    // Find in others
    const others = await this.leuteModel.others();
    for (const someone of others) {
      try {
        const mainIdentity = await someone.mainIdentity();
        if (mainIdentity === personId) {
          const mainProfile = await someone.mainProfile();
          return mainProfile.idHash;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Get character data for a contact
   */
  async getCharacter(request: GetCharacterRequest): Promise<GetCharacterResponse> {
    try {
      const personId = request.personId as SHA256IdHash<Person>;

      // Get main profile for this person
      const profileIdHash = await this.getMainProfileForPerson(personId);
      if (!profileIdHash) {
        return { success: false, error: 'Profile not found for person' };
      }

      // Get profile-level character data
      const { traits, voice } = await this.profileCharacterService.getCharacter(profileIdHash);

      // Check if this is an AI contact
      const ai = this.aiManager?.getAI(personId);
      const isAI = ai !== null && ai !== undefined;

      const character: CharacterData = {
        traits,
        voice,
        isAI,
        ...(isAI && ai && {
          creationContext: ai.creationContext,
          systemPromptAddition: ai.systemPromptAddition,
          modelId: ai.modelId
        })
      };

      return { success: true, character };
    } catch (error) {
      console.error('[CharacterPlan] getCharacter failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update character data for a contact
   * Creates new profile version for traits/voice changes
   * Creates new AI version for systemPromptAddition/modelId changes
   */
  async updateCharacter(request: UpdateCharacterRequest): Promise<UpdateCharacterResponse> {
    try {
      const personId = request.personId as SHA256IdHash<Person>;

      // Get main profile for this person
      const profileIdHash = await this.getMainProfileForPerson(personId);
      if (!profileIdHash) {
        return { success: false, error: 'Profile not found for person' };
      }

      let profileVersionHash: string | undefined;
      let aiVersionHash: string | undefined;

      // Update profile-level data if any provided
      if (request.traits !== undefined || request.voice !== undefined) {
        const updateData: { traits?: string[]; voice?: PersonVoice | null } = {};

        if (request.traits !== undefined) {
          updateData.traits = request.traits;
        }
        if (request.voice !== undefined) {
          updateData.voice = request.voice;
        }

        const newProfileHash = await this.profileCharacterService.updateCharacter(profileIdHash, updateData);
        profileVersionHash = newProfileHash.toString();
      }

      // Update AI-specific data if this is an AI contact
      if (this.aiManager) {
        const ai = this.aiManager.getAI(personId);
        if (ai) {
          // Check if we need to update AI object
          const needsSystemPromptUpdate = request.systemPromptAddition !== undefined &&
            request.systemPromptAddition !== ai.systemPromptAddition;
          const needsModelUpdate = request.modelId !== undefined &&
            request.modelId !== ai.modelId;

          if (needsSystemPromptUpdate || needsModelUpdate) {
            // Update AI object - creates new version for each change
            if (needsModelUpdate && request.modelId) {
              const result = await this.aiManager.updateModelId(personId, request.modelId);
              aiVersionHash = result.hash.toString();
            }

            if (needsSystemPromptUpdate) {
              const result = await this.aiManager.updateSystemPromptAddition(
                personId,
                request.systemPromptAddition
              );
              aiVersionHash = result.hash.toString();
            }
          }
        }
      }

      return {
        success: true,
        profileVersionHash,
        aiVersionHash
      };
    } catch (error) {
      console.error('[CharacterPlan] updateCharacter failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get character version history for a contact
   */
  async getCharacterHistory(request: GetCharacterHistoryRequest): Promise<GetCharacterHistoryResponse> {
    try {
      const personId = request.personId as SHA256IdHash<Person>;

      // Get main profile for this person
      const profileIdHash = await this.getMainProfileForPerson(personId);
      if (!profileIdHash) {
        return { success: false, error: 'Profile not found for person' };
      }

      const versions = await this.profileCharacterService.getProfileVersions(profileIdHash);

      const historyEntries: CharacterHistoryEntry[] = versions.map((v: ProfileVersion) => ({
        versionHash: v.versionHash.toString(),
        timestamp: v.timestamp,
        traits: v.traits,
        hasVoice: v.hasVoice
      }));

      return { success: true, versions: historyEntries };
    } catch (error) {
      console.error('[CharacterPlan] getCharacterHistory failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Restore a previous character version
   */
  async restoreCharacter(request: RestoreCharacterRequest): Promise<RestoreCharacterResponse> {
    try {
      const personId = request.personId as SHA256IdHash<Person>;

      // Get main profile for this person
      const profileIdHash = await this.getMainProfileForPerson(personId);
      if (!profileIdHash) {
        return { success: false, error: 'Profile not found for person' };
      }

      const targetVersionHash = request.versionHash as SHA256Hash<Profile>;
      const newVersionHash = await this.profileCharacterService.restoreProfileVersion(
        profileIdHash,
        targetVersionHash
      );

      return {
        success: true,
        newVersionHash: newVersionHash.toString()
      };
    } catch (error) {
      console.error('[CharacterPlan] restoreCharacter failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }
}
