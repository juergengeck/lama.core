/**
 * Subject Model for ONE.core
 * Represents a distinct discussion topic within a conversation
 * Identified by keyword combination (keywords are the ID property)
 *
 * DIVISION OF RESPONSIBILITY:
 * - ONE.core: Automatically generates SHA256IdHash<Subject> from sorted keywords (via isId: true)
 * - App Logic (this file): Detects semantic collisions and adds differentiating keywords
 *
 * Subjects with identical keywords get same ID hash (ONE.core automatic deduplication)
 */

import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import { createKeyword } from './Keyword.js';
import type { Subject } from '../types/Subject.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Keyword } from '../types/Keyword.js';

/**
 * Check if two descriptions are semantically aligned (represent the same concept)
 * Simple string similarity for now - could be enhanced with LLM semantic comparison
 */
function descriptionsAlign(desc1: string | undefined, desc2: string | undefined): boolean {
  if (!desc1 || !desc2) return true; // If either is missing, consider aligned (no conflict)

  // Normalize and compare
  const normalized1 = desc1.toLowerCase().trim();
  const normalized2 = desc2.toLowerCase().trim();

  // Exact match
  if (normalized1 === normalized2) return true;

  // Simple similarity: check if one contains the other
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    return true;
  }

  // TODO: Could add Levenshtein distance, cosine similarity, or LLM comparison here

  return false;
}

/**
 * Create or update a Subject using semantic versioning
 *
 * APPLICATION LOGIC WORKFLOW (this function):
 * 1. Create candidate Subject in-memory (not stored yet)
 * 2. Calculate ID hash from keywords (ONE.core does this automatically via isId: true)
 * 3. Check if Subject with this keyword combination exists
 * 4. Semantic collision detection (APPLICATION LOGIC):
 *    - If exists and descriptions align → store as new version
 *    - If exists but descriptions diverge → APP ADDS differentiating keyword and retries
 *    - If not exists → store new subject
 *
 * ONE.core's role: Just calculates ID hash from keywords. It does NOT:
 * - Detect semantic collisions
 * - Add differentiating keywords
 * - Compare descriptions
 *
 * That's all APPLICATION LOGIC (implemented in this function).
 *
 * @param topicId - Topic ID
 * @param description - Subject description (LLM-generated)
 * @param keywordTerms - Array of keyword terms (strings) to convert to ID hashes
 * @param additionalKeywords - Optional additional differentiating keywords (app-level logic)
 */
