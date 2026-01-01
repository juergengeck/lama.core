/**
 * Welcome message templates for default chats
 * Available in both lama.browser and lama.electron
 */

/**
 * Generate welcome message for local models
 * @param aiName - The AI's display name
 */
export function getLocalWelcomeMessage(aiName: string): string {
  return `Hi! I'm ${aiName}, your local AI assistant.

I run entirely on your device - no cloud, just private, fast AI help.

What can I do for you today?`;
}

/**
 * Generate welcome message for cloud API models
 * @param aiName - The AI's display name
 */
export function getCloudWelcomeMessage(aiName: string): string {
  return `Hi! I'm ${aiName}, your AI assistant.

I'm powered by a cloud AI model to provide you with advanced capabilities.

What can I do for you today?`;
}

/**
 * Get the appropriate welcome message based on model provider
 * @param provider - The LLM provider (ollama, anthropic, openai, etc.)
 * @param aiName - The AI's display name (defaults to 'your AI assistant')
 */
export function getWelcomeMessage(provider?: string, aiName: string = 'your AI assistant'): string {
  // Cloud providers: anthropic, openai
  // Local providers: ollama, lmstudio, meta
  const cloudProviders = ['anthropic', 'openai'];
  const isCloudProvider = provider && cloudProviders.includes(provider);
  return isCloudProvider ? getCloudWelcomeMessage(aiName) : getLocalWelcomeMessage(aiName);
}

/**
 * Legacy exports for backward compatibility
 * @deprecated Use getWelcomeMessage(provider, aiName) instead
 */
export const HI_WELCOME_MESSAGE_LOCAL = getLocalWelcomeMessage('your AI assistant');
export const HI_WELCOME_MESSAGE_CLOUD = getCloudWelcomeMessage('your AI assistant');
export const HI_WELCOME_MESSAGE = HI_WELCOME_MESSAGE_LOCAL;
