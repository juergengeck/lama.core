/**
 * LLM Registry
 *
 * In-memory registry of available LLM resources.
 * Follows the DiscoveryService pattern - LLMs are ephemeral resources,
 * not identity data. They're discovered at runtime and tracked in memory.
 *
 * Pattern: Demand/Supply
 * - Discovery methods (Ollama, Claude, etc.) supply LLMs to registry
 * - chat() and other consumers demand LLMs from registry
 * - No identity coupling (no leuteModel, no channels)
 */

import { OEvent } from '@refinio/one.models/lib/misc/OEvent.js';
import type { LLM } from '../@OneObjectInterfaces.js';
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('LLMRegistry');

/**
 * Source of LLM discovery
 */
export type LLMSource = 'ollama' | 'lmstudio' | 'anthropic' | 'openai' | 'local' | 'manual';

/**
 * Registry entry wrapping an LLM with metadata
 */
export interface LLMRegistryEntry {
  /** The LLM configuration */
  llm: LLM;

  /** Where this LLM was discovered from */
  source: LLMSource;

  /** Server ID for multi-server support (e.g., "local", "gpu-server") */
  serverId?: string;

  /** When this LLM was first discovered */
  discoveredAt: number;

  /** When this LLM was last verified as available */
  lastVerifiedAt: number;

  /** Whether the LLM is currently reachable */
  available: boolean;
}

/**
 * LLM Registry - In-memory tracking of available LLMs
 *
 * Similar to DiscoveryService.discoveredPeers, but for LLM resources.
 */
export class LLMRegistry {
  /** Registry entries keyed by modelId */
  private entries: Map<string, LLMRegistryEntry> = new Map();

  /** Event: New model discovered */
  public onModelDiscovered = new OEvent<(entry: LLMRegistryEntry) => void>();

  /** Event: Model removed from registry */
  public onModelLost = new OEvent<(modelId: string) => void>();

  /** Event: Model entry updated (e.g., availability changed) */
  public onModelUpdated = new OEvent<(entry: LLMRegistryEntry) => void>();

  /** Event: Registry cleared */
  public onCleared = new OEvent<() => void>();

  /**
   * Register an LLM in the registry
   *
   * @param llm - LLM configuration
   * @param source - Discovery source
   * @param serverId - Optional server identifier for multi-server
   */
  register(llm: LLM, source: LLMSource, serverId?: string): void {
    const modelId = llm.modelId || llm.name;
    if (!modelId) {
      MessageBus.send('error', 'Cannot register LLM without modelId or name');
      return;
    }

    const existing = this.entries.get(modelId);
    const now = Date.now();

    if (existing) {
      // Update existing entry
      existing.llm = llm;
      existing.lastVerifiedAt = now;
      existing.available = true;
      MessageBus.send('debug', `Updated LLM in registry: ${modelId}`);
      this.onModelUpdated.emit(existing);
    } else {
      // New entry
      const entry: LLMRegistryEntry = {
        llm,
        source,
        serverId,
        discoveredAt: now,
        lastVerifiedAt: now,
        available: true
      };
      this.entries.set(modelId, entry);
      MessageBus.send('debug', `Registered LLM: ${modelId} (source: ${source})`);
      this.onModelDiscovered.emit(entry);
    }
  }

  /**
   * Get an LLM by modelId
   */
  get(modelId: string): LLM | null {
    const entry = this.entries.get(modelId);
    return entry?.llm ?? null;
  }

  /**
   * Get registry entry (includes metadata)
   */
  getEntry(modelId: string): LLMRegistryEntry | null {
    return this.entries.get(modelId) ?? null;
  }

  /**
   * Check if an LLM exists in registry
   */
  has(modelId: string): boolean {
    return this.entries.has(modelId);
  }

  /**
   * Get all registered LLMs
   */
  getAll(): LLM[] {
    return Array.from(this.entries.values()).map(e => e.llm);
  }

  /**
   * Get all registry entries
   */
  getAllEntries(): LLMRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get LLMs by provider
   */
  getByProvider(provider: string): LLM[] {
    return this.getAll().filter(llm => llm.provider === provider);
  }