export async function createOrUpdateSubject(
  topicId: string,
  description: string,
  keywordTerms: string[],
  additionalKeywords: SHA256IdHash<Keyword>[] = []
): Promise<{ subject: Subject; hash: string; idHash: SHA256IdHash<Subject>; isNewVersion: boolean }> {
  // Step 1: Convert keyword terms to ID hashes
  const keywordIdHashes: SHA256IdHash<Keyword>[] = [...additionalKeywords];

  for (const term of keywordTerms) {
    const normalizedTerm = term.toLowerCase().trim();
    // CRITICAL: Store the Keyword object BEFORE referencing it
    const keywordResult = await createKeyword(normalizedTerm, 1, 0.8, []);
    keywordIdHashes.push(keywordResult.idHash);
  }

  // Step 2: Create candidate Subject in-memory (not stored yet)
  const now = Date.now();
  const candidateSubject: Subject = {
    $type$: 'Subject',
    topic: topicId,
    keywords: keywordIdHashes, // THIS IS THE ID PROPERTY - ONE.core auto-generates hash from this
    timeRanges: [{ start: now, end: now }],
    messageCount: 1,
    createdAt: now,
    lastSeenAt: now,
    description,
    archived: false
  };

  // Step 3: Calculate ID hash from keywords (ONE.core does this automatically)
  const idHash = await calculateIdHashOfObj(candidateSubject);

  // Step 4: Check if Subject with this keyword combination exists
  let existing: Subject | null = null;
  try {
    const result = await getObjectByIdHash(idHash);
    if (result && result.obj) {
      existing = result.obj as Subject;
    }
  } catch (error) {
    // Subject doesn't exist yet, which is fine
  }

  // Step 5: Decision logic
  if (existing) {
    // Subject with these keywords exists - check if descriptions align
    if (descriptionsAlign(existing.description, description)) {
      // ✅ Same concept - store as new version
      console.log(`[Subject] Storing new version of subject with keywords: ${keywordTerms.join(', ')}`);

      // Update with new description and timestamp
      const updatedSubject: Subject = {
        ...existing,
        description, // Use new description (might be more refined)
        lastSeenAt: now,
        messageCount: existing.messageCount + 1,
        timeRanges: [...existing.timeRanges, { start: now, end: now }]
      };

      const result = await storeVersionedObject(updatedSubject);
      return {
        subject: updatedSubject,
        hash: result.hash,
        idHash: result.idHash,
        isNewVersion: true
      };
    } else {
      // ❌ Different concept - APPLICATION LOGIC adds differentiating keywords
      console.warn(`[Subject] Semantic divergence detected for keywords: ${keywordTerms.join(', ')}`);
      console.warn(`  Existing: "${existing.description}"`);
      console.warn(`  New:      "${description}"`);

      // APPLICATION LOGIC: Identify differentiating keyword from descriptions
      // TODO: Use LLM to extract semantic difference between descriptions
      // For now, simple heuristic: use first word of new description
      const differentiatingTerm = description.split(' ')[0].toLowerCase();
      const differentiatingKeyword = await createKeyword(differentiatingTerm, 1, 0.9, []);

      console.log(`[Subject] APP LOGIC adding differentiating keyword: ${differentiatingTerm}`);

      // Recursive call with additional differentiating keyword
      // ONE.core will recalculate ID hash with the new keyword set
      return await createOrUpdateSubject(
        topicId,
        description,
        keywordTerms,
        [...additionalKeywords, differentiatingKeyword.idHash]
      );
    }
  } else {
    // ✅ New subject - store it
    console.log(`[Subject] Creating new subject with keywords: ${keywordTerms.join(', ')}`);
    const result = await storeVersionedObject(candidateSubject);
    return {
      subject: candidateSubject,
      hash: result.hash,
      idHash: result.idHash,
      isNewVersion: false
    };
  }
}

/**
 * Legacy createSubject - kept for backward compatibility
 * @deprecated Use createOrUpdateSubject instead
 */
export async function createSubject(
  topicId: any,
  keywordCombination: any,
  description: any,
  confidence: any,
  keywordTerms: string[] = []
) {
  console.warn('[Subject] createSubject is deprecated - use createOrUpdateSubject instead');
  return await createOrUpdateSubject(topicId, description, keywordTerms);
}

/**
 * Helper to generate keyword combination string
 */
export function generateKeywordCombination(keywords: any): any {
  return keywords
    .map((k: any) => typeof k === 'string' ? k : k.term)
    .sort()
    .map((k: any) => k.toLowerCase().replace(/\s+/g, '-'))
    .join('+');
}

/**
 * Update Subject message count
 */
export async function updateSubjectMessageCount(subjectHash: any, increment = 1): Promise<any> {
  // Note: In a real implementation, you'd retrieve the current subject,
  // update its messageCount, and store a new version
  // This is simplified for the example
  console.log(`[Subject] Would increment message count by ${increment} for subject ${subjectHash}`);
}

/**
 * Check if subject matches given keywords
 */
export function subjectMatchesKeywords(subjectData: any, keywords = []): any {
  const normalizedKeywords: any[] = keywords.map(k => (k as any).toLowerCase());
  const keywordCombination = subjectData.keywordCombination.toLowerCase();

  return normalizedKeywords.every(k => keywordCombination.includes(k));
}

/**
 * Check if subject is significant enough to keep
 */
export function isSubjectSignificant(subjectData: any): any {
  return subjectData.messageCount >= 2 && subjectData.keywords.length > 0;
}