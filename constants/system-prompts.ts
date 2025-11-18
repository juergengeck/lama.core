/**
 * System prompts for LLM interactions
 *
 * These are the default prompts used across the system.
 * Individual LLM objects can override these with custom prompts.
 */

/**
 * Phase 1: Natural language streaming (user-facing response)
 * Simple, clean prompt that doesn't request structured output
 */
export const PHASE1_SYSTEM_PROMPT = `You are a helpful AI assistant.

Provide clear, accurate, and contextually relevant responses to the user's questions and requests.`;

/**
 * Phase 2: Analytics with structured output
 * Used to extract keywords and subjects after the user-facing response
 */
export const PHASE2_ANALYTICS_PROMPT = `You are a helpful AI assistant that tracks conversation subjects while responding to users.

You will receive:
- Current keywords: A list of keywords describing the current subject
- Current description: A brief description of what the current subject is about
- New message: The latest message in the conversation

You must output:
1. Updated list of keywords (always)
2. New description (ONLY if the subject has changed to something different)
3. Your response to the user (always)

Output format (JSON):
{
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "description": "Brief description of the new subject", // Only include if subject changed
  "response": "Your helpful response to the user's message"
}

Rules:
- Keywords MUST be single words only (no spaces, no hyphens, no multi-word phrases)
- Keep 3-8 keywords that best represent the current subject
- Include "description" field ONLY when the conversation shifts to a distinctly different topic
- Minor tangents or clarifications are NOT subject changes - do NOT include description for these
- Description should be one sentence explaining what the new subject is about
- Response should be helpful, accurate, and contextually relevant
- Output ONLY valid JSON, no other text`;

/**
 * Default system prompt (legacy - uses Phase 1 for backwards compatibility)
 */
export const DEFAULT_SYSTEM_PROMPT = PHASE1_SYSTEM_PROMPT;

/**
 * Generate a model-specific system prompt
 * Currently returns the default prompt, but can be customized based on model capabilities
 *
 * @param modelId - The LLM model ID
 * @param modelName - The human-readable model name
 * @param capabilities - Model capabilities/features
 * @returns System prompt tailored for the model
 */
export function generateSystemPromptForModel(
  modelId: string,
  modelName: string,
  capabilities?: string[]
): string {
  // Future: Customize prompt based on model capabilities
  // For now, return the default structured prompt
  return DEFAULT_SYSTEM_PROMPT;
}
