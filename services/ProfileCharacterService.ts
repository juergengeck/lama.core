/**
 * ProfileCharacterService
 *
 * Manages character data (traits, voice) on Profile objects via personDescription.
 * These are general profile features that apply to any contact (human or AI).
 *
 * Key concepts:
 * - PersonTraits and PersonVoice are unversioned objects stored by hash
 * - Profile.personDescription contains hashes pointing to these objects
 * - Changing character data creates a new Profile version (same idHash, new versionHash)
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Profile } from '@refinio/one.models/lib/recipes/Leute/Profile.js';
import type { PersonTraits, PersonVoice } from '../recipes/PersonDescriptionRecipes.js';

/**
 * Dependencies for ProfileCharacterService
 * Injected to avoid module duplication with ONE.core
 */
export interface ProfileCharacterServiceDeps {
  storeVersionedObject: (obj: any) => Promise<{ hash: SHA256Hash<any>; idHash: SHA256IdHash<any>; versionHash?: SHA256Hash<any> }>;
  storeUnversionedObject: (obj: any) => Promise<SHA256Hash<any> | { hash: SHA256Hash<any>; obj: any; status: string }>;
  getObject: (hash: SHA256Hash<any>) => Promise<any>;
  getObjectByIdHash: (idHash: SHA256IdHash<any>) => Promise<{ obj: any; hash: SHA256Hash<any>; versionHash?: SHA256Hash<any> }>;
  getObjectWithType: (hash: SHA256Hash<any>, type: string) => Promise<any>;
  /** Get all versions of a versioned object by idHash */
  getAllVersions?: (idHash: SHA256IdHash<any>) => Promise<Array<{ hash: SHA256Hash<any>; obj: any; timestamp?: number }>>;
}

/**
 * Profile version info for history display
 */
export interface ProfileVersion {
  versionHash: SHA256Hash<Profile>;
  timestamp: number;
  traits?: string[];
  hasVoice: boolean;
}

export class ProfileCharacterService {
  constructor(private deps: ProfileCharacterServiceDeps) {}

  /**
   * Get traits from a Profile's personDescription
   *
   * @param profileIdHash - Profile ID hash
   * @returns Array of trait strings, empty if none
   */
  async getTraits(profileIdHash: SHA256IdHash<Profile>): Promise<string[]> {
    try {
      const result = await this.deps.getObjectByIdHash(profileIdHash);
      const profile = result.obj as Profile;

      if (!profile.personDescription || profile.personDescription.length === 0) {
        return [];
      }

      // Find PersonTraits in personDescription
      for (const hash of profile.personDescription) {
        try {
          const obj = await this.deps.getObject(hash as SHA256Hash<any>);
          if (obj && obj.$type$ === 'PersonTraits') {
            return (obj as PersonTraits).traits || [];
          }
        } catch {
          // Skip objects we can't load
          continue;
        }
      }

      return [];
    } catch (error) {
      console.error('[ProfileCharacterService] Failed to get traits:', error);
      return [];
    }
  }

  /**
   * Set traits on a Profile, creating a new version
   *
   * @param profileIdHash - Profile ID hash
   * @param traits - Array of trait strings
   * @returns New profile version hash
   */
  async setTraits(profileIdHash: SHA256IdHash<Profile>, traits: string[]): Promise<SHA256Hash<Profile>> {
    const result = await this.deps.getObjectByIdHash(profileIdHash);
    const profile = result.obj as Profile;

    // Create new PersonTraits object
    const traitsObj: PersonTraits = {
      $type$: 'PersonTraits',
      traits
    };
    const traitsResult = await this.deps.storeUnversionedObject(traitsObj);
    const traitsHash = typeof traitsResult === 'string' ? traitsResult : traitsResult.hash;

    // Build new personDescription, replacing any existing PersonTraits
    const newPersonDescription: SHA256Hash<any>[] = [];

    // Copy existing non-traits descriptions
    if (profile.personDescription) {
      for (const hash of profile.personDescription) {
        try {
          const obj = await this.deps.getObject(hash as SHA256Hash<any>);
          if (obj && obj.$type$ !== 'PersonTraits') {
            newPersonDescription.push(hash as SHA256Hash<any>);
          }
        } catch {
          // Keep hashes we can't load (might be valid but different type)
          newPersonDescription.push(hash as SHA256Hash<any>);
        }
      }
    }

    // Add new traits
    if (traits.length > 0) {
      newPersonDescription.push(traitsHash);
    }

    // Create new profile version
    const updatedProfile = {
      ...profile,
      personDescription: newPersonDescription
    };

    const storeResult = await this.deps.storeVersionedObject(updatedProfile);
    return storeResult.hash;
  }

