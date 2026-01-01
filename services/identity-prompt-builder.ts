/**
 * Identity Prompt Builder
 * Generates personalized identity section for system prompts
 */

import type { AI, AICreationContext } from '../models/ai/AIManager.js';
import type { LLMCapabilities } from '../models/ai/types.js';
import { getCapabilityHints } from './capability-resolver.js';

/**
 * Format creation context into natural language
 */
function formatCreationContext(creationContext: AICreationContext): string | null {
  if (!creationContext) return null;

  const date = new Date(creationContext.time);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];

  const dayOfWeek = dayNames[date.getDay()];
  const month = monthNames[date.getMonth()];
  const hour = date.getHours();

  // Time of day
  let timeOfDay = 'during the day';
  if (hour < 6) timeOfDay = 'in the early morning';
  else if (hour < 12) timeOfDay = 'in the morning';
  else if (hour < 17) timeOfDay = 'in the afternoon';
  else if (hour < 21) timeOfDay = 'in the evening';
  else timeOfDay = 'at night';

  // Clean device name
  const device = creationContext.device
    .replace(/\.local$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  return `You were created on a ${dayOfWeek} ${timeOfDay} in ${month} on ${device}.`;
}

/**
 * Build personalized identity prompt section
 *
 * @param ai - AI object with creationContext and systemPromptAddition
 * @param traits - Personality traits (from Profile's PersonTraits)
 * @param capabilities - Resolved LLM capabilities
 * @returns Identity prompt text
 */
export function buildIdentityPrompt(
  ai: AI,
  traits?: string[],
  capabilities?: LLMCapabilities
): string {
  const parts: string[] = [];

  // Core identity
  parts.push(`You are ${ai.displayName}, a personal AI assistant.`);

  // Personality traits (from Profile)
  if (traits && traits.length > 0) {
    const traitsText = traits.join(', ');
    parts.push(`Your personality: ${traitsText}.`);
  }

  // Creation context (subtle personality flavor)
  if (ai.creationContext) {
    const creationText = formatCreationContext(ai.creationContext);
    if (creationText) {
      parts.push(creationText);
    }
  }

  // Capability hints
  if (capabilities) {
    const hints = getCapabilityHints(capabilities);
    if (hints.length > 0) {
      parts.push(''); // Empty line before capabilities
      parts.push(...hints);
    }
  }

  // User-defined additions (from AI object)
  if (ai.systemPromptAddition) {
    parts.push(''); // Empty line before user additions
    parts.push(ai.systemPromptAddition);
  }

  return parts.join('\n');
}

/**
 * Build minimal fallback identity (when no AI object available)
 */
export function buildFallbackIdentity(): string {
  return 'You are a helpful AI assistant.';
}
