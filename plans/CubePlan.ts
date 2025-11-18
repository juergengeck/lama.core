/**
 * Cube Plan - Dimensional storage and queries
 *
 * Platform-agnostic plan for cube.core operations (dimensional indexing,
 * Assembly tracking, AI memory timelines, subject expertise).
 *
 * Provides access to:
 * - AI dimension (track AI work products by identity)
 * - Assembly indexing (store Assemblies with dimensional metadata)
 * - Multi-dimensional queries (by AI, subject, time, etc.)
 * - Memory timelines (what AIs worked on over time)
 */

import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

// Cube.core types (injected by platform)
export type CubeStorage = any;
export type AIDimension = any;
export type DimensionCriterion = any;
export type QueryResult = any;
export type Assembly = any;

/**
 * CubePlan dependencies (injected by platform)
 */
export interface CubePlanDependencies {
    /** Initialized CubeStorage instance with dimensions */
    cubeStorage: CubeStorage;
    /** ONE.core instance */
    oneCore: any;
}

/**
 * Request/Response types for CubePlan operations
 */

export interface StoreAssemblyRequest {
    assemblyHash: string; // SHA256Hash
    assembly: Assembly;
}

export interface StoreAssemblyResponse {
    success: boolean;
    error?: string;
}

export interface QueryByAIRequest {
    aiId: string; // SHA256IdHash - AI identity
}

export interface QueryByAIResponse {
    success: boolean;
    data?: {
        objects: any[];
        count: number;
        executionTimeMs: number;
    };
    error?: string;
}

export interface QueryBySubjectRequest {
    subjectHash: string; // SHA256Hash - subject/keyword hash
}

export interface QueryBySubjectResponse {
    success: boolean;
    data?: {
        objects: any[];
        count: number;
        executionTimeMs: number;
    };
    error?: string;
}

export interface QueryByTimeRangeRequest {
    startTime: number; // Unix timestamp
    endTime: number; // Unix timestamp
}

export interface QueryByTimeRangeResponse {
    success: boolean;
    data?: {
        objects: any[];
        count: number;
        executionTimeMs: number;
    };
    error?: string;
}

export interface BuildAIMemoryTimelineRequest {
    aiId: string; // SHA256IdHash
}

export interface BuildAIMemoryTimelineResponse {
    success: boolean;
    data?: {
        timeline: Array<{
            timestamp: number;
            assemblyHash: string;
            subjects: string[];
            keywords: string[];
        }>;
    };
    error?: string;
}

export interface FindAIExpertsRequest {
    subjectHash: string; // SHA256Hash
}

export interface FindAIExpertsResponse {
    success: boolean;
    data?: {
        experts: Array<{
            aiId: string;
            workCount: number;
        }>;
    };
    error?: string;
}

export interface QueryRequest {
    criteria: Record<string, DimensionCriterion>;
}

export interface QueryResponse {
    success: boolean;
    data?: QueryResult;
    error?: string;
}

/**
 * CubePlan - Platform-agnostic dimensional storage operations
 *
 * Wraps cube.core's CubeStorage with a clean plan interface.
 * All platform-specific integration happens in the constructor.
 */
export class CubePlan {
    private cubeStorage: CubeStorage;

    constructor(deps: CubePlanDependencies) {
        this.cubeStorage = deps.cubeStorage;
    }

    /**
     * Initialize the cube storage
     */
    async init(): Promise<void> {
        if (this.cubeStorage.init) {
            await this.cubeStorage.init();
        }
    }