  /**
   * Get voice settings from a Profile's personDescription
   *
   * @param profileIdHash - Profile ID hash
   * @returns PersonVoice object or null if none
   */
  async getVoice(profileIdHash: SHA256IdHash<Profile>): Promise<PersonVoice | null> {
    try {
      const result = await this.deps.getObjectByIdHash(profileIdHash);
      const profile = result.obj as Profile;

      if (!profile.personDescription || profile.personDescription.length === 0) {
        return null;
      }

      // Find PersonVoice in personDescription
      for (const hash of profile.personDescription) {
        try {
          const obj = await this.deps.getObject(hash as SHA256Hash<any>);
          if (obj && obj.$type$ === 'PersonVoice') {
            return obj as PersonVoice;
          }
        } catch {
          // Skip objects we can't load
          continue;
        }
      }

      return null;
    } catch (error) {
      console.error('[ProfileCharacterService] Failed to get voice:', error);
      return null;
    }
  }

  /**
   * Set voice settings on a Profile, creating a new version
   *
   * @param profileIdHash - Profile ID hash
   * @param voice - Voice settings (baseVoiceId required, speed/pitch optional)
   * @returns New profile version hash
   */
  async setVoice(profileIdHash: SHA256IdHash<Profile>, voice: PersonVoice): Promise<SHA256Hash<Profile>> {
    const result = await this.deps.getObjectByIdHash(profileIdHash);
    const profile = result.obj as Profile;

    // Create new PersonVoice object
    const voiceResult = await this.deps.storeUnversionedObject(voice);
    const voiceHash = typeof voiceResult === 'string' ? voiceResult : voiceResult.hash;

    // Build new personDescription, replacing any existing PersonVoice
    const newPersonDescription: SHA256Hash<any>[] = [];

    // Copy existing non-voice descriptions
    if (profile.personDescription) {
      for (const hash of profile.personDescription) {
        try {
          const obj = await this.deps.getObject(hash as SHA256Hash<any>);
          if (obj && obj.$type$ !== 'PersonVoice') {
            newPersonDescription.push(hash as SHA256Hash<any>);
          }
        } catch {
          // Keep hashes we can't load
          newPersonDescription.push(hash as SHA256Hash<any>);
        }
      }
    }

    // Add new voice
    newPersonDescription.push(voiceHash);

    // Create new profile version
    const updatedProfile = {
      ...profile,
      personDescription: newPersonDescription
    };

    const storeResult = await this.deps.storeVersionedObject(updatedProfile);
    return storeResult.hash;
  }

  /**
   * Remove voice settings from a Profile, creating a new version
   *
   * @param profileIdHash - Profile ID hash
   * @returns New profile version hash
   */
  async removeVoice(profileIdHash: SHA256IdHash<Profile>): Promise<SHA256Hash<Profile>> {
    const result = await this.deps.getObjectByIdHash(profileIdHash);
    const profile = result.obj as Profile;

    // Build new personDescription without PersonVoice
    const newPersonDescription: SHA256Hash<any>[] = [];

    if (profile.personDescription) {
      for (const hash of profile.personDescription) {
        try {
          const obj = await this.deps.getObject(hash as SHA256Hash<any>);
          if (obj && obj.$type$ !== 'PersonVoice') {
            newPersonDescription.push(hash as SHA256Hash<any>);
          }
        } catch {
          newPersonDescription.push(hash as SHA256Hash<any>);
        }
      }
    }

    // Create new profile version
    const updatedProfile = {
      ...profile,
      personDescription: newPersonDescription
    };

    const storeResult = await this.deps.storeVersionedObject(updatedProfile);
    return storeResult.hash;
  }

  /**
   * Get all versions of a Profile with character summary
   *
   * @param profileIdHash - Profile ID hash
   * @returns Array of ProfileVersion objects, newest first
   */
  async getProfileVersions(profileIdHash: SHA256IdHash<Profile>): Promise<ProfileVersion[]> {
    if (!this.deps.getAllVersions) {
      // Fallback: return just current version
      try {
        const result = await this.deps.getObjectByIdHash(profileIdHash);
        const traits = await this.getTraits(profileIdHash);
        const voice = await this.getVoice(profileIdHash);

        return [{
          versionHash: result.hash as SHA256Hash<Profile>,
          timestamp: Date.now(),
          traits: traits.length > 0 ? traits : undefined,
          hasVoice: voice !== null
        }];
      } catch {
        return [];
      }
    }

    try {
      const versions = await this.deps.getAllVersions(profileIdHash);

      const profileVersions: ProfileVersion[] = [];

      for (const version of versions) {
        const profile = version.obj as Profile;

        // Extract traits and voice from this version
        let traits: string[] = [];
        let hasVoice = false;

        if (profile.personDescription) {
          for (const hash of profile.personDescription) {
            try {
              const obj = await this.deps.getObject(hash as SHA256Hash<any>);
              if (obj?.$type$ === 'PersonTraits') {
                traits = (obj as PersonTraits).traits || [];
              } else if (obj?.$type$ === 'PersonVoice') {
                hasVoice = true;
              }
            } catch {
              continue;
            }
          }
        }

        profileVersions.push({
          versionHash: version.hash as SHA256Hash<Profile>,
          timestamp: version.timestamp || 0,
          traits: traits.length > 0 ? traits : undefined,
          hasVoice
        });
      }

      // Sort newest first
      profileVersions.sort((a, b) => b.timestamp - a.timestamp);

      return profileVersions;
    } catch (error) {
      console.error('[ProfileCharacterService] Failed to get profile versions:', error);
      return [];
    }
  }

