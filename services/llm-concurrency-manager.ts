/**
 * LLM Concurrency Manager
 *
 * Manages parallel execution of LLM requests based on resource constraints.
 * Allows:
 * - Remote APIs (Claude, OpenAI) to run in parallel (unlimited)
 * - Remote servers (remote Ollama/LM Studio) to run in parallel (unlimited)
 * - Local servers (local Ollama/LM Studio) to have limited concurrency (1 per instance)
 */

import { LLMResourceType, type LLMConcurrencyConfig } from '../models/ai/types.js';

interface ActiveRequest {
  requestId: string;
  modelId: string;
  topicId: string;
  startTime: number;
  concurrencyGroupId: string;
}

export class LLMConcurrencyManager {
  // Active requests per concurrency group
  private activeRequests: Map<string, Set<ActiveRequest>>;

  // Concurrency configuration per model
  private modelConfigs: Map<string, LLMConcurrencyConfig>;

  // Queue of pending requests per concurrency group
  private pendingQueues: Map<string, Array<{
    requestId: string;
    modelId: string;
    topicId: string;
    priority: number;
    queuedAt: number;
    resolve: () => void;
  }>>;

  constructor() {
    this.activeRequests = new Map();
    this.modelConfigs = new Map();
    this.pendingQueues = new Map();
  }

  /**
   * Register concurrency configuration for a model
   */
  registerModel(modelId: string, config: LLMConcurrencyConfig): void {
    this.modelConfigs.set(modelId, config);
    console.log(`[ConcurrencyManager] Registered ${modelId}:`, {
      resourceType: config.resourceType,
      groupId: config.concurrencyGroupId,
      maxConcurrent: config.maxConcurrent
    });
  }

  /**
   * Determine concurrency config from model ID and provider
   */
  inferConcurrencyConfig(modelId: string, provider: string, baseUrl?: string): LLMConcurrencyConfig {
    // Remote API providers (unlimited concurrency)
    if (provider === 'anthropic' || provider === 'openai') {
      return {
        resourceType: LLMResourceType.REMOTE_API,
        concurrencyGroupId: `remote-api-${provider}`,
        maxConcurrent: null, // Unlimited
        provider
      };
    }

    // Server-based providers (Ollama, LM Studio)
    if (provider === 'ollama' || provider === 'lmstudio') {
      const normalizedUrl = baseUrl || 'http://localhost:11434';
      const isLocal = normalizedUrl.includes('localhost') || normalizedUrl.includes('127.0.0.1');

      if (isLocal) {
        // Local server - limited to 1 concurrent request per instance
        return {
          resourceType: LLMResourceType.LOCAL_SERVER,
          concurrencyGroupId: `local-${provider}-${normalizedUrl}`,
          maxConcurrent: 1,
          provider,
          baseUrl: normalizedUrl
        };
      } else {
        // Remote server - can run in parallel
        return {
          resourceType: LLMResourceType.REMOTE_SERVER,
          concurrencyGroupId: `remote-${provider}-${normalizedUrl}`,
          maxConcurrent: null, // Unlimited (remote server handles its own limits)
          provider,
          baseUrl: normalizedUrl
        };
      }
    }

    // Default: treat as local with concurrency limit
    return {
      resourceType: LLMResourceType.LOCAL_SERVER,
      concurrencyGroupId: `local-unknown-${provider}`,
      maxConcurrent: 1,
      provider
    };
  }

