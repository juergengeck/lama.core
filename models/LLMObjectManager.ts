/**
 * LLMObjectManager (Platform-Agnostic)
 *
 * Creates and manages LLM objects in ONE.core storage using dependency injection.
 * Links Person IDs to LLM models via versioned LLM objects.
 *
 * Works on both Node.js and browser platforms through ONE.core abstractions.
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import { ensureIdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';

export interface LLMObject {
    $type$: 'LLM';
    modelId: string;
    name: string;
    filename: string;
    modelType: 'local' | 'remote';
    active: boolean;
    deleted: boolean;
    created: number;
    modified: number;
    createdAt: string;
    lastUsed: string;
    personId?: SHA256IdHash<Person>;
    provider?: string;
    capabilities?: Array<'chat' | 'inference'>;
    maxTokens?: number;
    temperature?: number;
    contextSize?: number;
    batchSize?: number;
    threads?: number;
}

export interface LLMObjectManagerDeps {
    storeVersionedObject: (obj: any) => Promise<any>;
    createAccess?: (accessRequests: any[]) => Promise<void>;
    queryAllLLMObjects?: () => AsyncIterable<LLMObject>;
}

interface CachedLLMObject extends LLMObject {
    hash?: SHA256Hash<LLMObject>;
    idHash?: SHA256IdHash<LLMObject>;
    isAI?: boolean;
    cached?: boolean;
}

export class LLMObjectManager {
    private llmObjects: Map<string, CachedLLMObject>;
    private initialized: boolean;
    private federationGroupIdHash?: SHA256IdHash<any>;

    constructor(
        private deps: LLMObjectManagerDeps,
        federationGroupIdHash?: SHA256IdHash<any>
    ) {
        this.llmObjects = new Map();
        this.initialized = false;
        this.federationGroupIdHash = federationGroupIdHash;
    }

    /**
     * Initialize the manager
     * Loads existing LLM objects from storage
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('[LLMObjectManager] Initializing - loading LLM objects from storage');
        await this.loadLLMObjectsFromStorage();
        this.initialized = true;
    }

    /**
     * Load all LLM objects from ONE.core storage
     * This is the source of truth for modelId ↔ personId mappings
     */
    async loadLLMObjectsFromStorage(): Promise<number> {
        if (!this.deps.queryAllLLMObjects) {
            console.log('[LLMObjectManager] queryAllLLMObjects not provided, skipping storage load');
            return 0;
        }

        try {
            console.log('[LLMObjectManager] Loading LLM objects from storage...');
            const llmObjectsIterator = this.deps.queryAllLLMObjects();

            let loadedCount = 0;
            for await (const llmObject of llmObjectsIterator) {
                // Only cache LLM objects that have a personId (AI contacts)
                if (llmObject.personId && llmObject.modelId) {
                    this.llmObjects.set(llmObject.modelId, {
                        ...llmObject,
                        isAI: true,
                    });
                    loadedCount++;
                    console.log(
                        `[LLMObjectManager] ✅ Loaded AI LLM: ${llmObject.modelId} (person: ${llmObject.personId.toString().substring(0, 8)}...)`
                    );
                }
            }

            console.log(`[LLMObjectManager] ✅ Loaded ${loadedCount} AI LLM objects from storage`);
            return loadedCount;
        } catch (error) {
            console.error('[LLMObjectManager] Failed to load LLM objects from storage:', error);
            throw error;
        }
    }

    /**
     * Create LLM object for an AI model
     * Matches the interface expected by AIContactManager
     */
    async create(params: {
        modelId: string;
        name: string;
        aiPersonId: SHA256IdHash<Person>;
    }): Promise<void> {
        const { modelId, name, aiPersonId } = params;

        console.log(`[LLMObjectManager] Creating LLM object for ${name}`);

        // Check cache first
        if (this.llmObjects.has(modelId)) {
            console.log(`[LLMObjectManager] LLM object already exists for ${name}, using cached version`);
            return;
        }

        // Create LLM object following LLMRecipe schema
        const now = Date.now();
        const nowISOString = new Date().toISOString();

        const llmObject: LLMObject = {
            $type$: 'LLM',
            modelId,
            name, // This is the ID field (isId: true in recipe)
            filename: `${name.replace(/[\s:]/g, '-').toLowerCase()}.gguf`,
            modelType: modelId.startsWith('ollama:') ? 'local' : 'remote',
            active: true,
            deleted: false,
            created: now,
            modified: now,
            createdAt: nowISOString,
            lastUsed: nowISOString,
            personId: ensureIdHash(aiPersonId),
            provider: this.getProviderFromModelId(modelId),
            capabilities: ['chat', 'inference'],
            maxTokens: 4096,
            temperature: 0.7,
            contextSize: 4096,
            batchSize: 512,
            threads: 4,
        };

        // Store in ONE.core
        const result = await this.deps.storeVersionedObject(llmObject);
        console.log(`[LLMObjectManager] Stored LLM object with hash: ${result.hash}`);

        // Cache the object
        this.llmObjects.set(modelId, {
            ...llmObject,
            hash: result.hash,
            idHash: result.idHash,
            isAI: true,
        });

        // Grant federation access if available
        if (this.federationGroupIdHash && this.deps.createAccess) {
            await this.grantFederationAccess(result.idHash);
        }
    }

    /**
     * Get LLM object by modelId
     * Matches the interface expected by AIContactManager
     */
    async getByModelId(modelId: string): Promise<LLMObject | null> {
        return this.llmObjects.get(modelId) || null;
    }

    /**
     * Get all LLM objects
     */
    getAllLLMObjects(): LLMObject[] {
        return Array.from(this.llmObjects.values());
    }

    /**
     * Check if a personId belongs to an AI
     */
    isLLMPerson(personId: SHA256IdHash<Person>): boolean {
        if (!personId) return false;
        const personIdStr = personId.toString();

        console.log(
            `[LLMObjectManager] Checking if ${personIdStr.substring(0, 8)}... is LLM, cache has ${
                this.llmObjects.size
            } entries`
        );

        const isLLM = Array.from(this.llmObjects.values()).some(
            (llm) => llm.personId && llm.personId.toString() === personIdStr
        );

        console.log(
            `[LLMObjectManager] Result: ${personIdStr.substring(0, 8)}... is AI: ${isLLM}${
                isLLM ? ' (cached)' : ''
            }`
        );

        return isLLM;
    }

    /**
     * Get model ID for a person ID (reverse lookup)
     */
    getModelIdForPersonId(personId: SHA256IdHash<Person>): string | null {
        if (!personId) return null;
        const personIdStr = personId.toString();

        for (const [modelId, llmObj] of this.llmObjects) {
            if (llmObj.personId && llmObj.personId.toString() === personIdStr) {
                console.log(
                    `[LLMObjectManager] Found model ${modelId} for person ${personIdStr.substring(0, 8)}...`
                );
                return modelId;
            }
        }

        console.log(`[LLMObjectManager] No model found for person ${personIdStr.substring(0, 8)}...`);
        return null;
    }

    /**
     * Cache AI person ID without creating LLM object
     * Used when AI contacts already exist
     */
    cacheAIPersonId(modelId: string, personId: SHA256IdHash<Person>): void {
        if (!this.llmObjects.has(modelId)) {
            this.llmObjects.set(modelId, {
                $type$: 'LLM',
                modelId,
                name: modelId,
                filename: '',
                modelType: 'local',
                active: true,
                deleted: false,
                created: Date.now(),
                modified: Date.now(),
                createdAt: new Date().toISOString(),
                lastUsed: new Date().toISOString(),
                personId,
                isAI: true,
                cached: true,
            });
            console.log(
                `[LLMObjectManager] Cached AI person ${personId.toString().substring(0, 8)}... for model ${modelId}`
            );
        }
    }

    /**
     * Grant federation access to LLM object
     */
    private async grantFederationAccess(llmIdHash: SHA256IdHash<LLMObject>): Promise<void> {
        if (!this.federationGroupIdHash || !this.deps.createAccess) {
            console.warn('[LLMObjectManager] Federation access not available');
            return;
        }

        try {
            await this.deps.createAccess([
                {
                    id: llmIdHash,
                    person: [],
                    group: [this.federationGroupIdHash],
                    mode: 'ADD' as any, // SET_ACCESS_MODE.ADD
                },
            ]);

            console.log(
                `[LLMObjectManager] Granted federation access to LLM object: ${llmIdHash.toString().substring(0, 8)}...`
            );
        } catch (error) {
            console.error('[LLMObjectManager] Failed to grant federation access:', error);
        }
    }

    /**
     * Extract provider from model ID
     */
    private getProviderFromModelId(modelId: string): string {
        if (modelId.startsWith('ollama:')) return 'ollama';
        if (modelId.startsWith('claude:')) return 'claude';
        if (modelId.startsWith('gpt:')) return 'openai';
        return 'unknown';
    }
}