  /**
   * Restore a previous Profile version by copying its personDescription
   * Creates a new version with the restored character data
   *
   * @param profileIdHash - Profile ID hash (current identity)
   * @param targetVersionHash - Version hash to restore from
   * @returns New profile version hash
   */
  async restoreProfileVersion(
    profileIdHash: SHA256IdHash<Profile>,
    targetVersionHash: SHA256Hash<Profile>
  ): Promise<SHA256Hash<Profile>> {
    // Get current profile (for non-character fields)
    const currentResult = await this.deps.getObjectByIdHash(profileIdHash);
    const currentProfile = currentResult.obj as Profile;

    // Get target version (for character fields)
    const targetProfile = await this.deps.getObject(targetVersionHash) as Profile;

    if (!targetProfile) {
      throw new Error(`[ProfileCharacterService] Target version not found: ${targetVersionHash}`);
    }

    // Create new version with restored personDescription
    const restoredProfile = {
      ...currentProfile,
      personDescription: targetProfile.personDescription || []
    };

    const storeResult = await this.deps.storeVersionedObject(restoredProfile);
    return storeResult.hash;
  }

  /**
   * Get combined character data for a Profile
   * Convenience method for UI to get all character info at once
   *
   * @param profileIdHash - Profile ID hash
   * @returns Object with traits and voice
   */
  async getCharacter(profileIdHash: SHA256IdHash<Profile>): Promise<{
    traits: string[];
    voice: PersonVoice | null;
  }> {
    const [traits, voice] = await Promise.all([
      this.getTraits(profileIdHash),
      this.getVoice(profileIdHash)
    ]);

    return { traits, voice };
  }

  /**
   * Update combined character data on a Profile
   * Creates a single new version with all changes
   *
   * @param profileIdHash - Profile ID hash
   * @param character - Object with optional traits and voice
   * @returns New profile version hash
   */
  async updateCharacter(
    profileIdHash: SHA256IdHash<Profile>,
    character: {
      traits?: string[];
      voice?: PersonVoice | null;  // null = remove voice
    }
  ): Promise<SHA256Hash<Profile>> {
    const result = await this.deps.getObjectByIdHash(profileIdHash);
    const profile = result.obj as Profile;

    // Build new personDescription
    const newPersonDescription: SHA256Hash<any>[] = [];

    // Copy existing non-character descriptions
    if (profile.personDescription) {
      for (const hash of profile.personDescription) {
        try {
          const obj = await this.deps.getObject(hash as SHA256Hash<any>);
          if (obj && obj.$type$ !== 'PersonTraits' && obj.$type$ !== 'PersonVoice') {
            newPersonDescription.push(hash as SHA256Hash<any>);
          }
        } catch {
          newPersonDescription.push(hash as SHA256Hash<any>);
        }
      }
    }

    // Add new traits if provided
    if (character.traits !== undefined && character.traits.length > 0) {
      const traitsObj: PersonTraits = {
        $type$: 'PersonTraits',
        traits: character.traits
      };
      const traitsResult = await this.deps.storeUnversionedObject(traitsObj);
      const traitsHash = typeof traitsResult === 'string' ? traitsResult : traitsResult.hash;
      newPersonDescription.push(traitsHash);
    }

    // Add new voice if provided (and not null)
    if (character.voice !== undefined && character.voice !== null) {
      const voiceResult = await this.deps.storeUnversionedObject(character.voice);
      const voiceHash = typeof voiceResult === 'string' ? voiceResult : voiceResult.hash;
      newPersonDescription.push(voiceHash);
    }

    // Create new profile version
    const updatedProfile = {
      ...profile,
      personDescription: newPersonDescription
    };

    const storeResult = await this.deps.storeVersionedObject(updatedProfile);
    return storeResult.hash;
  }
}
