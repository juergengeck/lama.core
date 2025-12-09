/**
 * AI Initialization Plan
 *
 * Platform-agnostic business logic for AI initialization.
 * NO platform-specific imports - uses dependency injection.
 *
 * Principles:
 * - Dependency injection for platform-specific code (UserSettingsManager, AIAssistant)
 * - Pure business logic only
 * - Testable in isolation
 */

import { MeaningDimension } from '@cube/meaning.core';
import { createOllamaEmbeddingProvider } from '../services/ollama-embedding-provider.js';
import { setMeaningDimension } from '../one-ai/models/Subject.js';
import { SemanticProposalEngine } from '../services/semantic-proposal-engine.js';

/**
 * Dependencies injected by platform (Electron, web, etc.)
 */
export interface AIDeps {
  storage: any;  // ONE.core instance
  llmManager: any;  // LLM manager
  getEnvVar: (key: string) => string | undefined;  // Platform-specific env access
  createUserSettingsManager: (storage: any, email: string) => any;  // Factory for UserSettingsManager
  initializeAIAssistant: (storage: any, llmManager: any) => Promise<any>;  // Factory for AI Assistant
  ollamaBaseUrl?: string;  // Optional Ollama base URL override
}

export interface AIContext {
  email: string;
  channelManager: any;
}

export interface AIServices {
  userSettingsManager: any;
  aiAssistantModel: any;
  anthropicApiKey?: string;
  meaningDimension?: any;  // MeaningDimension instance (if Ollama available)
  semanticEngine?: any;    // SemanticProposalEngine instance (if MeaningDimension available)
}

/**
 * AI Initialization Plan
 * Handles AI model discovery, user settings, and assistant initialization
 */
export class AIInitializationPlan {
  constructor(private deps: AIDeps) {}

  async initialize(context: AIContext): Promise<AIServices> {
    console.log('[AIInitializationPlan] Initializing AI services...');

    // Step 0: Ensure llmManager has channelManager for storage
    if (context.channelManager && !this.deps.llmManager.channelManager) {
      console.log('[AIInitializationPlan] Setting channelManager on llmManager');
      this.deps.llmManager.channelManager = context.channelManager;
    }

    // Step 1: Initialize UserSettingsManager (via factory)
    const userSettingsManager = await this.initializeUserSettings(context);

    // Step 2: Discover Claude models
    const anthropicApiKey = await this.discoverClaudeModels(userSettingsManager);

    // Step 3: Configure LLM manager
    this.configureLLMManager(userSettingsManager);

    // Step 4: Initialize AI Assistant (via factory)
    const aiAssistantModel = await this.initializeAIAssistant();

    // Step 5: Initialize MeaningDimension (optional - graceful failure)
    const { meaningDimension, semanticEngine } = await this.initializeMeaningDimension(userSettingsManager);

    console.log('[AIInitializationPlan] ✅ AI services initialized');

    return {
      userSettingsManager,
      aiAssistantModel,
      anthropicApiKey,
      meaningDimension,
      semanticEngine
    };
  }

  private async initializeUserSettings(context: AIContext): Promise<any> {
    console.log('[AIInitializationPlan] Initializing UserSettingsManager...');

    const userSettingsManager = this.deps.createUserSettingsManager(this.deps.storage, context.email);

    console.log('[AIInitializationPlan] ✅ UserSettingsManager initialized');
    return userSettingsManager;
  }

  private async discoverClaudeModels(userSettingsManager: any): Promise<string | undefined> {
    console.log('[AIInitializationPlan] Discovering Claude models...');

    // Get API key from user settings
    let anthropicApiKey = await userSettingsManager.getApiKey('anthropic');

    // Fallback to environment variable (platform-specific)
    if (!anthropicApiKey) {
      anthropicApiKey = this.deps.getEnvVar('ANTHROPIC_API_KEY');
      if (anthropicApiKey) {
        console.log('[AIInitializationPlan] Using API key from environment');
      }
    }

    // Discover Claude models
    await this.deps.llmManager.discoverClaudeModels(anthropicApiKey);
    console.log('[AIInitializationPlan] ✅ Claude models discovered');

    return anthropicApiKey;
  }

  private configureLLMManager(userSettingsManager: any): void {
    console.log('[AIInitializationPlan] Configuring LLM Manager...');

    this.deps.llmManager.updateSystemPromptDependencies(userSettingsManager);

    console.log('[AIInitializationPlan] ✅ LLM Manager configured');
  }

  private async initializeAIAssistant(): Promise<any> {
    console.log('[AIInitializationPlan] Initializing AI Assistant...');

    const aiAssistantModel = await this.deps.initializeAIAssistant(
      this.deps.storage,
      this.deps.llmManager
    );

    console.log('[AIInitializationPlan] ✅ AI Assistant initialized');
    return aiAssistantModel;
  }

  private async initializeMeaningDimension(userSettingsManager: any): Promise<{
    meaningDimension?: MeaningDimension;
    semanticEngine?: SemanticProposalEngine;
  }> {
    console.log('[AIInitializationPlan] Initializing MeaningDimension...');

    try {
      // Get embedding model from AI settings
      const aiSettings = await userSettingsManager.getSettings();
      const embeddingModel = aiSettings?.embeddingModel || 'nomic-embed-text';

      // Get Ollama base URL (from config or default)
      const ollamaBaseUrl = this.deps.ollamaBaseUrl || 'http://localhost:11434';

      // Create embedding provider
      const embeddingProvider = createOllamaEmbeddingProvider(
        embeddingModel,
        ollamaBaseUrl
      );

      // Create MeaningDimension
      const meaningDimension = new MeaningDimension({
        model: 'nomic-embed-text-v1.5',
        embeddingProvider
      });

      await meaningDimension.init();
      console.log('[AIInitializationPlan] ✅ MeaningDimension initialized with', embeddingModel);

      // Set for Subject indexing
      setMeaningDimension(meaningDimension);

      // Create semantic engine
      const semanticEngine = new SemanticProposalEngine(meaningDimension);

      return { meaningDimension, semanticEngine };
    } catch (err) {
      console.warn('[AIInitializationPlan] MeaningDimension initialization failed (non-fatal):', err);
      console.warn('[AIInitializationPlan] Semantic proposals will fall back to Jaccard similarity');
      return {};
    }
  }
}
