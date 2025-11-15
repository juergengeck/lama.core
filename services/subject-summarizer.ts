/**
 * Subject Summarizer
 *
 * Formats subjects at different compression levels for context window management.
 * Uses abstraction levels to enable ultra-compact subject representation.
 */

import type { Subject } from '../one-ai/types/Subject.js';
import type { SubjectAssembly } from '../../memory.core/src/plans/MemoryPlan.js';
import { getLevelName } from './abstraction-level-calculator.js';

export type CompressionMode = 'rich' | 'balanced' | 'minimal' | 'extreme';

export interface SubjectSummary {
  text: string;              // Formatted summary text
  estimatedTokens: number;   // Rough token estimate (chars / 4)
  mode: CompressionMode;     // Which compression mode was used
}

export interface SubjectForSummary {
  id?: string;
  name?: string;
  description?: string;
  keywords?: string[] | any[]; // Can be string[] or IdHash[]
  messageCount?: number;
  abstractionLevel?: number;
  created?: number;
  lastSeenAt?: number;
}

/**
 * Format a subject at the specified compression level
 */
export function summarizeSubject(
  subject: SubjectForSummary,
  mode: CompressionMode = 'balanced'
): SubjectSummary {
  const level = subject.abstractionLevel ?? 20; // Default to middle level
  const name = subject.name || 'Unknown Subject';
  const keywords = extractKeywordStrings(subject.keywords);
  const primaryKeyword = keywords[0] || name.toLowerCase();
  const messageCount = subject.messageCount || 0;
  const description = subject.description;

  let text: string;

  switch (mode) {
    case 'rich':
      // Full details: name, level, description, keywords, message count
      text = formatRich({ name, level, description, keywords, messageCount });
      break;

    case 'balanced':
      // Name and level with optional primary keyword
      text = formatBalanced({ name, level, primaryKeyword });
      break;

    case 'minimal':
      // Level and primary keyword only
      text = formatMinimal({ level, primaryKeyword });
      break;

    case 'extreme':
      // Just the abstraction level number
      text = formatExtreme({ level });
      break;

    default:
      text = formatBalanced({ name, level, primaryKeyword });
  }

  const estimatedTokens = estimateTokens(text);

  return { text, estimatedTokens, mode };
}

/**
 * Format in rich mode (full details)
 */
function formatRich(params: {
  name: string;
  level: number;
  description?: string;
  keywords: string[];
  messageCount: number;
}): string {
  const { name, level, description, keywords, messageCount } = params;
  const levelName = getLevelName(level);

  const parts: string[] = [
    `${name} (level ${level}: ${levelName})`
  ];

  if (description) {
    // Truncate long descriptions
    const truncatedDesc = description.length > 100
      ? description.substring(0, 97) + '...'
      : description;
    parts.push(`  Description: "${truncatedDesc}"`);
  }

  if (keywords.length > 0) {
    parts.push(`  Keywords: ${keywords.slice(0, 5).join(', ')}`);
  }

  parts.push(`  ${messageCount} messages`);

  return parts.join('\n');
}

/**
 * Format in balanced mode (name + level)
 */
function formatBalanced(params: {
  name: string;
  level: number;
  primaryKeyword: string;
}): string {
  const { name, level } = params;
  return `${level}: ${name}`;
}

/**
 * Format in minimal mode (level + keyword)
 */
function formatMinimal(params: {
  level: number;
  primaryKeyword: string;
}): string {
  const { level, primaryKeyword } = params;
  return `${level}: ${primaryKeyword}`;
}

/**
 * Format in extreme mode (just level)
 */
function formatExtreme(params: {
  level: number;
}): string {
  const { level } = params;
  return `${level}`;
}

/**
 * Summarize multiple subjects with automatic compression
 */
export function summarizeSubjects(
  subjects: SubjectForSummary[],
  targetTokenBudget: number,
  mode: CompressionMode = 'balanced'
): {
  summaries: SubjectSummary[];
  totalTokens: number;
  mode: CompressionMode;
} {
  let currentMode = mode;
  let summaries = subjects.map(s => summarizeSubject(s, currentMode));
  let totalTokens = summaries.reduce((sum, s) => sum + s.estimatedTokens, 0);

  // If over budget, progressively compress
  const compressionSequence: CompressionMode[] = ['rich', 'balanced', 'minimal', 'extreme'];
  let currentModeIndex = compressionSequence.indexOf(currentMode);

  while (totalTokens > targetTokenBudget && currentModeIndex < compressionSequence.length - 1) {
    currentModeIndex++;
    currentMode = compressionSequence[currentModeIndex];
    summaries = subjects.map(s => summarizeSubject(s, currentMode));
    totalTokens = summaries.reduce((sum, s) => sum + s.estimatedTokens, 0);
  }

  return { summaries, totalTokens, mode: currentMode };
}

/**
 * Format past subjects for prompt inclusion
 */
export function formatPastSubjectsForPrompt(
  subjects: SubjectForSummary[],
  tokenBudget: number,
  initialMode: CompressionMode = 'balanced'
): string {
  if (subjects.length === 0) {
    return '';
  }

  const result = summarizeSubjects(subjects, tokenBudget, initialMode);

  const header = `Past subjects (${subjects.length}) [${result.mode} mode]:`;
  const subjectLines = result.summaries.map(s => `- ${s.text}`);

  return [header, ...subjectLines, '', 'Use subject:get-messages tool to retrieve full context when needed.'].join('\n');
}

/**
 * Estimate token count (rough heuristic: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract keyword strings from various formats
 */
function extractKeywordStrings(keywords?: string[] | any[]): string[] {
  if (!keywords || keywords.length === 0) {
    return [];
  }

  // If already string array, return as-is
  if (typeof keywords[0] === 'string') {
    return keywords as string[];
  }

  // If IdHash array or objects, try to extract 'term' property or convert to string
  return keywords.map(k => {
    if (typeof k === 'object' && k.term) {
      return k.term;
    }
    return String(k);
  }).filter(Boolean);
}

/**
 * Get compression statistics
 */
export function getCompressionStats(subjects: SubjectForSummary[]): {
  rich: number;
  balanced: number;
  minimal: number;
  extreme: number;
  compressionRatio: {
    balancedVsRich: string;
    minimalVsRich: string;
    extremeVsRich: string;
  };
} {
  const richSummaries = subjects.map(s => summarizeSubject(s, 'rich'));
  const balancedSummaries = subjects.map(s => summarizeSubject(s, 'balanced'));
  const minimalSummaries = subjects.map(s => summarizeSubject(s, 'minimal'));
  const extremeSummaries = subjects.map(s => summarizeSubject(s, 'extreme'));

  const richTokens = richSummaries.reduce((sum, s) => sum + s.estimatedTokens, 0);
  const balancedTokens = balancedSummaries.reduce((sum, s) => sum + s.estimatedTokens, 0);
  const minimalTokens = minimalSummaries.reduce((sum, s) => sum + s.estimatedTokens, 0);
  const extremeTokens = extremeSummaries.reduce((sum, s) => sum + s.estimatedTokens, 0);

  return {
    rich: richTokens,
    balanced: balancedTokens,
    minimal: minimalTokens,
    extreme: extremeTokens,
    compressionRatio: {
      balancedVsRich: `${((balancedTokens / richTokens) * 100).toFixed(1)}%`,
      minimalVsRich: `${((minimalTokens / richTokens) * 100).toFixed(1)}%`,
      extremeVsRich: `${((extremeTokens / richTokens) * 100).toFixed(1)}%`
    }
  };
}
