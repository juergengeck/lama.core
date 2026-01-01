/**
 * AI Settings Resolver
 *
 * Resolves AI behavior settings by merging:
 * 1. AI object global defaults
 * 2. Topic-level per-AI overrides
 *
 * Used by AIMessageListener and TopicAnalysisPlan to determine
 * how an AI should behave in a specific topic.
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { TopicAISettings } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
import type { AI } from './AIManager.js';

// Re-export TopicAISettings from one.models for convenience
export type { TopicAISettings };

/**
 * Resolved AI behavior settings for a specific topic
 */
export interface ResolvedAISettings {
  /** Run analytics extraction on messages */
  analyse: boolean;
  /** Generate AI responses to messages */
  respond: boolean;
  /** Suppress notifications (but still process) */
  mute: boolean;
  /** Skip this AI entirely for this topic */
  ignore: boolean;
  /** When this AI joined the topic (for first-AI ordering) */
  joinedAt: number;
}

/**
 * Topic's AI participants map type (matches Topic.aiParticipants)
 */
export type TopicAIParticipants = Map<SHA256IdHash<Person>, TopicAISettings>;

/**
 * Default AI behavior settings
 */
export const DEFAULT_AI_SETTINGS: Omit<ResolvedAISettings, 'joinedAt'> = {
  analyse: true,
  respond: true,
  mute: false,
  ignore: false
};

/**
 * Default settings for subsequent AIs (not the first one)
 */
export const DEFAULT_SUBSEQUENT_AI_SETTINGS: Omit<ResolvedAISettings, 'joinedAt'> = {
  analyse: false,
  respond: false,
  mute: false,
  ignore: true
};

/**
 * Resolve AI settings for a specific topic
 *
 * Priority: Topic override > AI default > Global default
 *
 * @param ai - The AI object with global defaults
 * @param topicOverride - Optional per-topic override from Topic.aiParticipants
 * @returns Resolved settings
 */
export function resolveAISettings(
  ai: AI,
  topicOverride?: TopicAISettings
): ResolvedAISettings {
  return {
    analyse: topicOverride?.analyse ?? ai.analyse ?? DEFAULT_AI_SETTINGS.analyse,
    respond: topicOverride?.respond ?? ai.respond ?? DEFAULT_AI_SETTINGS.respond,
    mute: topicOverride?.mute ?? ai.mute ?? DEFAULT_AI_SETTINGS.mute,
    ignore: topicOverride?.ignore ?? ai.ignore ?? DEFAULT_AI_SETTINGS.ignore,
    joinedAt: topicOverride?.joinedAt ?? Date.now()
  };
}

/**
 * Get the "first" AI in a topic (lowest joinedAt with respond=true)
 *
 * @param participants - Topic's AI participants map
 * @param getAI - Function to get AI object by personId
 * @returns PersonId of the first AI, or null if none
 */
export async function getFirstAIInTopic(
  participants: TopicAIParticipants,
  getAI: (personId: SHA256IdHash<Person>) => Promise<AI | null>
): Promise<SHA256IdHash<Person> | null> {
  let firstAI: { personId: SHA256IdHash<Person>; joinedAt: number } | null = null;

  for (const [personId, settings] of participants) {
    const ai = await getAI(personId);
    if (!ai) continue;

    const resolved = resolveAISettings(ai, settings);

    // Skip if this AI doesn't respond
    if (!resolved.respond || resolved.ignore) continue;

    // Check if this is the earliest joiner
    if (!firstAI || resolved.joinedAt < firstAI.joinedAt) {
      firstAI = { personId, joinedAt: resolved.joinedAt };
    }
  }

  return firstAI?.personId ?? null;
}

/**
 * Create default settings for a new AI joining a topic
 *
 * @param isFirstAI - Whether this is the first AI in the topic
 * @returns Default TopicAISettings
 */
export function createDefaultTopicAISettings(isFirstAI: boolean): TopicAISettings {
  const defaults = isFirstAI ? DEFAULT_AI_SETTINGS : DEFAULT_SUBSEQUENT_AI_SETTINGS;
  return {
    ...defaults,
    joinedAt: Date.now()
  };
}

/**
 * Check if any AI in the topic should analyse messages
 *
 * @param participants - Topic's AI participants map
 * @param getAI - Function to get AI object by personId
 * @returns True if at least one AI has analyse=true
 */
export async function shouldAnalyseTopic(
  participants: TopicAIParticipants,
  getAI: (personId: SHA256IdHash<Person>) => Promise<AI | null>
): Promise<boolean> {
  for (const [personId, settings] of participants) {
    const ai = await getAI(personId);
    if (!ai) continue;

    const resolved = resolveAISettings(ai, settings);
    if (resolved.analyse && !resolved.ignore) {
      return true;
    }
  }
  return false;
}

/**
 * Get all AIs that should respond in a topic
 *
 * @param participants - Topic's AI participants map
 * @param getAI - Function to get AI object by personId
 * @returns Array of AI personIds that should respond
 */
export async function getRespondingAIs(
  participants: TopicAIParticipants,
  getAI: (personId: SHA256IdHash<Person>) => Promise<AI | null>
): Promise<SHA256IdHash<Person>[]> {
  const responding: SHA256IdHash<Person>[] = [];

  for (const [personId, settings] of participants) {
    const ai = await getAI(personId);
    if (!ai) continue;

    const resolved = resolveAISettings(ai, settings);
    if (resolved.respond && !resolved.ignore) {
      responding.push(personId);
    }
  }

  return responding;
}
