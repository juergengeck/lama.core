/**
 * MeaningPlan - Platform-agnostic plan for semantic similarity operations
 *
 * Wraps meaning.core's MeaningDimension to provide a clean interface for
 * semantic search, indexing, and similarity queries via MCP.
 *
 * This is a dimension plan - meaning is a dimension like time or space.
 * Closeness in meaning space = semantic similarity.
 */

import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

// Types will be resolved at runtime from meaning.core
export type MeaningDimension = any;
export type EmbeddingProvider = any;
export type MeaningQueryResult = any;

// ============================================================================
// Request/Response Types
// ============================================================================

export interface IndexTextRequest {
    /** Hash of the object to index */
    objectHash: string;
    /** Text content to embed and index */
    text: string;
}

export interface IndexTextResponse {
    success: boolean;
    /** Hash of the created MeaningDimensionValue */
    dimensionValueHash?: string;
    error?: string;
}

export interface IndexEmbeddingRequest {
    /** Hash of the object to index */
    objectHash: string;
    /** Pre-computed embedding vector */
    embedding: number[];
    /** Optional source text for re-embedding */
    sourceText?: string;
}

export interface IndexEmbeddingResponse {
    success: boolean;
    dimensionValueHash?: string;
    error?: string;
}

export interface QueryByTextRequest {
    /** Text to find similar content for */
    text: string;
    /** Number of results to return */
    k?: number;
    /** Minimum similarity threshold (0-1) */
    threshold?: number;
}

export interface QueryByTextResponse {
    success: boolean;
    results?: Array<{
        objectHash: string;
        similarity: number;
    }>;
    error?: string;
}

export interface QueryByEmbeddingRequest {
    /** Embedding vector to search with */
    embedding: number[];
    /** Number of results to return */
    k?: number;
    /** Minimum similarity threshold (0-1) */
    threshold?: number;
}

export interface QueryByEmbeddingResponse {
    success: boolean;
    results?: Array<{
        objectHash: string;
        meaningNodeHash: string;
        similarity: number;
    }>;
    error?: string;
}

export interface GetSimilarRequest {
    /** Hash of object to find similar items for */
    objectHash: string;
    /** Number of results to return */
    k?: number;
    /** Minimum similarity threshold (0-1) */
    threshold?: number;
}

export interface GetSimilarResponse {
    success: boolean;
    results?: Array<{
        objectHash: string;
        similarity: number;
    }>;
    error?: string;
}

export interface GetStatusRequest {
    // No parameters
}

export interface GetStatusResponse {
    success: boolean;
    data?: {
        initialized: boolean;
        model: string;
        dimensions: number;
        indexSize: number;
        hasProvider: boolean;
    };
    error?: string;
}

export interface EmbedTextRequest {
    /** Text to embed (returns embedding without indexing) */
    text: string;
}

export interface EmbedTextResponse {
    success: boolean;
    embedding?: number[];
    error?: string;
}

// ============================================================================
// MeaningPlan Implementation
// ============================================================================

/**
 * MeaningPlan - Semantic similarity operations for MCP
 *
 * Provides:
 * - indexText: Index object by text content
 * - indexEmbedding: Index object with pre-computed embedding
 * - queryByText: Find similar objects by text
 * - queryByEmbedding: Find similar objects by embedding
 * - getSimilar: Find objects similar to a given object
 * - embedText: Get embedding for text (without indexing)
 * - getStatus: Get dimension status and statistics
 */
export class MeaningPlan {
    static get name(): string {
        return 'meaning';
    }
    static get description(): string {
        return 'Semantic similarity search - find content by meaning, not just keywords';
    }
    static get version(): string {
        return '1.0.0';
    }

    private meaningDimension: MeaningDimension | null = null;
    private embeddingProvider: EmbeddingProvider | null = null;

    constructor(meaningDimension?: MeaningDimension, embeddingProvider?: EmbeddingProvider) {
        this.meaningDimension = meaningDimension || null;
        this.embeddingProvider = embeddingProvider || null;
    }

    /**
     * Set the MeaningDimension after initialization
     */
    setDimension(meaningDimension: MeaningDimension, embeddingProvider?: EmbeddingProvider): void {
        this.meaningDimension = meaningDimension;
        if (embeddingProvider) {
            this.embeddingProvider = embeddingProvider;
        }
    }

