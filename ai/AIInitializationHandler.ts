/**
 * AI Initialization Handler
 *
 * Platform-agnostic business logic for AI initialization.
 * NO platform-specific imports - uses dependency injection.
 *
 * Principles:
 * - Dependency injection for platform-specific code (UserSettingsManager, AIAssistantHandler)
 * - Pure business logic only
 * - Testable in isolation
 */

/**
 * Dependencies injected by platform (Electron, web, etc.)
 */
export interface AIDeps {
  storage: any;  // ONE.core instance
  llmManager: any;  // LLM manager
  getEnvVar: (key: string) => string | undefined;  // Platform-specific env access
  createUserSettingsManager: (storage: any, email: string) => any;  // Factory for UserSettingsManager
  initializeAIAssistant: (storage: any, llmManager: any) => Promise<any>;  // Factory for AI Assistant
}

export interface AIContext {
  email: string;
  channelManager: any;
}

export interface AIServices {
  userSettingsManager: any;
  aiAssistantModel: any;
  anthropicApiKey?: string;
}

/**
 * AI Initialization Handler
 * Handles AI model discovery, user settings, and assistant initialization
 */
export class AIInitializationHandler {
  constructor(private deps: AIDeps) {}

  async initialize(context: AIContext): Promise<AIServices> {
    console.log('[AIInitializationHandler] Initializing AI services...');

    // Step 1: Initialize UserSettingsManager (via factory)
    const userSettingsManager = await this.initializeUserSettings(context);

    // Step 2: Discover Claude models
    const anthropicApiKey = await this.discoverClaudeModels(userSettingsManager);

    // Step 3: Configure LLM manager
    this.configureLLMManager(userSettingsManager);

    // Step 4: Initialize AI Assistant Handler (via factory)
    const aiAssistantModel = await this.initializeAIAssistant();

    console.log('[AIInitializationHandler] ✅ AI services initialized');

    return {
      userSettingsManager,
      aiAssistantModel,
      anthropicApiKey
    };
  }

  private async initializeUserSettings(context: AIContext): Promise<any> {
    console.log('[AIInitializationHandler] Initializing UserSettingsManager...');

    const userSettingsManager = this.deps.createUserSettingsManager(this.deps.storage, context.email);

    console.log('[AIInitializationHandler] ✅ UserSettingsManager initialized');
    return userSettingsManager;
  }

  private async discoverClaudeModels(userSettingsManager: any): Promise<string | undefined> {
    console.log('[AIInitializationHandler] Discovering Claude models...');

    // Get API key from user settings
    let anthropicApiKey = await userSettingsManager.getApiKey('anthropic');

    // Fallback to environment variable (platform-specific)
    if (!anthropicApiKey) {
      anthropicApiKey = this.deps.getEnvVar('ANTHROPIC_API_KEY');
      if (anthropicApiKey) {
        console.log('[AIInitializationHandler] Using API key from environment');
      }
    }

    // Discover Claude models
    await this.deps.llmManager.discoverClaudeModels(anthropicApiKey);
    console.log('[AIInitializationHandler] ✅ Claude models discovered');

    return anthropicApiKey;
  }

  private configureLLMManager(userSettingsManager: any): void {
    console.log('[AIInitializationHandler] Configuring LLM Manager...');

    this.deps.llmManager.updateSystemPromptDependencies(userSettingsManager);

    console.log('[AIInitializationHandler] ✅ LLM Manager configured');
  }

  private async initializeAIAssistant(): Promise<any> {
    console.log('[AIInitializationHandler] Initializing AI Assistant Handler...');

    const aiAssistantModel = await this.deps.initializeAIAssistant(
      this.deps.storage,
      this.deps.llmManager
    );

    console.log('[AIInitializationHandler] ✅ AI Assistant Handler initialized');
    return aiAssistantModel;
  }
}
