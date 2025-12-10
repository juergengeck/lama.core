/**
 * LLM Adapters Module
 *
 * Provides the adapter pattern for LLM backends.
 * Platforms register adapters, LLMManager uses them.
 */

// Types and registry
export * from './types.js';
export * from './registry.js';

// Adapter implementations
export { AnthropicAdapter } from './anthropic-adapter.js';
export { OllamaAdapter } from './ollama-adapter.js';
export { OpenAIAdapter } from './openai-adapter.js';
export { TransformersAdapter } from './transformers-adapter.js';

import { registerAdapter } from './registry.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { OpenAIAdapter } from './openai-adapter.js';
import { TransformersAdapter } from './transformers-adapter.js';

/**
 * Register all default adapters
 * Call this at application startup
 */
export function registerDefaultAdapters(): void {
  registerAdapter(new AnthropicAdapter());
  registerAdapter(new OllamaAdapter());
  registerAdapter(new OpenAIAdapter());
  registerAdapter(new TransformersAdapter());
}
