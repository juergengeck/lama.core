/**
 * Subject - TypeScript Interface
 * Represents a distinct discussion topic within a conversation
 * Identified by topic + keyword combination
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Keyword } from './Keyword.js';

export interface Subject {
  $type$: 'Subject';
  id: string; // Keyword combination used as ID
  topic: string; // Topic ID (plain string, Topic is unversioned)
  keywords: SHA256IdHash<Keyword>[]; // Array of Keyword ID hashes
  timeRanges: Array<{
    start: number;
    end: number;
  }>;
  messageCount: number;
  createdAt: number;
  lastSeenAt: number;
  description?: string; // LLM-generated description of the subject
  archived?: boolean;
}
