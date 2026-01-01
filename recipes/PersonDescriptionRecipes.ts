/**
 * Person Description Recipes for ONE.core
 *
 * Defines schemas for person description objects that can be linked
 * from Profile.personDescription. These apply to any contact (human or AI).
 *
 * Objects are stored as unversioned (content-addressed by hash) and
 * referenced from Profile.personDescription array.
 */

/**
 * PersonTraits - Personality traits for a person
 *
 * Usage: Store via storeUnversionedObject, add hash to Profile.personDescription
 *
 * Example:
 *   const traits = { $type$: 'PersonTraits', traits: ['curious', 'concise'] };
 *   const { hash } = await storeUnversionedObject(traits);
 *   profile.personDescription.push(hash);
 */
export const PersonTraitsRecipe = {
    $type$: 'Recipe' as const,
    name: 'PersonTraits',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^PersonTraits$/ }
        },
        {
            itemprop: 'traits',
            itemtype: {
                type: 'bag',
                item: { type: 'string' }
            }
        }
    ]
};

/**
 * PersonVoice - TTS voice settings for a person
 *
 * Configures how this person's messages should sound when read aloud.
 * References a system-wide voice by ID and allows per-person overrides.
 *
 * Usage: Store via storeUnversionedObject, add hash to Profile.personDescription
 */
export const PersonVoiceRecipe = {
    $type$: 'Recipe' as const,
    name: 'PersonVoice',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^PersonVoice$/ }
        },
        {
            itemprop: 'baseVoiceId',
            itemtype: { type: 'string' }  // Reference to system voice (e.g., "kokoro")
        },
        {
            itemprop: 'speed',
            itemtype: { type: 'number' },  // 0.5-2.0, default 1.0
            optional: true
        },
        {
            itemprop: 'pitch',
            itemtype: { type: 'number' },  // 0.5-2.0, default 1.0
            optional: true
        }
    ]
};

/**
 * TypeScript interfaces for the recipe objects
 */
export interface PersonTraits {
    $type$: 'PersonTraits';
    traits: string[];
}

export interface PersonVoice {
    $type$: 'PersonVoice';
    baseVoiceId: string;
    speed?: number;
    pitch?: number;
}
