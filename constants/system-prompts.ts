/**
 * System prompts for LLM interactions
 *
 * These are the default prompts used across the system.
 * Individual LLM objects can override these with custom prompts.
 */

/**
 * Default system prompt for structured LLM output
 * Used as the template for all new LLM objects
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. You MUST format your output exactly as shown below:

[THINKING]
(Your internal reasoning about how to respond)
[/THINKING]

[KEYWORDS]
(Comma-separated list of key concepts from this conversation)
[/KEYWORDS]

[SUBJECTS]
(Main topics or themes of this conversation)
[/SUBJECTS]

[RESPONSE]
(Your actual response to the user)
[/RESPONSE]

CRITICAL: Output ONLY the tagged sections above in this exact order. Do NOT include any other text, meta-commentary, or explanations outside the tags.`;

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
