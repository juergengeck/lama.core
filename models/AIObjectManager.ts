/**
 * AIObjectManager (Platform-Agnostic)
 *
 * Creates and manages AI storage objects in ONE.core storage using dependency injection.
 * Links AI Person IDs to LLM Person IDs via versioned AI objects.
 *
 * Works on both Node.js and browser platforms through ONE.core abstractions.
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import { ensureIdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';

export interface AIObject {
    $type$: 'AI';
    aiId: string;
    displayName: string;
    personId: SHA256IdHash<Person>;
    llmId?: SHA256IdHash<any>;  // Optional LLM ID; undefined = use app default
    modelId: string;
    owner: SHA256IdHash<Person>;
    created: number;
    modified: number;
    active: boolean;
    deleted: boolean;
}

export interface AIObjectManagerDeps {
    storeVersionedObject: (obj: any) => Promise<any>;
    createAccess?: (accessRequests: any[]) => Promise<void>;
    getOwnerId: () => Promise<SHA256IdHash<Person>>;
}

interface CachedAIObject extends AIObject {
    hash?: SHA256Hash<any>;
    idHash?: SHA256IdHash<any>;
    cached?: boolean;
}

export class AIObjectManager {
    private aiObjects: Map<string, CachedAIObject>;
    private initialized: boolean;
    private federationGroupIdHash?: SHA256IdHash<any>;

    constructor(
        private deps: AIObjectManagerDeps,
        federationGroupIdHash?: SHA256IdHash<any>
    ) {
        this.aiObjects = new Map();
        this.initialized = false;
        this.federationGroupIdHash = federationGroupIdHash;
    }

    /**
     * Initialize the manager
     * Loads existing AI objects from storage
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('[AIObjectManager] Initializing - loading AI objects from storage');
        await this.loadAIObjectsFromStorage();
        this.initialized = true;
    }

    /**
     * Load all AI objects from ONE.core storage
     * Note: AI loading is now handled by AIManager via AIList pattern
     * This method remains for API compatibility but returns 0
     */
    async loadAIObjectsFromStorage(): Promise<number> {
        console.log('[AIObjectManager] loadAIObjectsFromStorage - AI loading now handled by AIManager via AIList');
        return 0;
    }

    /**
     * Create AI storage object for an AI Person
     */
    async create(params: {
        aiId: string;
        displayName: string;
        aiPersonId: SHA256IdHash<Person>;
        llmId?: SHA256IdHash<any>;  // Optional LLM ID; undefined = use app default
        modelId: string;
    }): Promise<void> {
        const { aiId, displayName, aiPersonId, llmId, modelId } = params;

        console.log(`[AIObjectManager] Creating AI object for ${displayName} (${aiId})`);

        // Check cache first
        if (this.aiObjects.has(aiId)) {
            console.log(`[AIObjectManager] AI object already exists for ${aiId}, using cached version`);
            return;
        }

        // Get owner ID for the AI object
        const ownerId = await this.deps.getOwnerId();

        const now = Date.now();
        const aiObject: AIObject = {
            $type$: 'AI',
            aiId,
            displayName,
            personId: ensureIdHash(aiPersonId),
            llmId: llmId ? ensureIdHash(llmId) : undefined,
            modelId,
            owner: ownerId,
            created: now,
            modified: now,
            active: true,
            deleted: false,
        };

        // Store in ONE.core
        console.log(`[AIObjectManager] 💾 STORING AI:`, {
            type: aiObject.$type$,
            aiId: aiObject.aiId,
            personId: aiObject.personId?.toString().substring(0,8),
            llmId: aiObject.llmId?.toString().substring(0,8)
        });
        const result = await this.deps.storeVersionedObject(aiObject);
        console.log(`[AIObjectManager] ✅ STORED - hash: ${result.hash?.toString().substring(0,8)}, idHash: ${result.idHash?.toString().substring(0,8)}`);

        // Cache the object
        this.aiObjects.set(aiId, {
            ...aiObject,
            hash: result.hash,
            idHash: result.idHash,
        });

        // Grant federation access if available
        if (this.federationGroupIdHash && this.deps.createAccess) {
            await this.grantFederationAccess(result.idHash);
        }
    }

    /**
     * Get AI object by aiId
     */
    async getByAIId(aiId: string): Promise<AIObject | null> {
        return this.aiObjects.get(aiId) || null;
    }

    /**
     * Get all AI objects
     */
    getAllAIObjects(): AIObject[] {
        return Array.from(this.aiObjects.values());
    }

    /**
     * Check if a personId belongs to an AI
     */
    isAIPerson(personId: SHA256IdHash<Person>): boolean {
        if (!personId) return false;
        const personIdStr = personId.toString();

        const isAI = Array.from(this.aiObjects.values()).some(
            (ai) => ai.personId && ai.personId.toString() === personIdStr
        );

        return isAI;
    }

    /**
     * Get AI ID for a person ID (reverse lookup)
     */
    getAIIdForPersonId(personId: SHA256IdHash<Person>): string | null {
        if (!personId) return null;
        const personIdStr = personId.toString();

        for (const [aiId, aiObj] of this.aiObjects) {
            if (aiObj.personId && aiObj.personId.toString() === personIdStr) {
                return aiId;
            }
        }

        return null;
    }

    /**
     * Get LLM ID for an AI Person ID
     */
    getLLMIdForAIPerson(aiPersonId: SHA256IdHash<Person>): SHA256IdHash<any> | null {
        if (!aiPersonId) return null;
        const personIdStr = aiPersonId.toString();

        for (const aiObj of this.aiObjects.values()) {
            if (aiObj.personId && aiObj.personId.toString() === personIdStr) {
                return aiObj.llmId || null;
            }
        }

        return null;
    }

    /**
     * Grant federation access to AI object
     */
    private async grantFederationAccess(aiIdHash: SHA256IdHash<any>): Promise<void> {
        if (!this.federationGroupIdHash || !this.deps.createAccess) {
            console.warn('[AIObjectManager] Federation access not available');
            return;
        }

        try {
            await this.deps.createAccess([
                {
                    id: aiIdHash,
                    person: [],
                    group: [this.federationGroupIdHash],
                    mode: 'ADD' as any, // SET_ACCESS_MODE.ADD
                },
            ]);

            console.log(
                `[AIObjectManager] Granted federation access to AI object: ${aiIdHash.toString().substring(0, 8)}...`
            );
        } catch (error) {
            console.error('[AIObjectManager] Failed to grant federation access:', error);
        }
    }
}
