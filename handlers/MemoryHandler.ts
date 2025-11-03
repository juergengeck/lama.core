/**
 * Memory Handler
 * Platform-agnostic handler for memory storage operations
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';

export interface CreateSubjectParams {
  id: string;
  name: string;
  description?: string;
  metadata?: Map<string, string>;
  sign?: boolean;
  theme?: 'light' | 'dark' | 'auto';
}

export interface UpdateSubjectParams {
  name?: string;
  description?: string;
  metadata?: Map<string, string>;
  sign?: boolean;
  theme?: 'light' | 'dark' | 'auto';
}

export interface StoreAssemblyResult {
  hash: string;
  idHash: string;
  filePath: string;
}

export interface SubjectAssembly {
  $type$: 'SubjectAssembly';
  id: string;
  name: string;
  description?: string;
  metadata?: Map<string, string>;
  created: number;
  modified?: number;
}

/**
 * Memory Handler
 *
 * Delegates to memory module's SubjectHandler
 * Provides platform-agnostic interface for MCP tools
 */
export class MemoryHandler {
  constructor(private subjectHandler: any) {}

  /**
   * Create a new subject assembly
   */
  async createSubject(params: CreateSubjectParams): Promise<StoreAssemblyResult> {
    return await this.subjectHandler.createSubject(params);
  }

  /**
   * Get a subject by its idHash
   */
  async getSubject(
    idHash: SHA256IdHash<any>,
    options: { verifySignature?: boolean } = {}
  ): Promise<SubjectAssembly | null> {
    return await this.subjectHandler.getSubject(idHash, options);
  }

  /**
   * Update a subject
   */
  async updateSubject(
    idHash: SHA256IdHash<any>,
    updates: UpdateSubjectParams
  ): Promise<StoreAssemblyResult> {
    return await this.subjectHandler.updateSubject(idHash, updates);
  }

  /**
   * Delete a subject
   */
  async deleteSubject(idHash: SHA256IdHash<any>): Promise<boolean> {
    return await this.subjectHandler.deleteSubject(idHash);
  }

  /**
   * List all subjects
   */
  async listSubjects(): Promise<SHA256IdHash<any>[]> {
    return await this.subjectHandler.listSubjects();
  }

  /**
   * Get raw HTML for a subject
   */
  async getSubjectHtml(idHash: SHA256IdHash<any>): Promise<string | null> {
    const filePath = this.subjectHandler.storageService.getFilePath(idHash, 'subjects');
    return await this.subjectHandler.storageService.readRawHtml(idHash, 'subjects');
  }
}
