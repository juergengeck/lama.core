/**
 * STTObjectManager (Platform-Agnostic)
 *
 * Creates and manages STT (Speech-to-Text/Whisper) model objects in ONE.core storage.
 * Stores model weights as blobs and tracks metadata via versioned STT objects.
 *
 * Works on both Node.js and browser platforms through ONE.core abstractions.
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, Instance, BLOB } from '@refinio/one.core/lib/recipes.js';

export type STTStatus = 'not_installed' | 'downloading' | 'installed' | 'loading' | 'ready' | 'error';

export interface STTObject {
    $type$: 'STT';
    name: string; // Model identifier (e.g., 'whisper-tiny')
    huggingFaceRepo: string;
    displayName?: string;
    modelType: 'local' | 'remote';
    sampleRate: number;
    languages?: string[];
    supportsTranslation?: boolean;
    status: STTStatus;
    sizeBytes?: number;
    downloadProgress?: number;
    errorMessage?: string;
    modelBlobs?: SHA256Hash<BLOB>[];
    blobMetadata?: string; // JSON: { [filename]: blobHash }
    provider?: string;
    architecture?: string;
    sizeVariant?: string;
    capabilities?: Array<'multilingual' | 'translation' | 'timestamps' | 'streaming'>;
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

export interface STTObjectManagerDeps {
    storeVersionedObject: (obj: any) => Promise<{ hash: SHA256Hash<any>; idHash: SHA256IdHash<any> }>;
    getObjectByIdHash: (idHash: SHA256IdHash<any>) => Promise<{ obj: any } | null>;
    storeArrayBufferAsBlob: (data: ArrayBuffer | Uint8Array) => Promise<{ hash: SHA256Hash<BLOB> }>;
    readBlobAsArrayBuffer: (hash: SHA256Hash<BLOB>) => Promise<ArrayBuffer>;
    queryAllSTTObjects?: () => AsyncIterable<STTObject>;
    getOwnerId: () => Promise<SHA256IdHash<Person>>;
}

interface CachedSTTObject extends STTObject {
    hash?: SHA256Hash<STTObject>;
    idHash?: SHA256IdHash<STTObject>;
}

export class STTObjectManager {
    private sttObjects: Map<string, CachedSTTObject>;
    private initialized: boolean;

    constructor(private deps: STTObjectManagerDeps) {
        this.sttObjects = new Map();
        this.initialized = false;
    }

    /**
     * Initialize the manager
     * Loads existing STT objects from storage
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('[STTObjectManager] Initializing - loading STT objects from storage');
        await this.loadSTTObjectsFromStorage();
        this.initialized = true;
    }

    /**
     * Load all STT objects from ONE.core storage
     */
    async loadSTTObjectsFromStorage(): Promise<number> {
        if (!this.deps.queryAllSTTObjects) {
            console.log('[STTObjectManager] queryAllSTTObjects not provided, skipping storage load');
            return 0;
        }

        try {
            const sttObjectsIterator = this.deps.queryAllSTTObjects();
            let loadedCount = 0;

            for await (const sttObject of sttObjectsIterator) {
                if (sttObject.name) {
                    this.sttObjects.set(sttObject.name, sttObject);
                    loadedCount++;
                    console.log(`[STTObjectManager] Loaded: ${sttObject.name} (status: ${sttObject.status})`);
                }
            }

            console.log(`[STTObjectManager] Loaded ${loadedCount} STT objects from storage`);
            return loadedCount;
        } catch (error) {
            console.error('[STTObjectManager] Failed to load STT objects from storage:', error);
            throw error;
        }
    }

    /**
     * Get STT object by model name
     */
    async getByName(name: string): Promise<STTObject | null> {
        return this.sttObjects.get(name) || null;
    }

    /**
     * Get all STT objects
     */
    getAllSTTObjects(): STTObject[] {
        return Array.from(this.sttObjects.values());
    }

    /**
     * Check if a model is installed (has blobs stored)
     */
    isInstalled(name: string): boolean {
        const obj = this.sttObjects.get(name);
        return obj?.status === 'installed' || obj?.status === 'ready';
    }

    /**
     * Create or update STT object for a model
     */
    async createOrUpdate(params: {
        name: string;
        huggingFaceRepo: string;
        displayName?: string;
        sampleRate: number;
        languages?: string[];
        supportsTranslation?: boolean;
        sizeBytes?: number;
        provider?: string;
        architecture?: string;
        sizeVariant?: string;
        capabilities?: Array<'multilingual' | 'translation' | 'timestamps' | 'streaming'>;
    }): Promise<CachedSTTObject> {
        const existing = this.sttObjects.get(params.name);
        const now = Date.now();
        const ownerId = await this.deps.getOwnerId();

        const sttObject: STTObject = {
            $type$: 'STT',
            name: params.name,
            huggingFaceRepo: params.huggingFaceRepo,
            displayName: params.displayName,
            modelType: 'local',
            sampleRate: params.sampleRate,
            languages: params.languages,
            supportsTranslation: params.supportsTranslation,
            status: existing?.status || 'not_installed',
            sizeBytes: params.sizeBytes,
            provider: params.provider || 'transformers.js',
            architecture: params.architecture,
            sizeVariant: params.sizeVariant,
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

        const result = await this.deps.storeVersionedObject(sttObject);

        const cached: CachedSTTObject = {
            ...sttObject,
            hash: result.hash,
            idHash: result.idHash,
        };

        this.sttObjects.set(params.name, cached);
        console.log(`[STTObjectManager] Created/updated STT object: ${params.name}`);

        return cached;
    }

    /**
     * Store model file as blob and update STT object
     */
    async storeModelBlob(
        name: string,
        filename: string,
        data: ArrayBuffer | Uint8Array
    ): Promise<SHA256Hash<BLOB>> {
        const existing = this.sttObjects.get(name);
        if (!existing) {
            throw new Error(`STT object not found: ${name}`);
        }

        // Store blob
        const blobResult = await this.deps.storeArrayBufferAsBlob(data);
        console.log(`[STTObjectManager] Stored blob for ${name}/${filename}: ${blobResult.hash.substring(0, 8)}...`);

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

        // Update STT object
        const now = Date.now();
        const updated: STTObject = {
            ...existing,
            modelBlobs: blobs,
            blobMetadata: JSON.stringify(metadata),
            modified: now,
        };

        const result = await this.deps.storeVersionedObject(updated);

        this.sttObjects.set(name, {
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
        const existing = this.sttObjects.get(name);
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
        const existing = this.sttObjects.get(name);
        if (!existing?.blobMetadata) {
            return null;
        }
        return JSON.parse(existing.blobMetadata);
    }

    /**
     * Update STT object status
     */
    async updateStatus(
        name: string,
        status: STTStatus,
        errorMessage?: string
    ): Promise<void> {
        const existing = this.sttObjects.get(name);
        if (!existing) {
            console.warn(`[STTObjectManager] Cannot update status - STT object not found: ${name}`);
            return;
        }

        const now = Date.now();
        const updated: STTObject = {
            ...existing,
            status,
            errorMessage: status === 'error' ? errorMessage : undefined,
            modified: now,
        };

        const result = await this.deps.storeVersionedObject(updated);

        this.sttObjects.set(name, {
            ...updated,
            hash: result.hash,
            idHash: result.idHash,
        });

        console.log(`[STTObjectManager] Updated status for ${name}: ${status}`);
    }

    /**
     * Update download progress
     */
    async updateDownloadProgress(name: string, progress: number): Promise<void> {
        const existing = this.sttObjects.get(name);
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
        const existing = this.sttObjects.get(name);
        if (!existing) {
            return;
        }

        const now = Date.now();
        const updated: STTObject = {
            ...existing,
            lastUsed: now,
            usageCount: (existing.usageCount || 0) + 1,
            modified: now,
        };

        const result = await this.deps.storeVersionedObject(updated);

        this.sttObjects.set(name, {
            ...updated,
            hash: result.hash,
            idHash: result.idHash,
        });
    }

    /**
     * Delete STT object (soft delete)
     */
    async delete(name: string): Promise<void> {
        const existing = this.sttObjects.get(name);
        if (!existing) {
            return;
        }

        const now = Date.now();
        const updated: STTObject = {
            ...existing,
            deleted: true,
            status: 'not_installed',
            modified: now,
        };

        await this.deps.storeVersionedObject(updated);
        this.sttObjects.delete(name);

        console.log(`[STTObjectManager] Deleted STT object: ${name}`);
    }
}
