/**
 * Static welcome messages for default chats
 * Available in both lama.browser and lama.electron
 */

/**
 * Static welcome message for the "Hi" chat with local models
 * This is shown immediately without LLM generation
 */
export const HI_WELCOME_MESSAGE_LOCAL = `Hi! I'm LAMA, your local AI assistant.

I run entirely on your device - no cloud, just private, fast AI help.

What can I do for you today?`;

/**
 * Static welcome message for the "Hi" chat with cloud API models
 * This is shown when using Anthropic Claude, OpenAI, etc.
 */
export const HI_WELCOME_MESSAGE_CLOUD = `Hi! I'm LAMA, your AI assistant.

I'm powered by a cloud AI model to provide you with advanced capabilities.

What can I do for you today?`;

/**
 * Get the appropriate welcome message based on model provider
 * @param provider - The LLM provider (ollama, anthropic, openai, etc.)
 */
export function getWelcomeMessage(provider?: string): string {
  // Cloud providers: anthropic, openai
  // Local providers: ollama, lmstudio, meta
  const cloudProviders = ['anthropic', 'openai'];
  const isCloudProvider = provider && cloudProviders.includes(provider);
  return isCloudProvider ? HI_WELCOME_MESSAGE_CLOUD : HI_WELCOME_MESSAGE_LOCAL;
}

/**
 * Legacy export for backward compatibility
 * @deprecated Use getWelcomeMessage() instead
 */
export const HI_WELCOME_MESSAGE = HI_WELCOME_MESSAGE_LOCAL;
