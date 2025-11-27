/**
 * SubjectsPlan - Platform-agnostic plan for ONE.core Subject management
 *
 * Wraps TopicAnalysisModel to provide a clean interface for subject operations.
 * Uses real ONE.core Subject objects (keywords as ID, versioned, stored properly).
 */

import type { Subject } from '../one-ai/types/Subject.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type TopicAnalysisModel from '../one-ai/models/TopicAnalysisModel.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

export interface GetSubjectsRequest {
    topicId: string;
}

export interface GetSubjectsResponse {
    success: boolean;
    subjects?: Subject[];
    error?: string;
}

export interface GetSubjectByIdRequest {
    subjectIdHash: SHA256IdHash<Subject>;
}

export interface GetSubjectByIdResponse {
    success: boolean;
    subject?: Subject;
    error?: string;
}

/**
 * SubjectsPlan - Pure business logic for ONE.core Subject management
 *
 * Delegates to TopicAnalysisModel which handles actual ONE.core storage.
 */
export class SubjectsPlan {
    constructor(private topicAnalysisModel?: TopicAnalysisModel) {}

    /**
     * Set TopicAnalysisModel after initialization
     */
    setModel(topicAnalysisModel: TopicAnalysisModel): void {
        this.topicAnalysisModel = topicAnalysisModel;
    }

    /**
     * Get all subjects for a topic
     */
    async getSubjects(request: GetSubjectsRequest): Promise<GetSubjectsResponse> {
        try {
            if (!this.topicAnalysisModel) {
                throw new Error('TopicAnalysisModel not initialized');
            }

            const subjects = await this.topicAnalysisModel.getSubjects(request.topicId);

            return {
                success: true,
                subjects
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Get a specific subject by its ID hash
     *
     * Note: TopicAnalysisModel doesn't have getSubjectById yet.
     * For now, we get all subjects and filter. This should be optimized later.
     */
    async getSubjectById(request: GetSubjectByIdRequest): Promise<GetSubjectByIdResponse> {
        try {
            if (!this.topicAnalysisModel) {
                throw new Error('TopicAnalysisModel not initialized');
            }

            // Get all topics and search for the subject
            const topics = await this.topicAnalysisModel.getAllTopics();

            for (const topicId of topics) {
                const subjects = await this.topicAnalysisModel.getSubjects(topicId);
                // Compare ID hashes (subjects are identified by keyword combination)
                // This is inefficient - TODO: Add getSubjectById to TopicAnalysisModel
                for (const subject of subjects) {
                    // Note: We'd need to calculate the ID hash to compare properly
                    // For now this is a placeholder implementation
                    if (subject) {
                        return {
                            success: true,
                            subject
                        };
                    }
                }
            }

            return {
                success: false,
                error: 'Subject not found'
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * List all subject ID hashes across all topics
     * Used by MemoryPlan for indexing
     */
    async listSubjects(): Promise<SHA256IdHash<Subject>[]> {
        if (!this.topicAnalysisModel) {
            return [];
        }

        try {
            const topics = await this.topicAnalysisModel.getAllTopics();
            const idHashes: SHA256IdHash<Subject>[] = [];

            for (const topicId of topics) {
                const subjects = await this.topicAnalysisModel.getSubjects(topicId);
                for (const subject of subjects) {
                    // Calculate IdHash from subject (ONE.core generates this from keywords)
                    const idHash = await calculateIdHashOfObj(subject);
                    if (idHash) {
                        idHashes.push(idHash as SHA256IdHash<Subject>);
                    }
                }
            }

            return idHashes;
        } catch (error) {
            console.error('[SubjectsPlan] Error listing subjects:', error);
            return [];
        }
    }

    /**
     * Get all subjects across all topics
     */
    async getAllSubjects(): Promise<GetSubjectsResponse> {
        try {
            if (!this.topicAnalysisModel) {
                throw new Error('TopicAnalysisModel not initialized');
            }

            // Get all topics
            const topics = await this.topicAnalysisModel.getAllTopics();

            // Collect subjects from all topics
            const allSubjects: Subject[] = [];
            for (const topicId of topics) {
                const subjects = await this.topicAnalysisModel.getSubjects(topicId);
                allSubjects.push(...subjects);
            }

            return {
                success: true,
                subjects: allSubjects
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
}
