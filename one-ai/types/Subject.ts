/**
 * Subject - TypeScript Interface
 * Re-exports from @OneObjectInterfaces to ensure type compatibility
 *
 * The actual type definition is in @OneObjectInterfaces.d.ts
 * which must match the SubjectRecipe.ts exactly
 */

// Re-export the Subject type from ambient declarations
export type { Subject } from '@OneObjectInterfaces';

/**
 * SubjectSource - tracks where a subject was mentioned (chat, manual entry, import, etc.)
 */
export interface SubjectSource {
  type: 'chat' | 'manual' | 'import';
  id: string;                    // topicId for chat, userId for manual, etc.
  extractedAt: number;
  confidence?: number;
}
