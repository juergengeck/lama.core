/**
 * Keyword - TypeScript Interface
 * Represents an extracted keyword with frequency and relationships
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Subject } from './Subject.js';

export interface Keyword {
  $type$: 'Keyword';
  term: string; // Normalized keyword term (lowercase, trimmed), isId: true
  frequency: number;
  subjects: SHA256IdHash<Subject>[]; // Array of Subject ID hashes (referenceToId)
  score?: number;
  createdAt: number;
  lastSeen: number;
}