  /**
   * Get LLMs by source
   */
  getBySource(source: LLMSource): LLM[] {
    return Array.from(this.entries.values())
      .filter(e => e.source === source)
      .map(e => e.llm);
  }

  /**
   * Get LLMs by server
   */
  getByServer(server: string): LLM[] {
    return this.getAll().filter(llm => llm.server === server);
  }

  /**
   * Get LLMs by serverId (for multi-server support)
   */
  getByServerId(serverId: string): LLM[] {
    return Array.from(this.entries.values())
      .filter(e => e.serverId === serverId)
      .map(e => e.llm);
  }

  /**
   * Get available LLMs only
   */
  getAvailable(): LLM[] {
    return Array.from(this.entries.values())
      .filter(e => e.available)
      .map(e => e.llm);
  }

  /**
   * Get LLMs by inference type
   */
  getByInferenceType(inferenceType: 'ondevice' | 'server' | 'cloud'): LLM[] {
    return this.getAll().filter(llm => llm.inferenceType === inferenceType);
  }

  /**
   * Mark an LLM as unavailable
   */
  markUnavailable(modelId: string): void {
    const entry = this.entries.get(modelId);
    if (entry && entry.available) {
      entry.available = false;
      MessageBus.send('debug', `Marked LLM unavailable: ${modelId}`);
      this.onModelUpdated.emit(entry);
    }
  }

  /**
   * Mark an LLM as available
   */
  markAvailable(modelId: string): void {
    const entry = this.entries.get(modelId);
    if (entry && !entry.available) {
      entry.available = true;
      entry.lastVerifiedAt = Date.now();
      MessageBus.send('debug', `Marked LLM available: ${modelId}`);
      this.onModelUpdated.emit(entry);
    }
  }

  /**
   * Remove an LLM from registry
   */
  remove(modelId: string): boolean {
    if (this.entries.delete(modelId)) {
      MessageBus.send('debug', `Removed LLM from registry: ${modelId}`);
      this.onModelLost.emit(modelId);
      return true;
    }
    return false;
  }

  /**
   * Remove all LLMs from a specific source
   */
  removeBySource(source: LLMSource): number {
    let count = 0;
    for (const [modelId, entry] of this.entries) {
      if (entry.source === source) {
        this.entries.delete(modelId);
        this.onModelLost.emit(modelId);
        count++;
      }
    }
    if (count > 0) {
      MessageBus.send('debug', `Removed ${count} LLMs from source: ${source}`);
    }
    return count;
  }

  /**
   * Remove all LLMs from a specific server
   */
  removeByServer(server: string): number {
    let count = 0;
    for (const [modelId, entry] of this.entries) {
      if (entry.llm.server === server) {
        this.entries.delete(modelId);
        this.onModelLost.emit(modelId);
        count++;
      }
    }
    if (count > 0) {
      MessageBus.send('debug', `Removed ${count} LLMs from server: ${server}`);
    }
    return count;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    const count = this.entries.size;
    this.entries.clear();
    if (count > 0) {
      MessageBus.send('debug', `Cleared ${count} LLMs from registry`);
      this.onCleared.emit();
    }
  }

  /**
   * Get count of registered LLMs
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Debug: Get summary of registry contents
   */
  getSummary(): { total: number; bySource: Record<string, number>; byProvider: Record<string, number> } {
    const bySource: Record<string, number> = {};
    const byProvider: Record<string, number> = {};

    for (const entry of this.entries.values()) {
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
      const provider = entry.llm.provider || 'unknown';
      byProvider[provider] = (byProvider[provider] || 0) + 1;
    }

    return {
      total: this.entries.size,
      bySource,
      byProvider
    };
  }
}

// Singleton instance
let registryInstance: LLMRegistry | null = null;

/**
 * Get the global LLM registry instance
 */
export function getLLMRegistry(): LLMRegistry {
  if (!registryInstance) {
    registryInstance = new LLMRegistry();
  }
  return registryInstance;
}

/**
 * Register an LLM in the global registry
 * Convenience function for discovery code
 */
export function registerLLM(llm: LLM, source: LLMSource, serverId?: string): void {
  getLLMRegistry().register(llm, source, serverId);
}
