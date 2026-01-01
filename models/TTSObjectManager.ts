/**
 * TTSObjectManager (Platform-Agnostic)
 *
 * Creates and manages TTS model objects in ONE.core storage using dependency injection.
 * Stores model weights as blobs and tracks metadata via versioned TTS objects.
 *
 * Works on both Node.js and browser platforms through ONE.core abstractions.
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, Instance, BLOB } from '@refinio/one.core/lib/recipes.js';

export type TTSStatus = 'not_installed' | 'downloading' | 'installed' | 'loading' | 'ready' | 'error';

export interface TTSObject {
    $type$: 'TTS';
    name: string; // Model identifier (e.g., 'chatterbox')
    huggingFaceRepo: string;
    displayName?: string;
    modelType: 'local' | 'remote';
    sampleRate: number;
    requiresReferenceAudio?: boolean;
    defaultVoiceUrl?: string;
    status: TTSStatus;
    sizeBytes?: number;
    downloadProgress?: number;
    errorMessage?: string;
    modelBlobs?: SHA256Hash<BLOB>[];
    blobMetadata?: string; // JSON: { [filename]: blobHash }
    provider?: string;
    architecture?: string;
    capabilities?: Array<'voice-cloning' | 'multilingual' | 'streaming'>;
    owner?: SHA256IdHash<Person> | SHA256IdHash<Instance>;
    created: number;
    modified: number;
    lastUsed?: number;
    usageCount?: number;
    deleted?: boolean;
}

export interface BlobMetadata {
    [filename: string]: string; // filename -> blob hash
}

export interface TTSObjectManagerDeps {
    storeVersionedObject: (obj: any) => Promise<{ hash: SHA256Hash<any>; idHash: SHA256IdHash<any> }>;
    getObjectByIdHash: (idHash: SHA256IdHash<any>) => Promise<{ obj: any } | null>;
    storeArrayBufferAsBlob: (data: ArrayBuffer | Uint8Array) => Promise<{ hash: SHA256Hash<BLOB> }>;
    readBlobAsArrayBuffer: (hash: SHA256Hash<BLOB>) => Promise<ArrayBuffer>;
    queryAllTTSObjects?: () => AsyncIterable<TTSObject>;
    getOwnerId: () => Promise<SHA256IdHash<Person>>;
}

interface CachedTTSObject extends TTSObject {
    hash?: SHA256Hash<TTSObject>;
    idHash?: SHA256IdHash<TTSObject>;
}

export class TTSObjectManager {
    private ttsObjects: Map<string, CachedTTSObject>;
    private initialized: boolean;

    constructor(private deps: TTSObjectManagerDeps) {
        this.ttsObjects = new Map();
        this.initialized = false;
    }

    /**
     * Initialize the manager
     * Loads existing TTS objects from storage
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('[TTSObjectManager] Initializing - loading TTS objects from storage');
        await this.loadTTSObjectsFromStorage();
        this.initialized = true;
    }

    /**
     * Load all TTS objects from ONE.core storage
     */
    async loadTTSObjectsFromStorage(): Promise<number> {
        if (!this.deps.queryAllTTSObjects) {
            console.log('[TTSObjectManager] queryAllTTSObjects not provided, skipping storage load');
            return 0;
        }

        try {
            const ttsObjectsIterator = this.deps.queryAllTTSObjects();
            let loadedCount = 0;

            for await (const ttsObject of ttsObjectsIterator) {
                if (ttsObject.name) {
                    this.ttsObjects.set(ttsObject.name, ttsObject);
                    loadedCount++;
                    console.log(`[TTSObjectManager] Loaded: ${ttsObject.name} (status: ${ttsObject.status})`);
                }
            }

            console.log(`[TTSObjectManager] Loaded ${loadedCount} TTS objects from storage`);
            return loadedCount;
        } catch (error) {
            console.error('[TTSObjectManager] Failed to load TTS objects from storage:', error);
            throw error;
        }
    }

    /**
     * Get TTS object by model name
     */
    async getByName(name: string): Promise<TTSObject | null> {
        return this.ttsObjects.get(name) || null;
    }

    /**
     * Get all TTS objects
     */
    getAllTTSObjects(): TTSObject[] {
        return Array.from(this.ttsObjects.values());
    }

    /**
     * Check if a model is installed (has blobs stored)
     */
    isInstalled(name: string): boolean {
        const obj = this.ttsObjects.get(name);
        return obj?.status === 'installed' || obj?.status === 'ready';
    }

    /**
     * Create or update TTS object for a model
     */
    async createOrUpdate(params: {
        name: string;
        huggingFaceRepo: string;
        displayName?: string;
        sampleRate: number;
        requiresReferenceAudio?: boolean;
        defaultVoiceUrl?: string;
        sizeBytes?: number;
        provider?: string;
        architecture?: string;
        capabilities?: Array<'voice-cloning' | 'multilingual' | 'streaming'>;
    }): Promise<CachedTTSObject> {
        const existing = this.ttsObjects.get(params.name);
        const now = Date.now();
        const ownerId = await this.deps.getOwnerId();

        const ttsObject: TTSObject = {
            $type$: 'TTS',
            name: params.name,
            huggingFaceRepo: params.huggingFaceRepo,
            displayName: params.displayName,
            modelType: 'local',
            sampleRate: params.sampleRate,
            requiresReferenceAudio: params.requiresReferenceAudio,
            defaultVoiceUrl: params.defaultVoiceUrl,
            status: existing?.status || 'not_installed',
            sizeBytes: params.sizeBytes,
            provider: params.provider || 'transformers.js',
            architecture: params.architecture,
            capabilities: params.capabilities,
            owner: ownerId,
            created: existing?.created || now,
            modified: now,
            lastUsed: existing?.lastUsed,
            usageCount: existing?.usageCount || 0,
            // Preserve blob references if they exist
            modelBlobs: existing?.modelBlobs,
            blobMetadata: existing?.blobMetadata,
        };

        const result = await this.deps.storeVersionedObject(ttsObject);

        const cached: CachedTTSObject = {
            ...ttsObject,
            hash: result.hash,
            idHash: result.idHash,
        };

        this.ttsObjects.set(params.name, cached);
        console.log(`[TTSObjectManager] Created/updated TTS object: ${params.name}`);

        return cached;
    }

    /**
     * Store model file as blob and update TTS object
     */
    async storeModelBlob(
        name: string,
        filename: string,
        data: ArrayBuffer | Uint8Array
    ): Promise<SHA256Hash<BLOB>> {
        const existing = this.ttsObjects.get(name);
        if (!existing) {
            throw new Error(`TTS object not found: ${name}`);
        }

        // Store blob
        const blobResult = await this.deps.storeArrayBufferAsBlob(data);
        console.log(`[TTSObjectManager] Stored blob for ${name}/${filename}: ${blobResult.hash.substring(0, 8)}...`);

        // Update blob metadata
        const metadata: BlobMetadata = existing.blobMetadata
            ? JSON.parse(existing.blobMetadata)
            : {};
        metadata[filename] = blobResult.hash;

        // Update blob array
        const blobs = existing.modelBlobs || [];
        if (!blobs.includes(blobResult.hash)) {
            blobs.push(blobResult.hash);
        }

        // Update TTS object - strip cached hash/idHash before storing
        const now = Date.now();
        const { hash: _h, idHash: _ih, ...baseObj } = existing;
        const updated: TTSObject = {
            ...baseObj,
            modelBlobs: blobs,
            blobMetadata: JSON.stringify(metadata),
            modified: now,
        };

        const result = await this.deps.storeVersionedObject(updated);

        this.ttsObjects.set(name, {
            ...updated,
            hash: result.hash,
            idHash: result.idHash,
        });

        return blobResult.hash;
    }

    /**
     * Get blob data for a model file
     */
    async getModelBlob(name: string, filename: string): Promise<ArrayBuffer | null> {
        const existing = this.ttsObjects.get(name);
        if (!existing?.blobMetadata) {
            return null;
        }

        const metadata: BlobMetadata = JSON.parse(existing.blobMetadata);
        const blobHash = metadata[filename];
        if (!blobHash) {
            return null;
        }

        return this.deps.readBlobAsArrayBuffer(blobHash as SHA256Hash<BLOB>);
    }

    /**
     * Get all blob metadata for a model
     */
    getBlobMetadata(name: string): BlobMetadata | null {
        const existing = this.ttsObjects.get(name);
        if (!existing?.blobMetadata) {
            return null;
        }
        return JSON.parse(existing.blobMetadata);
    }

    /**
     * Update TTS object status
     */
    async updateStatus(
        name: string,
        status: TTSStatus,
        errorMessage?: string
    ): Promise<void> {
        const existing = this.ttsObjects.get(name);
        if (!existing) {
            console.warn(`[TTSObjectManager] Cannot update status - TTS object not found: ${name}`);
            return;
        }

        const now = Date.now();
        // Strip cached hash/idHash before storing (not part of TTS recipe)
        const { hash: _h, idHash: _ih, ...baseObj } = existing;
        const updated: TTSObject = {
            ...baseObj,
            status,
            errorMessage: status === 'error' ? errorMessage : undefined,
            modified: now,
        };

        const result = await this.deps.storeVersionedObject(updated);

        this.ttsObjects.set(name, {
            ...updated,
            hash: result.hash,
            idHash: result.idHash,
        });

        console.log(`[TTSObjectManager] Updated status for ${name}: ${status}`);
    }

    /**
     * Update download progress
     */
    async updateDownloadProgress(name: string, progress: number): Promise<void> {
        const existing = this.ttsObjects.get(name);
        if (!existing) {
            return;
        }

        // Only update in-memory, don't persist every progress update
        existing.downloadProgress = progress;
        existing.status = 'downloading';
    }

    /**
     * Mark model as used (update lastUsed and usageCount)
     */
    async markUsed(name: string): Promise<void> {
        const existing = this.ttsObjects.get(name);
        if (!existing) {
            return;
        }

        // Strip cached hash/idHash before storing
        const now = Date.now();
        const { hash: _h, idHash: _ih, ...baseObj } = existing;
        const updated: TTSObject = {
            ...baseObj,
            lastUsed: now,
            usageCount: (existing.usageCount || 0) + 1,
            modified: now,
        };

        const result = await this.deps.storeVersionedObject(updated);

        this.ttsObjects.set(name, {
            ...updated,
            hash: result.hash,
            idHash: result.idHash,
        });
    }

    /**
     * Delete TTS object (soft delete)
     */
    async delete(name: string): Promise<void> {
        const existing = this.ttsObjects.get(name);
        if (!existing) {
            return;
        }

        // Strip cached hash/idHash before storing
        const now = Date.now();
        const { hash: _h, idHash: _ih, ...baseObj } = existing;
        const updated: TTSObject = {
            ...baseObj,
            deleted: true,
            status: 'not_installed',
            modified: now,
        };

        await this.deps.storeVersionedObject(updated);
        this.ttsObjects.delete(name);

        console.log(`[TTSObjectManager] Deleted TTS object: ${name}`);
    }
}
