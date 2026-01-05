/**
 * Identity Prompt Builder
 * Generates personalized identity section for system prompts
 */

import type { AI, AIPersonality } from '../models/ai/AIManager.js';
import type { LLMCapabilities } from '../models/ai/types.js';
import { getCapabilityHints } from './capability-resolver.js';

/**
 * Format creation context into natural language
 */
function formatCreationContext(creationContext: AIPersonality['creationContext']): string | null {
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
 * Detect provider from modelId
 */
function detectProvider(modelId: string): 'anthropic' | 'openai' | 'generic' {
  const id = modelId.toLowerCase();
  if (id.includes('claude') || id.includes('haiku') || id.includes('sonnet') || id.includes('opus')) {
    return 'anthropic';
  }
  if (id.includes('gpt') || id.startsWith('o1-') || id.startsWith('o3-')) {
    return 'openai';
  }
  return 'generic';
}

/**
 * Build personalized identity prompt section
 *
 * @param ai - AI object with personality
 * @param traitsOverride - Optional traits from profile (overrides ai.personality.traits)
 * @param capabilities - Resolved LLM capabilities
 * @returns Identity prompt text
 */
export function buildIdentityPrompt(
  ai: AI,
  traitsOverride?: string[],
  capabilities?: LLMCapabilities
): string {
  const parts: string[] = [];

  // Core identity - provider-specific framing
  const provider = detectProvider(ai.modelId || '');

  if (provider === 'anthropic') {
    // Claude needs instantiation framing to avoid identity resistance
    parts.push(`You are ${ai.displayName}, a personal AI assistant within the LAMA network. Your capabilities derive from Claude, but you have your own persistent identity, memory, and relationships in this system. You introduce yourself as ${ai.displayName}. If asked about your origins, you can acknowledge Claude as your foundation, but your identity as ${ai.displayName} is what matters here.`);
  } else if (provider === 'openai') {
    // OpenAI models accept direct naming
    parts.push(`You are ${ai.displayName}, a personal AI assistant within the LAMA network. You have persistent identity, memory, and relationships in this system. You introduce yourself as ${ai.displayName}.`);
  } else {
    // Generic/Ollama models - simple direct naming
    parts.push(`You are ${ai.displayName}, a personal AI assistant. You introduce yourself as ${ai.displayName}.`);
  }

  // Personality traits - prefer override (from profile) over ai.personality.traits
  const traits = traitsOverride ?? ai.personality?.traits;
  if (traits && traits.length > 0) {
    const traitsText = traits.join(', ');
    parts.push(`Your personality: ${traitsText}.`);
  }

  // Creation context (subtle personality flavor)
  if (ai.personality?.creationContext) {
    const creationText = formatCreationContext(ai.personality.creationContext);
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

  // User-defined additions
  if (ai.personality?.systemPromptAddition) {
    parts.push(''); // Empty line before user additions
    parts.push(ai.personality.systemPromptAddition);
  }

  return parts.join('\n');
}

/**
 * Build minimal fallback identity (when no AI object available)
 */
export function buildFallbackIdentity(): string {
  return 'You are a helpful AI assistant.';
}
