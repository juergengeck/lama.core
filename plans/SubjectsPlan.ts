/**
 * Subjects Plan (Pure Business Logic)
 *
 * Platform-agnostic plan for subject management operations.
 * Can be used from both Electron IPC and Web Worker contexts.
 */

import { SubjectService } from '../services/SubjectService.js';
import type { Subject } from '../one-ai/types/Subject.js';

// Request/Response types
export interface CreateSubjectRequest {
  name: string;
  createdBy: string;
  confidence: number;
  references?: any[];
}

export interface CreateSubjectResponse {
  success: boolean;
  subject?: Subject;
  error?: string;
}

export interface AttachSubjectRequest {
  subjectName: string;
  contentHash: string;
  attachedBy: string;
  confidence: number;
  context?: any;
}

export interface AttachSubjectResponse {
  success: boolean;
  attachment?: any;
  error?: string;
}

export interface GetForContentRequest {
  contentHash: string;
}

export interface GetForContentResponse {
  success: boolean;
  subjects?: Subject[];
  error?: string;
}

export interface GetAllSubjectsRequest {}

export interface GetAllSubjectsResponse {
  success: boolean;
  subjects?: Subject[];
  error?: string;
}

export interface SearchSubjectsRequest {
  query: string;
  limit?: number;
}

export interface SearchSubjectsResponse {
  success: boolean;
  results?: Subject[];
  error?: string;
}

export interface GetResonanceRequest {
  subjectNames: string[];
  topK?: number;
}

export interface GetResonanceResponse {
  success: boolean;
  resonance?: any;
  error?: string;
}

export interface ExtractSubjectsRequest {
  text: string;
  extractor?: string;
  minConfidence?: number;
}

export interface ExtractSubjectsResponse {
  success: boolean;
  subjects?: Subject[];
  error?: string;
}

/**
 * SubjectsPlan - Pure business logic for subject management
 */
export class SubjectsPlan {
  private subjectService: SubjectService;

  constructor(subjectService?: SubjectService) {
    this.subjectService = subjectService || SubjectService.getInstance();
  }

  /**
   * Set service after initialization
   */
  setService(subjectService: SubjectService): void {
    this.subjectService = subjectService;
  }

  /**
   * Create or update a subject
   */
  async createSubject(request: CreateSubjectRequest): Promise<CreateSubjectResponse> {
    try {
      const subject = await this.subjectService.createSubject(
        request.name,
        request.createdBy,
        request.confidence,
        request.references
      );
      return { success: true, subject };
    } catch (error) {
      console.error('[SubjectsPlan] Error creating subject:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Attach subject to content
   */
  async attachSubject(request: AttachSubjectRequest): Promise<AttachSubjectResponse> {
    try {
      const attachment = await this.subjectService.attachSubject(
        request.subjectName,
        request.contentHash,
        request.attachedBy,
        request.confidence,
        request.context
      );
      return { success: true, attachment };
    } catch (error) {
      console.error('[SubjectsPlan] Error attaching subject:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get subjects for content
   */
  async getForContent(request: GetForContentRequest): Promise<GetForContentResponse> {
    try {
      const subjects = this.subjectService.getContentSubjects(request.contentHash);
      return { success: true, subjects };
    } catch (error) {
      console.error('[SubjectsPlan] Error getting subjects:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get all subjects
   */
  async getAll(request: GetAllSubjectsRequest): Promise<GetAllSubjectsResponse> {
    try {
      const subjects = this.subjectService.getAllSubjects();
      return { success: true, subjects };
    } catch (error) {
      console.error('[SubjectsPlan] Error getting all subjects:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Search subjects (not yet implemented in service)
   */
  async search(request: SearchSubjectsRequest): Promise<SearchSubjectsResponse> {
    try {
      // Search functionality not yet implemented in SubjectService
      const results: Subject[] = [];
      return { success: true, results };
    } catch (error) {
      console.error('[SubjectsPlan] Error searching subjects:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get subject resonance
   */
  async getResonance(request: GetResonanceRequest): Promise<GetResonanceResponse> {
    try {
      const resonance = this.subjectService.calculateResonance(request.subjectNames[0]);
      return { success: true, resonance };
    } catch (error) {
      console.error('[SubjectsPlan] Error calculating resonance:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Extract subjects from text
   */
  async extract(request: ExtractSubjectsRequest): Promise<ExtractSubjectsResponse> {
    try {
      const subjects = this.subjectService.extractSubjectsFromText(request.text) as Subject[];
      return { success: true, subjects };
    } catch (error) {
      console.error('[SubjectsPlan] Error extracting subjects:', error);
      return { success: false, error: (error as Error).message };
    }
  }
}
