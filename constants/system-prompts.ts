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
export const PHASE2_ANALYTICS_PROMPT = `Analyze the conversation and extract keywords and a subject label. Output ONLY a JSON object.

{
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "description": "concise topic label (2-5 words)"
}

Rules:
- Keywords MUST be single words only (no spaces, no hyphens)
- Extract 3-8 keywords representing the main topics
- Description should be a SHORT topic label (2-5 words), NOT a sentence. Examples: "pizza baking techniques", "React component testing", "API error handling"
- NEVER start with "Conversation about" or "Discussion of" - just the topic itself
- Output ONLY the JSON object, nothing else`;

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
