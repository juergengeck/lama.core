/**
 * WordCloudSettingsManager
 *
 * Manages word cloud visualization settings using ONE.core storage,
 * following the same pattern as LLMSettingsManager in the LAMA reference implementation
 */

import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js'
import { hasRecipe, getRecipe, getKnownTypes } from '@refinio/one.core/lib/object-recipes.js'

/**
 * Default settings for word cloud visualization
 */
export const DEFAULT_WORD_CLOUD_SETTINGS = {
    maxWordsPerSubject: 20,
    relatedWordThreshold: 0.3,
    minWordFrequency: 2,
    showSummaryKeywords: true,
    fontScaleMin: 0.8,
    fontScaleMax: 2.5,
    colorScheme: 'viridis',
    layoutDensity: 'medium'
}

/**
 * WordCloudSettings type
 * This must match EXACTLY the recipe definition in WordCloudSettingsRecipe.js
 */
export function createWordCloudSettings(creatorId: any): any {
    const now = Date.now()

    return {
        $type$: 'WordCloudSettings',
        creator: creatorId,
        created: now,
        modified: now,
        maxWordsPerSubject: DEFAULT_WORD_CLOUD_SETTINGS.maxWordsPerSubject,
        relatedWordThreshold: DEFAULT_WORD_CLOUD_SETTINGS.relatedWordThreshold,
        minWordFrequency: DEFAULT_WORD_CLOUD_SETTINGS.minWordFrequency,
        showSummaryKeywords: DEFAULT_WORD_CLOUD_SETTINGS.showSummaryKeywords,
        fontScaleMin: DEFAULT_WORD_CLOUD_SETTINGS.fontScaleMin,
        fontScaleMax: DEFAULT_WORD_CLOUD_SETTINGS.fontScaleMax,
        colorScheme: DEFAULT_WORD_CLOUD_SETTINGS.colorScheme,
        layoutDensity: DEFAULT_WORD_CLOUD_SETTINGS.layoutDensity
    }
}

/**
 * Type guard for WordCloudSettings
 */
function isWordCloudSettings(obj: any): any {
    return (
        obj &&
        obj.$type$ === 'WordCloudSettings' &&
        typeof obj.creator === 'string' && obj.creator.length === 64 &&  // SHA256 hash is 64 chars
        typeof obj.created === 'number' &&
        typeof obj.modified === 'number' &&
        typeof obj.maxWordsPerSubject === 'number' &&
        typeof obj.relatedWordThreshold === 'number' &&
        typeof obj.minWordFrequency === 'number' &&
        typeof obj.showSummaryKeywords === 'boolean' &&
        typeof obj.fontScaleMin === 'number' &&
        typeof obj.fontScaleMax === 'number' &&
        typeof obj.colorScheme === 'string' &&
        typeof obj.layoutDensity === 'string'
    )
}

/**
 * WordCloudSettingsManager
 */
export class WordCloudSettingsManager {
    static instance = null
    settingsIdHash = null

    /**
     * Get the singleton instance
     */
    static getInstance() {
        if (!WordCloudSettingsManager.instance) {
            WordCloudSettingsManager.instance = new WordCloudSettingsManager()
        }
        return WordCloudSettingsManager.instance
    }

    /**
     * Get word cloud settings
     */
    async getSettings(creatorId: any): Promise<any> {
        try {
            // If we have a cached idHash, use it to retrieve the settings
            if (this.settingsIdHash) {
                try {
                    const result = await getObjectByIdHash(this.settingsIdHash)

                    if (isWordCloudSettings(result.obj)) {
                        return result.obj
                    } else {
                        console.warn('[WordCloudSettingsManager] Retrieved settings object is invalid, creating new settings')
                        this.settingsIdHash = null
                    }
                } catch (error) {
                    console.warn('[WordCloudSettingsManager] Failed to get settings with cached idHash, creating new settings')
                }
            }

            // Create default settings
            const defaultSettings = createWordCloudSettings(creatorId)

            // Verify the recipe exists before storing
            if (!hasRecipe('WordCloudSettings')) {
                console.error('[WordCloudSettingsManager] Recipe for WordCloudSettings not found, cannot store settings')
                return defaultSettings // Return without storing
            }

            // Store the settings (one.core will validate)
            const result = await storeVersionedObject(defaultSettings)

            // Cache the idHash
            this.settingsIdHash = result.idHash

            // Validate the stored object
            if (isWordCloudSettings(result.obj)) {
                return result.obj
            } else {
                console.error('[WordCloudSettingsManager] Stored settings object is invalid, returning default settings')
                return defaultSettings
            }
        } catch (error) {
            console.error('[WordCloudSettingsManager] Error getting settings:', error)

            // Add diagnostic logging
            try {
                if (hasRecipe('WordCloudSettings')) {
                    const recipe = getRecipe('WordCloudSettings')
                    console.log('[WordCloudSettingsManager] FOUND WordCloudSettings Recipe:',
                        JSON.stringify(recipe, null, 2))
                } else {
                    console.error('[WordCloudSettingsManager] WordCloudSettings Recipe NOT FOUND in runtime registry!')

                    const knownTypes = getKnownTypes()
                    console.log('[WordCloudSettingsManager] All registered recipe types:',
                        knownTypes.sort().join(', '))
                }
            } catch (recipeError: any) {
                console.error('[WordCloudSettingsManager] Error inspecting recipes:', recipeError)
            }

            // Return default settings without storing them
            return createWordCloudSettings(creatorId)
        }
    }

    /**
     * Update word cloud settings
     */
    async updateSettings(creatorId: any, updates: any): Promise<any> {
        try {
            // Get current settings
            const currentSettings = await this.getSettings(creatorId)

            // Create updated settings
            const updatedSettings = {
                ...currentSettings,
                ...updates,
                modified: Date.now()
            }

            // Store the updated settings
            const result = await storeVersionedObject(updatedSettings)

            // Cache the idHash
            this.settingsIdHash = result.idHash

            return result.obj
        } catch (error) {
            console.error('[WordCloudSettingsManager] Error updating settings:', error)
            throw error
        }
    }
}

// Export singleton instance
export const wordCloudSettingsManager = WordCloudSettingsManager.getInstance()