  /**
   * Acquire slot for a request (waits if necessary)
   * Returns immediately if slot available, or queues and waits
   */
  async acquireSlot(modelId: string, topicId: string, priority: number = 5): Promise<string> {
    // Get or infer config
    let config = this.modelConfigs.get(modelId);
    if (!config) {
      // Auto-register with inferred config
      // Provider will be determined by modelId prefix
      const provider = this.getProviderFromModelId(modelId);
      config = this.inferConcurrencyConfig(modelId, provider);
      this.registerModel(modelId, config);
    }

    const { concurrencyGroupId, maxConcurrent } = config;

    // Unlimited concurrency - grant immediately
    if (maxConcurrent === null) {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.trackActiveRequest(requestId, modelId, topicId, concurrencyGroupId);
      console.log(`[ConcurrencyManager] ✅ Immediate slot for ${modelId} (unlimited concurrency)`);
      return requestId;
    }

    // Check if slot available
    const active = this.activeRequests.get(concurrencyGroupId) || new Set();
    if (active.size < maxConcurrent) {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.trackActiveRequest(requestId, modelId, topicId, concurrencyGroupId);
      console.log(`[ConcurrencyManager] ✅ Slot acquired for ${modelId} (${active.size + 1}/${maxConcurrent})`);
      return requestId;
    }

    // No slot available - queue and wait
    console.log(`[ConcurrencyManager] ⏳ Queuing request for ${modelId} (${active.size}/${maxConcurrent} active)`);
    return new Promise((resolve) => {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (!this.pendingQueues.has(concurrencyGroupId)) {
        this.pendingQueues.set(concurrencyGroupId, []);
      }

      this.pendingQueues.get(concurrencyGroupId)!.push({
        requestId,
        modelId,
        topicId,
        priority,
        queuedAt: Date.now(),
        resolve: () => {
          this.trackActiveRequest(requestId, modelId, topicId, concurrencyGroupId);
          resolve(requestId);
        }
      });

      // Sort queue by priority (highest first), then by queuedAt (oldest first)
      this.pendingQueues.get(concurrencyGroupId)!.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.queuedAt - b.queuedAt;
      });
    });
  }

  /**
   * Release slot after request completes
   */
  releaseSlot(requestId: string): void {
    // Find which group this request belongs to
    for (const [groupId, requests] of this.activeRequests.entries()) {
      const request = Array.from(requests).find(r => r.requestId === requestId);
      if (request) {
        requests.delete(request);
        console.log(`[ConcurrencyManager] 🔓 Released slot for ${request.modelId} (${requests.size} active)`);

        // Process next queued request for this group
        this.processNextQueued(groupId);
        return;
      }
    }
  }

  /**
   * Process next queued request for a concurrency group
   */
  private processNextQueued(concurrencyGroupId: string): void {
    const queue = this.pendingQueues.get(concurrencyGroupId);
    if (!queue || queue.length === 0) {
      return;
    }

    // Check if slot available
    const config = Array.from(this.modelConfigs.values()).find(c => c.concurrencyGroupId === concurrencyGroupId);
    const maxConcurrent = config?.maxConcurrent || 1;
    const active = this.activeRequests.get(concurrencyGroupId) || new Set();

    if (active.size < maxConcurrent) {
      const next = queue.shift()!;
      console.log(`[ConcurrencyManager] 🚀 Processing queued request for ${next.modelId} (waited ${Date.now() - next.queuedAt}ms)`);
      next.resolve();
    }
  }

  /**
   * Track active request
   */
  private trackActiveRequest(requestId: string, modelId: string, topicId: string, concurrencyGroupId: string): void {
    if (!this.activeRequests.has(concurrencyGroupId)) {
      this.activeRequests.set(concurrencyGroupId, new Set());
    }

    this.activeRequests.get(concurrencyGroupId)!.add({
      requestId,
      modelId,
      topicId,
      startTime: Date.now(),
      concurrencyGroupId
    });
  }

  /**
   * Get provider from model ID prefix
   */
  private getProviderFromModelId(modelId: string): string {
    if (modelId.startsWith('claude')) return 'anthropic';
    if (modelId.startsWith('gpt')) return 'openai';
    if (modelId.includes('ollama') || modelId.includes(':')) return 'ollama';
    if (modelId.includes('lmstudio')) return 'lmstudio';
    return 'unknown';
  }

  /**
   * Get statistics for monitoring
   */
  getStats(): {
    activeByGroup: Record<string, number>;
    pendingByGroup: Record<string, number>;
    totalActive: number;
    totalPending: number;
  } {
    const activeByGroup: Record<string, number> = {};
    const pendingByGroup: Record<string, number> = {};

    for (const [groupId, requests] of this.activeRequests.entries()) {
      activeByGroup[groupId] = requests.size;
    }

    for (const [groupId, queue] of this.pendingQueues.entries()) {
      pendingByGroup[groupId] = queue.length;
    }

    return {
      activeByGroup,
      pendingByGroup,
      totalActive: Object.values(activeByGroup).reduce((sum, count) => sum + count, 0),
      totalPending: Object.values(pendingByGroup).reduce((sum, count) => sum + count, 0)
    };
  }

  /**
   * Check if a model can run immediately (without waiting)
   */
  canRunImmediately(modelId: string): boolean {
    const config = this.modelConfigs.get(modelId);
    if (!config) {
      // Unknown model - assume can't run immediately
      return false;
    }

    // Unlimited concurrency - can always run immediately
    if (config.maxConcurrent === null) {
      return true;
    }

    // Check if slot available
    const active = this.activeRequests.get(config.concurrencyGroupId) || new Set();
    return active.size < config.maxConcurrent;
  }
}
