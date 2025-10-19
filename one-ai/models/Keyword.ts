/**
 * Keyword Model for ONE.core
 * Represents an extracted keyword with frequency and relationships
 */

import type { OneUnversionedObjectTypes } from '@refinio/one.core/lib/recipes.js';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';

/**
 * Create a Keyword object using ONE.core versioned storage
 */
export async function createKeyword(
  term: string,
  frequency: number = 1,
  score?: number,
  subjects: string[] = []
) {
  const now = Date.now();
  const keyword = {
    $type$: 'Keyword' as const,
    term: term.toLowerCase().trim(),
    frequency,
    subjects, // Array of subject ID strings
    score,
    createdAt: now,
    lastSeen: now
  };

  return await storeVersionedObject(keyword as any);
}

/**
 * Normalize keyword term for consistent storage
 */
export function normalizeKeywordTerm(text: string): string {
  if (!text) {
    throw new Error('Text is required for Keyword');
  }
  return text.toLowerCase().trim();
}

/**
 * Increment frequency when keyword appears again
 */
export function incrementFrequency(keyword: any): void {
  keyword.frequency++;
  keyword.lastSeen = Date.now();
}

/**
 * Add association with a subject
 */
export function addSubject(keyword: any, subjectId: string): void {
  if (!keyword.subjects.includes(subjectId)) {
    keyword.subjects.push(subjectId);
  }
}

/**
 * Remove association with a subject
 */
export function removeSubject(keyword: any, subjectId: string): void {
  keyword.subjects = keyword.subjects.filter((id: string) => id !== subjectId);
}

/**
 * Update relevance score
 */
export function updateScore(keyword: any, newScore: number): void {
  if (newScore < 0 || newScore > 1) {
    throw new Error('Score must be between 0 and 1');
  }
  keyword.score = newScore;
}

/**
 * Check if keyword is still relevant
 * (Based on frequency and recency)
 */
export function isRelevant(keyword: any, thresholdDays: number = 30): boolean {
  const daysSinceLastSeen = (Date.now() - keyword.lastSeen) / (1000 * 60 * 60 * 24);
  return daysSinceLastSeen < thresholdDays && keyword.frequency > 1;
}

/**
 * Normalize keyword text for comparison
 */
export function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check if two keywords are similar
 */
export function isSimilarTo(keyword1: any, keyword2: any, threshold: number = 0.8): boolean {
  const normalized1 = normalize(keyword1.text || keyword1.term);
  const normalized2 = normalize(keyword2.text || keyword2.term);

  // Simple similarity check - could be enhanced with better algorithms
  if (normalized1 === normalized2) return true;

  // Check if one contains the other
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    return true;
  }

  // Check Levenshtein distance for typos
  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);
  const similarity = 1 - (distance / maxLength);

  return similarity >= threshold;
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Merge another keyword into this one
 */
export function mergeKeywords(keyword1: any, keyword2: any): any {
  // Combine frequencies
  keyword1.frequency += keyword2.frequency;

  // Combine subjects (deduplicate)
  const combinedSubjects = new Set([...keyword1.subjects, ...keyword2.subjects]);
  keyword1.subjects = Array.from(combinedSubjects);

  // Average scores
  keyword1.score = (keyword1.score + keyword2.score) / 2;

  // Use most recent last seen
  keyword1.lastSeen = Math.max(keyword1.lastSeen, keyword2.lastSeen);

  return keyword1;
}

/**
 * Convert to plain object for storage
 */
export function toObject(keyword: any): any {
  return {
    $type$: keyword.$type$,
    id: keyword.id,
    text: keyword.text || keyword.term,
    frequency: keyword.frequency,
    subjects: keyword.subjects,
    score: keyword.score,
    createdAt: keyword.createdAt,
    lastSeen: keyword.lastSeen
  };
}

/**
 * Create Keyword from plain object
 */
export function fromObject(obj: any): any {
  if (obj.$type$ !== 'Keyword') {
    throw new Error('Invalid object type for Keyword');
  }
  return obj;
}

/**
 * Get weight based on frequency and score
 */
export function getWeight(keyword: any): number {
  return keyword.frequency * keyword.score;
}

/**
 * Check if keyword is a compound term
 */
export function isCompound(keyword: any): boolean {
  const text = keyword.text || keyword.term;
  return text.includes(' ') || text.includes('-');
}

/**
 * Get individual words from compound keyword
 */
export function getWords(keyword: any): string[] {
  const text = keyword.text || keyword.term;
  return text.split(/[\s-]+/).filter((w: string) => w.length > 0);
}

// For compatibility
const Keyword = {
  createKeyword,
  normalizeKeywordTerm,
  incrementFrequency,
  addSubject,
  removeSubject,
  updateScore,
  isRelevant,
  normalize,
  isSimilarTo,
  levenshteinDistance,
  mergeKeywords,
  toObject,
  fromObject,
  getWeight,
  isCompound,
  getWords
};

export default Keyword;