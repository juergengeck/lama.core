/**
 * GlobalLLMSettingsManager (Platform-Agnostic)
 *
 * Manages global LLM settings using Person ID as the ID field.
 * NO QUERIES - direct retrieval via getObjectByIdHash().
 *
 * Pattern from mobile app (./lama):
 * 1. Use creator (Person ID) as ID field
 * 2. Calculate ID hash from {$type$, creator}
 * 3. Retrieve directly via getObjectByIdHash()
 * 4. Cache the idHash for subsequent retrievals
 * 5. If not found, create defaults
 *
 * NO FUCKING QUERIES.
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { GlobalLLMSettings } from '@OneObjectInterfaces';

export const DEFAULT_LLM_SETTINGS = {
    temperature: 0.5,
    maxTokens: 2048,
    enableAutoSummary: false,
    enableAutoResponse: false,
    defaultPrompt: "You are a helpful and friendly AI assistant."
};

export interface GlobalLLMSettingsManagerDeps {
    storeVersionedObject: (obj: any) => Promise<any>;
    getObjectByIdHash: (idHash: SHA256IdHash<any>) => Promise<any>;
    calculateIdHashOfObj: (obj: any) => Promise<SHA256IdHash<any>>;
}

/**
 * GlobalLLMSettingsManager
 * Platform-agnostic settings manager using dependency injection
 */
export class GlobalLLMSettingsManager {
    private cachedIdHash?: SHA256IdHash<GlobalLLMSettings>;
    private cachedSettings?: GlobalLLMSettings;

    constructor(
        private deps: GlobalLLMSettingsManagerDeps,
        private creatorId: SHA256IdHash<Person>
    ) {}

    /**
     * Get global settings with direct retrieval (NO QUERIES)
     *
     * Performance:
     * - Cache hit: <1ms
     * - Cache miss with idHash: ~15ms (direct retrieval)
     * - First time: ~30ms (calculate idHash + retrieve + create defaults)
     */
    async getSettings(): Promise<GlobalLLMSettings> {
        // Memory cache hit
        if (this.cachedSettings) {
            return this.cachedSettings;
        }

        // Have idHash cached - retrieve directly
        if (this.cachedIdHash) {
            try {
                const result = await this.deps.getObjectByIdHash(this.cachedIdHash);
                this.cachedSettings = result.obj as GlobalLLMSettings;
                return this.cachedSettings;
            } catch (error) {
                // Not found or corrupted - clear cache and create defaults
                this.cachedIdHash = undefined;
            }
        }

        // Calculate idHash from creator ID (only ID properties)
        const idHash = await this.deps.calculateIdHashOfObj({
            $type$: 'GlobalLLMSettings' as const,
            creator: this.creatorId
        });

        this.cachedIdHash = idHash;

        // Try to retrieve existing settings
        try {
            const result = await this.deps.getObjectByIdHash(idHash);
            this.cachedSettings = result.obj as GlobalLLMSettings;
            return this.cachedSettings;
        } catch (error: any) {
            // Not found - create defaults
            if (error.message?.includes('not found') || error.code === 'NOT_FOUND') {
                return await this.createDefaultSettings();
            }
            throw error;
        }
    }

    /**
     * Update global settings
     * Creates new version, invalidates cache
     */
    async updateSettings(
        updates: Partial<Omit<GlobalLLMSettings, '$type$' | 'creator' | 'created' | 'modified'>>
    ): Promise<GlobalLLMSettings> {
        const current = await this.getSettings();

        const updated: GlobalLLMSettings = {
            ...current,
            ...updates,
            modified: Date.now()
        };

        const result = await this.deps.storeVersionedObject(updated);

        // Invalidate memory cache (idHash stays valid)
        this.cachedSettings = undefined;

        return result.obj as GlobalLLMSettings;
    }

    /**
     * Set default model ID
     */
    async setDefaultModelId(modelId: string | null): Promise<GlobalLLMSettings> {
        return await this.updateSettings({
            defaultModelId: modelId ?? undefined
        });
    }

    /**
     * Get default model ID
     */
    async getDefaultModelId(): Promise<string | null> {
        const settings = await this.getSettings();
        return settings.defaultModelId ?? null;
    }

    /**
     * Create default settings for first-time users
     */
    private async createDefaultSettings(): Promise<GlobalLLMSettings> {
        const now = Date.now();

        const settings: GlobalLLMSettings = {
            $type$: 'GlobalLLMSettings',
            creator: this.creatorId,
            created: now,
            modified: now,
            ...DEFAULT_LLM_SETTINGS
        };

        const result = await this.deps.storeVersionedObject(settings);
        this.cachedSettings = result.obj as GlobalLLMSettings;

        return this.cachedSettings;
    }

    /**
     * Clear memory cache (force reload on next access)
     */
    clearCache(): void {
        this.cachedSettings = undefined;
        // Keep idHash - it's still valid
    }
}