    /**
     * Index an object by its text content
     *
     * Embeds the text and stores the embedding with the object.
     * Requires embeddingProvider to be configured.
     */
    async indexText(request: IndexTextRequest): Promise<IndexTextResponse> {
        try {
            if (!this.meaningDimension) {
                throw new Error('MeaningDimension not initialized');
            }

            const hash = await this.meaningDimension.indexText(
                request.objectHash as SHA256Hash,
                request.text
            );

            return {
                success: true,
                dimensionValueHash: hash
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Index an object with a pre-computed embedding
     *
     * Use this when you already have the embedding vector.
     */
    async indexEmbedding(request: IndexEmbeddingRequest): Promise<IndexEmbeddingResponse> {
        try {
            if (!this.meaningDimension) {
                throw new Error('MeaningDimension not initialized');
            }

            const hash = await this.meaningDimension.indexEmbedding(
                request.objectHash as SHA256Hash,
                request.embedding,
                request.sourceText
            );

            return {
                success: true,
                dimensionValueHash: hash
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Find objects semantically similar to query text
     *
     * Embeds the query and finds nearest neighbors.
     * Requires embeddingProvider to be configured.
     */
    async queryByText(request: QueryByTextRequest): Promise<QueryByTextResponse> {
        try {
            if (!this.meaningDimension) {
                throw new Error('MeaningDimension not initialized');
            }

            const results = await this.meaningDimension.queryByText(
                request.text,
                request.k ?? 10,
                request.threshold
            );

            return {
                success: true,
                results: results.map((r: MeaningQueryResult) => ({
                    objectHash: r.objectHash,
                    similarity: r.similarity
                }))
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Find objects similar to a query embedding
     *
     * Use this when you already have the query embedding.
     */
    async queryByEmbedding(request: QueryByEmbeddingRequest): Promise<QueryByEmbeddingResponse> {
        try {
            if (!this.meaningDimension) {
                throw new Error('MeaningDimension not initialized');
            }

            const results = await this.meaningDimension.queryWithScores({
                embedding: request.embedding,
                k: request.k ?? 10,
                threshold: request.threshold
            });

            return {
                success: true,
                results: results.map((r: MeaningQueryResult) => ({
                    objectHash: r.objectHash,
                    meaningNodeHash: r.meaningNodeHash,
                    similarity: r.similarity
                }))
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Find objects similar to a given indexed object
     *
     * Looks up the object's embedding and finds nearest neighbors.
     */
    async getSimilar(request: GetSimilarRequest): Promise<GetSimilarResponse> {
        try {
            if (!this.meaningDimension) {
                throw new Error('MeaningDimension not initialized');
            }

            // Check if object is indexed
            if (!this.meaningDimension.isIndexed(request.objectHash as SHA256Hash)) {
                return {
                    success: false,
                    error: `Object ${request.objectHash} is not indexed in meaning dimension`
                };
            }

            // Get the object's embedding from the index
            // This requires accessing the internal index - may need to add a method
            // For now, return error indicating this needs the embedding
            return {
                success: false,
                error: 'getSimilar requires the object embedding. Use queryByEmbedding with the object\'s embedding instead.'
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Get embedding for text without indexing
     *
     * Useful for getting query embeddings or checking embeddings.
     * Requires embeddingProvider to be configured.
     */
    async embedText(request: EmbedTextRequest): Promise<EmbedTextResponse> {
        try {
            if (!this.embeddingProvider) {
                throw new Error('EmbeddingProvider not configured. Cannot embed text.');
            }

            const embedding = await this.embeddingProvider.embed(request.text);

            return {
                success: true,
                embedding
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Get dimension status and statistics
     */
    async getStatus(_request: GetStatusRequest): Promise<GetStatusResponse> {
        try {
            if (!this.meaningDimension) {
                return {
                    success: true,
                    data: {
                        initialized: false,
                        model: 'none',
                        dimensions: 0,
                        indexSize: 0,
                        hasProvider: false
                    }
                };
            }

            return {
                success: true,
                data: {
                    initialized: true,
                    model: this.meaningDimension.getModel(),
                    dimensions: this.meaningDimension.getDimensions(),
                    indexSize: this.meaningDimension.getIndexSize(),
                    hasProvider: this.embeddingProvider !== null
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
}