    /**
     * Store an Assembly with AI dimensional metadata
     *
     * Indexes the Assembly by AI identity (from supply.ownerId),
     * subjects, keywords, and timestamp.
     */
    async storeAssembly(request: StoreAssemblyRequest): Promise<StoreAssemblyResponse> {
        try {
            const {assemblyHash, assembly} = request;

            // Index Assembly with AI dimension
            await this.cubeStorage.store(assemblyHash as SHA256Hash, {
                ai: assembly
            });

            return {success: true};
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Query Assemblies by AI identity
     *
     * Find all work products created by a specific AI.
     */
    async queryByAI(request: QueryByAIRequest): Promise<QueryByAIResponse> {
        try {
            const {aiId} = request;

            const result = await this.cubeStorage.query({
                ai: {
                    operator: 'equals',
                    value: aiId
                }
            });

            return {
                success: true,
                data: {
                    objects: result.objects,
                    count: result.count,
                    executionTimeMs: result.executionTimeMs
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Query Assemblies by subject/keyword
     *
     * Find all AIs that worked on a specific subject or keyword.
     */
    async queryBySubject(request: QueryBySubjectRequest): Promise<QueryBySubjectResponse> {
        try {
            const {subjectHash} = request;

            const result = await this.cubeStorage.query({
                ai: {
                    operator: 'contains',
                    value: subjectHash
                }
            });

            return {
                success: true,
                data: {
                    objects: result.objects,
                    count: result.count,
                    executionTimeMs: result.executionTimeMs
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Query Assemblies by time range
     *
     * Find all AI work within a specific time period.
     */
    async queryByTimeRange(request: QueryByTimeRangeRequest): Promise<QueryByTimeRangeResponse> {
        try {
            const {startTime, endTime} = request;

            const result = await this.cubeStorage.query({
                ai: {
                    operator: 'range',
                    start: startTime,
                    end: endTime
                }
            });

            return {
                success: true,
                data: {
                    objects: result.objects,
                    count: result.count,
                    executionTimeMs: result.executionTimeMs
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Build memory timeline for an AI
     *
     * Returns chronologically sorted list of what an AI worked on.
     */
    async buildAIMemoryTimeline(
        request: BuildAIMemoryTimelineRequest
    ): Promise<BuildAIMemoryTimelineResponse> {
        try {
            const {aiId} = request;

            // Query all work by this AI
            const result = await this.cubeStorage.query({
                ai: {
                    operator: 'equals',
                    value: aiId
                }
            });

            // Build timeline from results
            const timeline = result.objects
                .map((obj: any) => ({
                    timestamp: obj.created,
                    assemblyHash: obj.oneObjectHash,
                    subjects: [], // Would need to load Assembly to get these
                    keywords: []
                }))
                .sort((a: any, b: any) => a.timestamp - b.timestamp);

            return {
                success: true,
                data: {timeline}
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Find AI experts for a subject
     *
     * Returns list of AIs ranked by how much work they've done on a subject.
     */
    async findAIExperts(request: FindAIExpertsRequest): Promise<FindAIExpertsResponse> {
        try {
            const {subjectHash} = request;

            // Query all work related to this subject
            const result = await this.cubeStorage.query({
                ai: {
                    operator: 'contains',
                    value: subjectHash
                }
            });

            // Count work by each AI
            const aiWorkCount = new Map<string, number>();

            for (const obj of result.objects) {
                // Would need to load Assembly to get supply.ownerId
                // For now, this is a placeholder
                const aiId = obj.creator || 'unknown';
                aiWorkCount.set(aiId, (aiWorkCount.get(aiId) || 0) + 1);
            }

            // Sort by work count
            const experts = Array.from(aiWorkCount.entries())
                .map(([aiId, workCount]) => ({aiId, workCount}))
                .sort((a, b) => b.workCount - a.workCount);

            return {
                success: true,
                data: {experts}
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Generic multi-dimensional query
     *
     * Allows combining multiple dimension criteria.
     */
    async query(request: QueryRequest): Promise<QueryResponse> {
        try {
            const {criteria} = request;
            const result = await this.cubeStorage.query(criteria);

            return {
                success: true,
                data: result
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Get the underlying CubeStorage instance (for advanced use)
     */
    getCubeStorage(): CubeStorage {
        return this.cubeStorage;
    }
}
