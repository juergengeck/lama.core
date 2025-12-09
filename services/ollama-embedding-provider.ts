/**
 * OllamaEmbeddingProvider - EmbeddingProvider implementation using Ollama
 *
 * Uses Ollama's /api/embeddings endpoint with configurable model.
 * Default model: nomic-embed-text (768 dimensions)
 */

import type { EmbeddingProvider, EmbeddingModel } from '@cube/meaning.core';
import { embedWithOllama, embedBatchWithOllama } from './ollama.js';

export interface OllamaEmbeddingConfig {
  /** Ollama embedding model name (default: 'nomic-embed-text') */
  model?: string;
  /** Ollama base URL (default: 'http://localhost:11434') */
  baseUrl?: string;
  /** Optional auth headers */
  authHeaders?: Record<string, string>;
}

/**
 * EmbeddingProvider implementation for Ollama
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly model: EmbeddingModel;
  private readonly ollamaModel: string;
  private readonly baseUrl: string;
  private readonly authHeaders?: Record<string, string>;

  constructor(config: OllamaEmbeddingConfig = {}) {
    this.ollamaModel = config.model || 'nomic-embed-text';
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.authHeaders = config.authHeaders;

    // Map Ollama model to EmbeddingModel type
    // nomic-embed-text maps to nomic-embed-text-v1.5 in meaning.core
    this.model = this.ollamaModel.startsWith('nomic-embed')
      ? 'nomic-embed-text-v1.5'
      : 'custom';
  }

  /**
   * Generate embedding for text
   */
  async embed(text: string): Promise<number[]> {
    return embedWithOllama(
      this.ollamaModel,
      text,
      this.baseUrl,
      this.authHeaders
    );
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return embedBatchWithOllama(
      this.ollamaModel,
      texts,
      this.baseUrl,
      this.authHeaders
    );
  }

  /**
   * Get the Ollama model name
   */
  getOllamaModel(): string {
    return this.ollamaModel;
  }
}

/**
 * Default embedding model for LAMA
 */
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * Create OllamaEmbeddingProvider with settings from config
 */
export function createOllamaEmbeddingProvider(
  embeddingModel?: string,
  ollamaBaseUrl?: string,
  authHeaders?: Record<string, string>
): OllamaEmbeddingProvider {
  return new OllamaEmbeddingProvider({
    model: embeddingModel || DEFAULT_EMBEDDING_MODEL,
    baseUrl: ollamaBaseUrl,
    authHeaders
  });
}
