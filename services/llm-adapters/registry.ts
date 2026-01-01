/**
 * LLM Adapter Registry
 *
 * Central registry for LLM adapters. Platforms register adapters at startup,
 * and the LLMManager uses this registry to find the appropriate adapter
 * for each LLM based on its properties.
 *
 * Selection priority:
 * 1. Exact match on provider
 * 2. Match on inferenceType (ondevice/server/cloud)
 * 3. canHandle() check for edge cases
 */

import type { LLM } from '../../@OneObjectInterfaces.js';
import type { LLMAdapter, LLMAdapterRegistry } from './types.js';
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('LLMAdapterRegistry');

class AdapterRegistry implements LLMAdapterRegistry {
  private adapters: Map<string, LLMAdapter> = new Map();

  /**
   * Register an adapter
   * Key is the adapter's id (typically matches provider name)
   */
  register(adapter: LLMAdapter): void {
    if (this.adapters.has(adapter.id)) {
      MessageBus.send('debug', `Replacing existing adapter: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
    MessageBus.send('debug', `Registered adapter: ${adapter.id} (${adapter.name})`);
  }

  /**
   * Get the appropriate adapter for an LLM
   *
   * Selection logic:
   * 1. If LLM has a provider, look for exact match
   * 2. If no exact match, try inferenceType-based lookup
   * 3. Fall back to canHandle() check across all adapters
   */
  getAdapter(llm: LLM): LLMAdapter | null {
    // 1. Exact match on provider
    if (llm.provider) {
      const adapter = this.adapters.get(llm.provider);
      if (adapter) {
        MessageBus.send('debug', `Found adapter by provider: ${llm.provider}`);
        return adapter;
      }
    }

    // 2. Match on inferenceType (maps to adapter conventions)
    if (llm.inferenceType) {
      // 'ondevice' typically handled by 'transformers' adapter
      // 'server' could be ollama, lmstudio, etc. - need provider
      // 'cloud' could be anthropic, openai - need provider
      const inferenceTypeAdapters: Record<string, string[]> = {
        ondevice: ['transformers', 'local'],
        server: ['ollama', 'lmstudio', 'vllm'],
        cloud: ['anthropic', 'openai', 'google']
      };

      const candidates = inferenceTypeAdapters[llm.inferenceType] || [];
      for (const candidateId of candidates) {
        const adapter = this.adapters.get(candidateId);
        if (adapter && adapter.canHandle(llm)) {
          MessageBus.send('debug', `Found adapter by inferenceType: ${candidateId}`);
          return adapter;
        }
      }
    }

    // 3. Fall back to canHandle() check
    for (const adapter of this.adapters.values()) {
      if (adapter.canHandle(llm)) {
        MessageBus.send('debug', `Found adapter by canHandle: ${adapter.id}`);
        return adapter;
      }
    }

    MessageBus.send('error', `No adapter found for LLM: provider=${llm.provider}, inferenceType=${llm.inferenceType}`);
    return null;
  }

  /**
   * Get all registered adapters
   */
  getAllAdapters(): LLMAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Check if an adapter exists for the given provider
   */
  hasAdapter(provider: string): boolean {
    return this.adapters.has(provider);
  }

  /**
   * Clear all adapters (useful for testing)
   */
  clear(): void {
    this.adapters.clear();
  }

  /**
   * Set platform on all adapters that support it
   * Some adapters (like TransformersAdapter) need the platform for local inference
   */
  setPlatform(platform: any): void {
    MessageBus.send('debug', `AdapterRegistry.setPlatform: setting platform on ${this.adapters.size} adapters`);
    for (const adapter of this.adapters.values()) {
      MessageBus.send('debug', `AdapterRegistry: checking adapter ${adapter.id} for setPlatform: ${'setPlatform' in adapter}`);
      if ('setPlatform' in adapter && typeof (adapter as any).setPlatform === 'function') {
        (adapter as any).setPlatform(platform);
        MessageBus.send('debug', `AdapterRegistry: Set platform on adapter: ${adapter.id}`);
      }
    }
  }
}

// Singleton instance
let registryInstance: AdapterRegistry | null = null;

/**
 * Get the global adapter registry instance
 */
export function getAdapterRegistry(): LLMAdapterRegistry {
  if (!registryInstance) {
    registryInstance = new AdapterRegistry();
  }
  return registryInstance;
}

/**
 * Register an adapter in the global registry
 * Convenience function for platform initialization
 */
export function registerAdapter(adapter: LLMAdapter): void {
  getAdapterRegistry().register(adapter);
}
