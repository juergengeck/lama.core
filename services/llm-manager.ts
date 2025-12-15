/**
 * LLM Manager (Platform-Agnostic)
 * Handles AI model operations with optional MCP integration
 * Can run in Node.js or browser environments
 *
 * TODO: Implement PromptParts handling for abstraction-based context management
 *
 * AIPromptBuilder now returns PromptParts structure:
 * {
 *   part1: { content: string, tokens: number, cacheable: true, cacheKey: string }  // System prompt
 *   part2: { content: string, tokens: number, cacheable: true, cacheKey: string }  // Past subjects
 *   part3: { messages: [], tokens: number, cacheable: boolean }                    // Current messages
 *   part4: { message: string, tokens: number, cacheable: false }                   // New message
 * }
 *
 * LLM Manager should:
 * 1. Detect provider from modelId (Anthropic, OpenAI, Ollama)
 * 2. Format PromptParts appropriately:
 *    - Anthropic: Use formatForAnthropicWithCaching() → system array with cache_control
 *    - OpenAI/Ollama: Use formatForStandardAPI() → messages array
 * 3. Include cache_control metadata in Anthropic API calls
 *
 * Example Anthropic integration:
 *   import { formatForAnthropicWithCaching } from './context-budget-manager.js';
 *   const formatted = formatForAnthropicWithCaching(promptParts);
 *   await chatWithAnthropicHTTP(modelId, {
 *     system: formatted.system,  // Array with cache_control
 *     messages: formatted.messages
 *   });
 */

import { OEvent } from '@refinio/one.models/lib/misc/OEvent.js';
import { createMessageBus } from '@refinio/one.core/lib/message-bus.js';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type { LLMPlatform } from './llm-platform.js';

const MessageBus = createMessageBus('LLMManager');
import { LLM_RESPONSE_SCHEMA } from '../schemas/llm-response.schema.js';
import { chatWithOllama, getLocalOllamaModels, parseOllamaModel, cancelAllOllamaRequests, cancelStreamingForTopic } from './ollama.js';
// Browser-compatible HTTP implementations (pure fetch, no SDK dependencies)
import { chatWithAnthropicHTTP, testAnthropicApiKey } from './anthropic-http.js';
import { chatWithOpenAIHTTP, testOpenAIApiKey as testOpenAIKey } from './openai-http.js';
import * as lmstudio from './lmstudio.js';
import { SystemPromptBuilder } from './system-prompt-builder.js';
import type { SystemPromptContext } from './system-prompt-builder.js';
import { formatForAnthropicWithCaching, formatForStandardAPI, type PromptParts } from './context-budget-manager.js';
import { LLMConcurrencyManager } from './llm-concurrency-manager.js';
import { getAdapterRegistry, registerDefaultAdapters, type LLMAdapterRegistry, type LLMAdapter, type ChatResult } from './llm-adapters/index.js';
import { AIToolExecutor, type ToolExecutionContext } from './AIToolExecutor.js';

/**
 * LLM connection health status
 */
export enum LLMHealthStatus {
  UNKNOWN = 'unknown',      // Not yet tested
  HEALTHY = 'healthy',      // Last call succeeded
  UNHEALTHY = 'unhealthy',  // Connection/network error (may recover)
  FAILED = 'failed'         // Configuration error (won't recover without intervention)
}

/**
 * Error information with recovery context
 */
export interface LLMErrorContext {
  modelId: string;
  error: Error;
  healthStatus: LLMHealthStatus;
  isRetryable: boolean;
  alternativeModels: string[]; // Available alternatives
  topicId?: string; // Topic that encountered the error
}

class LLMManager {
  name: any;
  description: any;
  onStream: any;
  match: any;
  length: any;
  substring: any;
  // Event for streaming chat responses
  onChatStream = new OEvent<(data: { chunk: string; partial: string }) => void>();
  contextLength: any;
  parameters: any;
  capabilities: any;
  close: any;
  channelManager?: any; // ONE.core channel manager for storage access
  modelSettings: Map<string, any>;
  mcpClients: Map<string, any>;
  mcpTools: Map<string, any>;
  isInitialized: boolean;
  ollamaConfig: any; // Cached Ollama configuration
  platform?: LLMPlatform; // Optional platform abstraction
  mcpManager?: any; // Optional MCP manager (Electron only)
  forwardLog?: (level: string, message: string) => void; // Optional log forwarding
  systemPromptBuilder: SystemPromptBuilder; // System prompt builder for composable context injection
  userSettingsManager?: any; // User settings manager for API keys
  corsProxyUrl?: string; // CORS proxy URL for browser API calls
  private toolExecutor?: AIToolExecutor; // Optional unified tool executor

  // LLM health tracking
  private modelHealth: Map<string, LLMHealthStatus>; // modelId → health status
  private lastHealthCheck: Map<string, number>; // modelId → timestamp
  private readonly HEALTH_CHECK_CACHE_MS = 30000; // Cache health status for 30s

  // Concurrency management
  private concurrencyManager: LLMConcurrencyManager;

  // Ollama context cache for conversation continuation and analytics
  private ollamaContextCache: Map<string, number[]>; // topicId → context array

  // Adapter registry for demand/supply pattern
  private adapterRegistry: LLMAdapterRegistry;

  constructor(
    platform?: LLMPlatform,
    mcpManager?: any,
    forwardLog?: (level: string, message: string) => void,
    userSettingsManager?: any,
    topicAnalysisModel?: any,
    channelManager?: any
  ) {
    this.platform = platform
    this.mcpManager = mcpManager
    this.forwardLog = forwardLog
    this.userSettingsManager = userSettingsManager
    this.channelManager = channelManager // Store for storage access
    this.modelSettings = new Map()
    this.mcpClients = new Map()
    this.mcpTools = new Map()
    this.isInitialized = false
    this.ollamaConfig = null

    // Initialize health tracking
    this.modelHealth = new Map()
    this.lastHealthCheck = new Map()

    // Initialize concurrency manager
    this.concurrencyManager = new LLMConcurrencyManager()

    // Initialize Ollama context cache
    this.ollamaContextCache = new Map()

    // Initialize adapter registry and register default adapters
    this.adapterRegistry = getAdapterRegistry()
    registerDefaultAdapters()

    // Propagate platform to adapters that need it (e.g., TransformersAdapter)
    MessageBus.send('debug', `LLMManager: platform=${platform ? 'provided' : 'undefined'}, setPlatform in registry=${('setPlatform' in this.adapterRegistry)}`)
    if (platform && 'setPlatform' in this.adapterRegistry) {
      MessageBus.send('debug', 'LLMManager: Calling registry.setPlatform()')
      ;(this.adapterRegistry as any).setPlatform(platform)
    }

    // Initialize system prompt builder
    this.systemPromptBuilder = new SystemPromptBuilder(
      mcpManager,
      userSettingsManager,
      topicAnalysisModel,
      channelManager
    )

    // Methods are already bound as class methods, no need for explicit binding
}

  /**
   * Set platform for local model inference (can be called after construction)
   * This propagates the platform to adapters that need it (e.g., TransformersAdapter)
   */
  setPlatform(platform: LLMPlatform): void {
    this.platform = platform
    MessageBus.send('debug', 'LLMManager.setPlatform: Setting platform on manager and adapters')
    if ('setPlatform' in this.adapterRegistry) {
      ;(this.adapterRegistry as any).setPlatform(platform)
      MessageBus.send('debug', 'LLMManager.setPlatform: Platform propagated to adapter registry')
    }
  }

  /**
   * Set the AI tool executor for unified tool handling
   */
  setToolExecutor(executor: AIToolExecutor): void {
    this.toolExecutor = executor;
    MessageBus.send('debug', 'AIToolExecutor set');
  }

  /**
   * Update SystemPromptBuilder dependencies (called after ONE.core is initialized)
   */
  updateSystemPromptDependencies(
    userSettingsManager?: any,
    topicAnalysisModel?: any,
    channelManager?: any
  ): void {
    MessageBus.send('debug', 'Updating SystemPromptBuilder dependencies')
    MessageBus.send('debug', `userSettingsManager passed: ${userSettingsManager ? 'YES' : 'NO (undefined)'}`)
    this.userSettingsManager = userSettingsManager
    this.channelManager = channelManager // Update channel manager
    MessageBus.send('debug', `this.userSettingsManager after assignment: ${this.userSettingsManager ? 'SET' : 'NOT SET'}`)
    this.systemPromptBuilder = new SystemPromptBuilder(
      this.mcpManager,
      userSettingsManager,
      topicAnalysisModel,
      channelManager
    )
    MessageBus.send('log', 'SystemPromptBuilder dependencies updated')
}

  /**
   * Get all LLMs from ONE.core storage
   */
  private async getAllLLMsFromStorage(): Promise<any[]> {
    if (!this.channelManager) {
      MessageBus.send('alert', 'channelManager not available - cannot read LLMs from storage')
      return []
    }

    try {
      const llms: any[] = []
      const iterator = this.channelManager.objectIteratorWithType('LLM', {
        channelId: 'lama',
      })

      for await (const obj of iterator) {
        if (obj && obj.data && !obj.data.deleted) {
          llms.push(obj.data)
        }
      }

      return llms
    } catch (error) {
      MessageBus.send('error', 'Failed to read LLMs from storage:', error)
      return []
    }
  }

  /**
   * Get specific LLM from ONE.core storage by modelId
   */
  private async getLLMFromStorage(modelId: string): Promise<any | null> {
    if (!this.channelManager) {
      MessageBus.send('alert', 'channelManager not available - cannot read LLM from storage')
      return null
    }

    try {
      const iterator = this.channelManager.objectIteratorWithType('LLM', {
        channelId: 'lama',
      })

      for await (const obj of iterator) {
        if (obj && obj.data && !obj.data.deleted && obj.data.modelId === modelId) {
          return obj.data
        }
      }

      return null
    } catch (error) {
      MessageBus.send('error', 'Failed to read LLM from storage:', error)
      return null
    }
  }

  /**
   * Load active Ollama configuration
   * Platform-specific code should call this with config loaded from storage
   */
  async loadOllamaConfig(config?: any): Promise<any> {
    if (config) {
      this.ollamaConfig = config
      MessageBus.send('debug', 'Loaded Ollama config:', JSON.stringify({
        modelType: this.ollamaConfig.modelType,
        baseUrl: this.ollamaConfig.baseUrl,
        hasAuth: this.ollamaConfig.hasAuthToken
      }))
      return this.ollamaConfig
    }

    // No config provided, use localhost default
    this.ollamaConfig = {
      modelType: 'local',
      baseUrl: 'http://localhost:11434',
      authType: 'none',
      hasAuthToken: false
    }
    MessageBus.send('debug', 'No Ollama config provided, using localhost default')
    return this.ollamaConfig
  }

  /**
   * Get Ollama base URL from config
   */
  getOllamaBaseUrl(): string {
    return this.ollamaConfig?.baseUrl || 'http://localhost:11434'
  }

  /**
   * Get auth headers if authentication is configured
   */
  async getOllamaAuthHeaders(): Promise<Record<string, string> | undefined> {
    if (!this.ollamaConfig?.hasAuthToken) {
      return undefined
    }

    try {
      // If auth is configured, we need to decrypt the token
      // For now, return undefined - actual decryption would happen in the IPC handler
      // This is handled by the ollama service when making requests
      return undefined
    } catch (error: any) {
      MessageBus.send('error', 'Failed to get auth headers:', error)
      return undefined
    }
  }

  /**
   * Pre-warm the LLM connection to reduce cold start delays
   */
  async preWarmConnection(): Promise<any> {
    MessageBus.send('debug', 'Pre-warming LLM connection...')
    try {
      // Get Ollama base URL from config
      const baseUrl = this.getOllamaBaseUrl()
      const authHeaders = await this.getOllamaAuthHeaders()

      // Send a minimal ping to Ollama to establish connection
      // Use first available model from storage for pre-warming
      const allLLMs = await this.getAllLLMsFromStorage()
      const firstLLM = allLLMs.find(llm => llm.provider === 'ollama')
      const modelToWarm = firstLLM?.modelId || 'llama3.2:latest'

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(authHeaders || {})
      }

      const response: any = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelToWarm,
          prompt: 'Hi',
          stream: false,
          options: {
            num_predict: 1 // Generate minimal response
          }
        })
      })

      if (response.ok) {
        MessageBus.send('log', 'LLM connection pre-warmed successfully to', baseUrl)
      } else {
        MessageBus.send('debug', 'Pre-warm response not OK:', response.status)
      }
    } catch (err: any) {
      MessageBus.send('debug', 'Pre-warm connection error:', err.message)
    }
  }

  async init(force = false): Promise<any> {
    if (this.isInitialized && !force) {
      MessageBus.send('debug', 'Already initialized')
      return
    }

    MessageBus.send('log', 'Initializing...')

    try {
      // Cancel any pending Ollama requests from before restart
      cancelAllOllamaRequests()
      MessageBus.send('debug', 'Cleared any pending Ollama requests')

      // Load Ollama network configuration
      await this.loadOllamaConfig()

      // Load saved settings
      await this.loadSettings()

      // Models are now read from ONE.core storage - no registration needed
      // LLM objects are stored via LLMConfigPlan.setConfig() and read on demand

      // MCP initialization moved to MCPInitializationPlan (after NodeOneCore exists)
      // await this.initializeMCP()

      this.isInitialized = true
      MessageBus.send('log', 'Initialized successfully (models read from storage)')

      // Pre-warm LLM connection in background (don't await)
      this.preWarmConnection().catch(err => {
        MessageBus.send('debug', 'Pre-warm failed (non-critical):', err.message)
      })

      // Immediate verification after initialization
      MessageBus.send('debug', `POST-INIT: mcpTools=${this.mcpTools.size}, mcpClients=${this.mcpClients.size}, tools=${Array.from(this.mcpTools.keys()).join(',')}`)
    } catch (error) {
      MessageBus.send('error', 'Initialization failed:', error)
      throw error
    }
  }






  async initializeMCP(): Promise<any> {
    MessageBus.send('debug', 'Initializing MCP servers...')

    // MCP is optional - skip if not available
    if (!this.mcpManager) {
      MessageBus.send('debug', 'MCP manager not available, skipping MCP initialization')
      return
    }

    try {
      // Initialize MCP Manager
      await this.mcpManager.init()

      // Sync tools from MCP Manager
      const tools = this.mcpManager.getAvailableTools()
      this.mcpTools.clear()

      const registeredTools = []
      for (const tool of tools) {
        this.mcpTools.set(tool.fullName || tool.name, tool)
        registeredTools.push(tool.fullName || tool.name)
      }
      // Log all tools at once instead of individually
      if (registeredTools.length > 0) {
        MessageBus.send('debug', `Registered ${registeredTools.length} MCP tools`)
      }

      MessageBus.send('log', `MCP initialized with ${this.mcpTools.size} tools`)
    } catch (error) {
      MessageBus.send('alert', 'MCP initialization failed (non-critical):', error)
      // Continue without MCP - LLM can still work
    }
  }

  async startLamaMCPServer(): Promise<any> {
    try {
      // MCP SDK and path are Node.js only - construct paths dynamically to bypass Vite
      let Client, StdioClientTransport, path
      try {
        // Use dynamic paths to prevent Vite from trying to resolve at build time
        const mcpClient = ['@modelcontextprotocol', 'sdk', 'client', 'index.js'].join('/')
        const mcpTransport = ['@modelcontextprotocol', 'sdk', 'client', 'stdio.js'].join('/')

        // Dynamic imports - MCP SDK only available in Electron/Node.js
        const clientModule = await import(/* @vite-ignore */ mcpClient);
        const transportModule = await import(/* @vite-ignore */ mcpTransport);
        const pathModule = await import(/* @vite-ignore */ 'path');
        Client = clientModule.Client
        StdioClientTransport = transportModule.StdioClientTransport
        path = pathModule.default || pathModule
      } catch (error) {
        MessageBus.send('debug', 'MCP SDK not available (browser platform), skipping LAMA MCP server')
        return
      }

      const lamaMCPPath = path.join(__dirname, '../../lama/electron/mcp-server.js')

      const transport = new StdioClientTransport({
        command: 'node',
        args: [lamaMCPPath]
      })

      const client = new Client({
        name: 'lama-electron-app',
        version: '1.0.0'
      }, {
        capabilities: { tools: {} }
      })

      await client.connect(transport)
      this.mcpClients.set('lama', client)

      // Discover LAMA-specific tools
      const tools: any = await client.listTools()
      if (tools.tools) {
        tools.tools.forEach((tool: any) => {
          this.mcpTools.set(tool.name, {
            ...tool,
            server: 'lama'
          })
          MessageBus.send('debug', `Registered LAMA tool: ${tool.name}`)
        })
      }

      MessageBus.send('log', 'LAMA MCP server started')
    } catch (error) {
      MessageBus.send('alert', 'Failed to start LAMA MCP server:', error)
    }
  }

  async chat(messages: any, modelId: any, options: any = {}): Promise<unknown> {
    // modelId is required - no default
    if (!modelId) {
      throw new Error('Model ID is required for chat')
    }
    const effectiveModelId = modelId

    // Read model from ONE.core storage instead of in-memory Map
    const llmObject = await this.getLLMFromStorage(effectiveModelId)
    if (!llmObject) {
      const allLLMs = await this.getAllLLMsFromStorage()
      const availableIds = allLLMs.map(llm => llm.modelId).join(', ')
      throw new Error(`Model ${effectiveModelId} not found in storage. Available: ${availableIds}`)
    }

    // Use LLM object directly (storage is source of truth)
    const model = {
      id: llmObject.modelId,
      name: llmObject.name || llmObject.modelId,
      provider: llmObject.provider,
      baseUrl: llmObject.server, // Ollama server address
      systemPrompt: llmObject.systemPrompt,
      // Defaults for fields that may not be in storage
      capabilities: ['chat', 'completion'],
      contextLength: 8192,
      parameters: {
        modelName: llmObject.modelId,
        temperature: options.temperature ?? 0.7,
        maxTokens: options.maxTokens ?? 4096  // Use user setting or default
      }
    }

    // Detect if messages is a PromptResult with promptParts
    let promptParts: PromptParts | undefined;
    let actualMessages: any[];

    if (messages && typeof messages === 'object' && 'promptParts' in messages && messages.promptParts) {
      // New path: Using abstraction-based context management
      promptParts = messages.promptParts;
      actualMessages = messages.messages; // Will be empty, but keep for compatibility
      MessageBus.send('debug', `Chat with ${(model as any).id} using PromptParts, ${this.mcpTools.size} MCP tools`);
      MessageBus.send('debug', `Context budget: ${promptParts.totalTokens} tokens, compression: ${promptParts.budget.compressionMode}, past subjects: ${promptParts.budget.pastSubjectCount}`);
    } else {
      // Legacy path: Using message array directly
      actualMessages = messages;
      MessageBus.send('debug', `Chat with ${(model as any).id} (${actualMessages.length} messages), ${this.mcpTools.size} MCP tools`);
    }

    // Check if structured output is requested
    if ((options as any)?.format) {
      // Check cached capability
      if ((model as any).structuredOutputTested === false) {
        throw new Error(
          `Model ${effectiveModelId} does not support structured output (previously tested and failed). ` +
          `Try a different model or disable analysis features.`
        );
      }
      // If not tested yet, we'll try and cache the result
    }

    // Check if tools should be disabled for this call
    const shouldDisableTools = (options as any)?.disableTools === true
    if (shouldDisableTools) {
      MessageBus.send('debug', 'Tools explicitly disabled via disableTools option')
    }

    // Prepare messages for LLM call
    let enhancedMessages: any[];

    if (promptParts) {
      // New path: Format PromptParts based on provider
      // Enhancement not needed - context is already built into PromptParts
      enhancedMessages = []; // Will be replaced by provider-specific formatting
    } else {
      // Legacy path: Add tool descriptions to system message (unless explicitly disabled)
      enhancedMessages = shouldDisableTools ? actualMessages : await this.enhanceMessagesWithContext(actualMessages, {})
    }

    // Inject API key for Anthropic if not provided
    if ((model as any).provider === 'anthropic' && !(options as any)?.apiKey) {
      if (this.userSettingsManager) {
        const apiKey = await this.userSettingsManager.getApiKey('anthropic')
        if (apiKey) {
          MessageBus.send('debug', 'Injected Claude API key from UserSettings')
          options = { ...options, apiKey }
        } else {
          MessageBus.send('error', 'No Claude API key found in UserSettings')
        }
      } else {
        MessageBus.send('error', 'UserSettingsManager not available, cannot retrieve API key')
      }
    }

    // Inject API key for OpenAI if not provided
    if ((model as any).provider === 'openai' && !(options as any)?.apiKey) {
      if (this.userSettingsManager) {
        const apiKey = await this.userSettingsManager.getApiKey('openai')
        if (apiKey) {
          MessageBus.send('debug', 'Injected OpenAI API key from UserSettings')
          options = { ...options, apiKey }
        } else {
          MessageBus.send('error', 'No OpenAI API key found in UserSettings')
        }
      } else {
        MessageBus.send('error', 'UserSettingsManager not available, cannot retrieve API key')
      }
    }

    // Acquire concurrency slot (waits if necessary based on resource constraints)
    const topicId = options.topicId || 'unknown';
    const topicPriority = options.priority || 5;
    const requestId = await this.concurrencyManager.acquireSlot(effectiveModelId, topicId, topicPriority);

    let response

    try {
      // Demand/Supply pattern: LLM object describes what it needs, adapter provides it
      // The adapter registry selects the right adapter based on llmObject properties
      const adapter = this.adapterRegistry.getAdapter(llmObject);

      if (adapter) {
        // Use adapter-based routing
        const chatResult = await adapter.chat(llmObject, enhancedMessages, {
          ...options,
          promptParts,
          platform: this.platform,
          ollamaContextCache: this.ollamaContextCache
        });
        response = chatResult.content;
      } else {
        // Fallback to legacy routing (will be removed once all adapters are registered)
        const inferenceType = llmObject.inferenceType;

        if (inferenceType === 'ondevice') {
          response = await this.chatWithLocal(model as any, enhancedMessages, options)
        } else if ((model as any).provider === 'ollama') {
          response = await this.chatWithOllama(model as any, enhancedMessages, { ...options, promptParts })
        } else if ((model as any).provider === 'lmstudio') {
          response = await this.chatWithLMStudio(model as any, enhancedMessages, options)
        } else if ((model as any).provider === 'anthropic') {
          response = await this.chatWithClaude(model as any, enhancedMessages, { ...options, promptParts })
        } else if ((model as any).provider === 'openai') {
          response = await this.chatWithOpenAI(model as any, enhancedMessages, { ...options, promptParts })
        } else if ((model as any).provider === 'local') {
          response = await this.chatWithLocal(model as any, enhancedMessages, options)
        } else {
          throw new Error(`Unsupported provider: ${(model as any).provider}`)
        }
      }

      // Mark model as healthy after successful call
      this.markModelHealthy(effectiveModelId);
    } catch (error: any) {
      // Mark model as unhealthy/failed
      this.markModelUnhealthy(effectiveModelId, error);

      // Create enhanced error with recovery context
      const errorContext = await this.createErrorContext(effectiveModelId, error, options.topicId);

      // Attach error context to the error object for platform layer
      (error as any).llmErrorContext = errorContext;

      MessageBus.send('error', `Chat failed for model ${effectiveModelId}:`, error.message);
      MessageBus.send('error', `Health: ${errorContext.healthStatus}, Retryable: ${errorContext.isRetryable}`);
      if (errorContext.alternativeModels.length > 0) {
        MessageBus.send('debug', `Alternative models available: ${errorContext.alternativeModels.join(', ')}`);
      }

      throw error;
    } finally {
      // Release concurrency slot when done
      this.concurrencyManager.releaseSlot(requestId);
    }

    // Build context for tool execution
    const context = {
      modelId: effectiveModelId,
      isPrivateModel: effectiveModelId.endsWith('-private'),
      topicId: options.topicId,
      personId: options.personId
    }

    // Process tool calls if present (ReACT pattern - tool results go back to LLM)
    // CRITICAL: Skip tool processing when tools are explicitly disabled (Phase 1 streaming)
    // This prevents JSON tool calls from being parsed and displayed to users
    if (!shouldDisableTools) {
      response = await this.processToolCalls(response, context, enhancedMessages, modelId, options)
    }

    return response
  }

  getToolDescriptions(): any {
    return this.mcpManager?.getToolDescriptions() || null
  }

  /**
   * Get the number of available MCP tools
   */
  getMCPToolCount(): number {
    return this.mcpTools?.size || 0;
  }


  /**
   * Enhance messages with composable system prompt context
   * Uses SystemPromptBuilder for flexible context injection
   */
  async enhanceMessagesWithContext(messages: any[], context?: SystemPromptContext): Promise<any[]> {
    // Check if this is a simple welcome message request
    const isWelcomeMessage = messages.some((m: any) =>
      m.content && (
        m.content.includes('Generate a welcome message') ||
        m.content.includes('Generate a brief, friendly welcome')
      )
    )

    // Skip enhancement for welcome messages
    if (isWelcomeMessage) {
      return messages
    }

    MessageBus.send('debug', `Enhancing messages for topic ${context?.topicId || 'none'}, subjects: ${context?.currentSubjects?.join(', ') || 'none'}`)

    try {
      const enhanced = await this.systemPromptBuilder.enhanceMessages(messages, context)
      MessageBus.send('debug', `Enhanced ${enhanced.length} messages`)
      return enhanced
    } catch (error) {
      MessageBus.send('error', 'Failed to enhance messages:', error)
      return messages // Return original on error
    }
  }

  /**
   * Extract complete JSON object from text using brace counting
   * Handles nested objects/arrays robustly
   */
  private extractJsonFromText(text: string): string | null {
    // Try to find JSON with "tool" and "parameters" keys
    const toolIndex = text.indexOf('"tool"')
    if (toolIndex === -1) return null

    // Search backwards from "tool" to find the opening brace
    let startIdx = -1
    for (let i = toolIndex - 1; i >= 0; i--) {
      const char = text[i]
      if (char === '{') {
        startIdx = i
        break
      }
      // Stop if we hit characters that can't be part of JSON structure
      if (char !== ' ' && char !== '\n' && char !== '\t' && char !== '\r' && char !== ',') {
        break
      }
    }

    if (startIdx === -1) return null

    // Count braces to find matching closing brace
    let depth = 0
    let inString = false
    let escape = false

    for (let i = startIdx; i < text.length; i++) {
      const char = text[i]

      // Handle escape sequences in strings
      if (escape) {
        escape = false
        continue
      }

      if (char === '\\' && inString) {
        escape = true
        continue
      }

      // Track string boundaries (JSON strings use double quotes)
      if (char === '"' && !escape) {
        inString = !inString
        continue
      }

      // Only count braces outside of strings
      if (!inString) {
        if (char === '{') {
          depth++
        } else if (char === '}') {
          depth--
          // Found matching closing brace
          if (depth === 0) {
            return text.substring(startIdx, i + 1)
          }
        }
      }
    }

    return null
  }

  async processToolCalls(response: any, context?: any, messages?: any[], modelId?: string, options?: any): Promise<any> {
    // Handle both string responses and object responses (with thinking)
    let responseText: string;
    let hasThinking = false;
    if (typeof response === 'object' && response._hasThinking) {
      // Response includes thinking metadata
      responseText = response.content;
      hasThinking = true;
    } else if (typeof response === 'string') {
      responseText = response;
    } else {
      MessageBus.send('alert', 'Unexpected response type:', typeof response);
      return response || '';
    }

    // Check for tool calls in response - try both with and without backticks
    let toolCallMatch = responseText?.match(/```json\s*({[\s\S]*?})\s*```/)
    let toolCallJson = null

    if (!toolCallMatch) {
      // Try to extract plain JSON with robust brace counting
      toolCallJson = this.extractJsonFromText(responseText)
      if (toolCallJson) {
        // Create a match-like array for compatibility with existing code
        toolCallMatch = [toolCallJson, toolCallJson] as RegExpMatchArray
      }
    }

    if (!toolCallMatch) {
      return response || ''
    }

    MessageBus.send('debug', 'Found potential tool call:', toolCallMatch[1]?.substring(0, 100))

    try {
      const toolCall = JSON.parse(toolCallMatch[1])
      if (toolCall.tool) {
        MessageBus.send('debug', `Executing tool: ${toolCall.tool}`)

        let result: any;
        let toolResultText = '';

        if (this.toolExecutor && context?.callerId) {
          // Use unified AIToolExecutor
          const execContext: ToolExecutionContext = {
            callerId: context.callerId,
            topicId: context.topicId,
            entryPoint: 'internal',  // NOTE: use 'internal', not 'ai-assistant'
            requestId: crypto.randomUUID()
          };

          // Add mcp: prefix for backwards compatibility with existing MCP tools
          const toolName = toolCall.tool.includes(':') && !toolCall.tool.startsWith('plan:') && !toolCall.tool.startsWith('mcp:')
            ? `mcp:${toolCall.tool}`
            : toolCall.tool;

          const { result: execResult } = await this.toolExecutor.execute(
            toolName,
            toolCall.parameters || {},
            execContext
          );

          result = execResult;
          toolResultText = this.toolExecutor.formatResultForLLM(execResult);
        } else {
          // Fallback to direct MCP execution
          result = await this.mcpManager?.executeTool(
            toolCall.tool,
            toolCall.parameters || {},
            context
          );

          // Extract text from MCP result
          if (result.content && Array.isArray(result.content)) {
            const textParts = result.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text);
            toolResultText = textParts.join('\n\n');
          } else if (typeof result === 'string') {
            toolResultText = result;
          } else {
            toolResultText = JSON.stringify(result, null, 2);
          }
        }

        // CRITICAL: Implement ReACT pattern - send tool result back to LLM for natural response
        // Instead of returning the tool result directly, let the LLM process it
        if (messages && modelId && options) {
          MessageBus.send('debug', 'ReACT: Sending tool result back to LLM')

          // Build conversation with tool result
          const conversationWithToolResult = [
            ...messages,
            {
              role: 'assistant' as const,
              content: responseText // The assistant's message with the tool call
            },
            {
              role: 'user' as const,
              content: `Tool result from ${toolCall.tool}:\n\n${toolResultText}\n\nPlease respond naturally to the user based on this information. Do not call any more tools, just provide a conversational response.`
            }
          ]

          // CRITICAL: Recursively call chat() with disableTools to get proper streaming + analysis
          // This ensures the follow-up response goes through the full chat pipeline

          const reactOptions = {
            ...options,
            disableTools: true // Disable tools for the follow-up call to avoid infinite loops
          }

          // Recursive call to chat() - will go through full pipeline including processToolCalls
          // but tools are disabled so it won't loop
          const finalResponse = await this.chat(conversationWithToolResult, modelId, reactOptions)

          // Attach tool results to response for Phase 0 extraction
          if (typeof finalResponse === 'object' && finalResponse !== null) {
            (finalResponse as any)._toolResults = toolResultText;
          } else {
            // If response is a string, convert to object with tool results
            return {
              content: finalResponse,
              _toolResults: toolResultText
            };
          }

          return finalResponse
        }

        // FALLBACK (for backward compatibility if messages/modelId not provided)
        // Format the result and return it directly
        MessageBus.send('alert', 'No messages/modelId provided - falling back to direct tool result')

        let formattedResult = ''

        if (toolCall.tool === 'filesystem:list_directory') {
          // Parse and format directory listing elegantly
          if (result.content && Array.isArray(result.content)) {
            const textContent = result.content.find((c: any) => c.type === 'text')
            if (textContent && textContent.text) {
              // Parse the directory listing and format it nicely
              const lines = textContent.text.split('\n').filter((line: any) => line.trim())
              const dirs: string[] = []
              const files: string[] = []

              lines.forEach((line: any) => {
                if (line.includes('[DIR]')) {
                  dirs.push(line.replace('[DIR]', '').trim())
                } else if (line.includes('[FILE]')) {
                  files.push(line.replace('[FILE]', '').trim())
                }
              })

              formattedResult = 'Here\'s what I found in the current directory:\n\n'

              if (dirs.length > 0) {
                formattedResult += '**📁 Folders:**\n'
                dirs.forEach(dir => {
                  formattedResult += `• ${dir}\n`
                })
                if (files.length > 0) formattedResult += '\n'
              }

              if (files.length > 0) {
                formattedResult += '**📄 Files:**\n'
                files.forEach(file => {
                  formattedResult += `• ${file}\n`
                })
              }

              formattedResult += `\n_Total: ${dirs.length} folders and ${files.length} files_`
            } else {
              formattedResult = 'I found the following items:\n\n' + JSON.stringify(result, null, 2)
            }
          } else {
            formattedResult = 'Directory contents:\n\n' + JSON.stringify(result, null, 2)
          }
        } else {
          // Use the already extracted tool result text
          formattedResult = toolResultText
        }

        // Handle both string responses and object responses (with thinking)
        if (hasThinking && typeof response === 'object') {
          // For responses with thinking, replace in the content field
          return {
            ...response,
            content: responseText.replace(toolCallMatch[0], formattedResult)
          };
        } else {
          // For plain string responses, replace directly
          return responseText.replace(toolCallMatch[0], formattedResult);
        }
      }
    } catch (error) {
      MessageBus.send('error', 'Tool execution failed:', error)
    }

    return response || ''
  }

  async chatWithOllama(model: any, messages: any, options: any = {}): Promise<unknown> {
    MessageBus.send('debug', `Ollama chat: ${model.parameters.modelName}, ${messages?.length || 0} msgs, ${model.baseUrl || 'localhost'}`);

    try {
      // Check if we have PromptParts for optimized context
      let ollamaMessages: any[];

      if (options.promptParts) {
        const formatted = formatForStandardAPI(options.promptParts);
        ollamaMessages = formatted.messages;
      } else {
        // Legacy path: Use messages directly
        ollamaMessages = messages;
      }

      // Get cached context for this topic (if available)
      const cachedContext = options.topicId ? this.ollamaContextCache.get(options.topicId) : undefined;
      const response = await chatWithOllama(
        model.parameters.modelName,
        ollamaMessages,
        {
          temperature: model.parameters.temperature,
          max_tokens: model.parameters.maxTokens,
          onStream: options.onStream,
          onThinkingStream: options.onThinkingStream,  // Pass through thinking stream callback
          format: options.format,  // Pass through structured output schema
          topicId: options.topicId,  // Pass through topicId for request tracking and cancellation
          context: cachedContext  // Pass cached context for conversation continuation
        },
        model.baseUrl || 'http://localhost:11434'  // Use custom baseUrl if available
      );

      // Extract and cache context from response (if present)
      if (options.topicId && typeof response === 'object' && response !== null && '_hasContext' in response) {
        const contextArray = (response as any).context;
        if (contextArray && Array.isArray(contextArray)) {
          this.ollamaContextCache.set(options.topicId, contextArray);
          MessageBus.send('debug', `Cached context for topic ${options.topicId} (${contextArray.length} tokens)`);
        }
      }

      return response;
    } catch (error: any) {
      // If structured output was requested and failed, cache this
      if (options.format && error.message?.includes('generated no response')) {
        model.structuredOutputTested = false;
        MessageBus.send('debug', `Model ${model.id} does not support structured output - cached`);
        throw new Error(
          `Model ${model.id} does not support structured output. ` +
          `The model failed to generate a response with JSON schema constraints. ` +
          `Try a different model or disable analysis features.`
        );
      }
      throw error;
    }
  }
  
  async chatWithLMStudio(model: any, messages: any, options: any = {}): Promise<any> {
    // Handle streaming if requested
    if (model.parameters.stream) {
      const stream = lmstudio.streamChatWithLMStudio(
        model.parameters.modelName,
        messages,
        {
          temperature: model.parameters.temperature,
          max_tokens: model.parameters.maxTokens
        }
      )
      
      let fullResponse = ''
      for await (const chunk of stream) {
        fullResponse += chunk
        // Emit streaming event
        this.onChatStream.emit({ chunk, partial: fullResponse })
      }
      return fullResponse
    }
    
    // Non-streaming chat
    return await lmstudio.chatWithLMStudio(
      model.parameters.modelName,
      messages,
      {
        temperature: model.parameters.temperature,
        max_tokens: model.parameters.maxTokens
      }
    )
  }

  async chatWithClaude(model: any, messages: any, options: any = {}): Promise<any> {
    // Platform layer must provide API key - lama.core is platform-agnostic
    const apiKey = options.apiKey
    if (!apiKey) {
      throw new Error('Claude API key not provided - platform layer must supply options.apiKey')
    }

    // Extract base model ID - remove private suffix and provider prefix
    const baseModelId = model.id.replace('-private', '').replace(/^claude:/, '')

    MessageBus.send('debug', `Calling Claude with model ID: ${baseModelId}`)

    // Check if we have PromptParts for caching support
    if (options.promptParts) {
      const formatted = formatForAnthropicWithCaching(options.promptParts);

      // Get MCP tools if available and not explicitly disabled
      const tools = !options.disableTools && this.mcpManager
        ? this.mcpManager.getClaudeTools?.()
        : undefined;

      return await chatWithAnthropicHTTP({
        apiKey,
        model: baseModelId,
        messages: formatted.messages,
        system: formatted.system,  // Array with cache_control
        temperature: model.parameters.temperature,
        max_tokens: model.parameters.maxTokens,
        tools,
        onStream: options.onStream,
        signal: options.signal,
        proxyUrl: this.corsProxyUrl
      });
    }

    // Legacy path: Standard message array

    // Convert messages to Anthropic format
    const anthropicMessages = messages
      .filter((m: any) => m.role !== 'system')
      .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Extract system message
    const systemMessage = messages.find((m: any) => m.role === 'system')?.content || options.system;

    // Get MCP tools if available and not explicitly disabled
    const tools = !options.disableTools && this.mcpManager
      ? this.mcpManager.getClaudeTools?.()
      : undefined;

    // Use browser-compatible HTTP implementation
    return await chatWithAnthropicHTTP({
      apiKey,
      model: baseModelId,
      messages: anthropicMessages,
      system: systemMessage,
      temperature: model.parameters.temperature,
      max_tokens: model.parameters.maxTokens,
      tools,
      onStream: options.onStream,
      signal: options.signal,
      proxyUrl: this.corsProxyUrl
    });
  }

  async chatWithOpenAI(model: any, messages: any, options: any = {}): Promise<any> {
    // Platform layer must provide API key - lama.core is platform-agnostic
    const apiKey = options.apiKey
    if (!apiKey) {
      throw new Error('OpenAI API key not provided - platform layer must supply options.apiKey')
    }

    // Extract base model ID - remove private suffix and provider prefix
    const baseModelId = model.id.replace('-private', '').replace(/^openai:/, '')

    MessageBus.send('debug', `Calling OpenAI with model ID: ${baseModelId}`)

    // Check if we have PromptParts for optimized context
    let openaiMessages: any[];

    if (options.promptParts) {
      const formatted = formatForStandardAPI(options.promptParts);
      openaiMessages = formatted.messages;
    } else {
      // Legacy path: Standard message array
      openaiMessages = messages.map((m: any) => ({
        role: m.role,
        content: m.content
      }));
    }

    // Get MCP tools if available and not explicitly disabled (OpenAI format)
    const tools = !options.disableTools && this.mcpManager
      ? this.mcpManager.getOpenAITools?.()
      : undefined;

    // Use browser-compatible HTTP implementation
    return await chatWithOpenAIHTTP({
      apiKey,
      model: baseModelId,
      messages: openaiMessages,
      temperature: model.parameters.temperature,
      max_tokens: model.parameters.maxTokens,
      tools,
      onStream: options.onStream,
      signal: options.signal,
      proxyUrl: this.corsProxyUrl
    });
  }

  /**
   * Chat with local on-device model via platform adapter
   * Uses transformers.js on Electron (main process) or Browser (Web Worker)
   */
  async chatWithLocal(model: any, messages: any, options: any = {}): Promise<any> {
    MessageBus.send('debug', `Local chat: ${model.parameters?.modelName || model.id}, ${messages?.length || 0} msgs`);

    // Platform must implement chatWithLocal
    if (!this.platform?.chatWithLocal) {
      throw new Error('Local model inference not supported on this platform');
    }

    // Convert messages to standard format
    const chatMessages = messages.map((m: any) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content
    }));

    // Model IDs no longer use 'local:' prefix - use directly
    const modelId = model.id;

    try {
      const response = await this.platform.chatWithLocal(modelId, chatMessages, {
        onStream: options.onStream,
        temperature: model.parameters?.temperature ?? 0.7,
        maxTokens: model.parameters?.maxTokens ?? 2048,
        format: options.format,
        topicId: options.topicId
      });

      return response;
    } catch (error: any) {
      MessageBus.send('error', `Local chat failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Chat directly with a local model by ID, bypassing storage lookup.
   * Use this for first-run scenarios where the model isn't yet in storage
   * (e.g., AI birth name generation before model registration).
   */
  async chatLocalDirect(modelId: string, messages: any[], options: any = {}): Promise<string> {
    MessageBus.send('debug', `Direct local chat: ${modelId}, ${messages?.length || 0} msgs`);

    // Platform must implement chatWithLocal
    if (!this.platform?.chatWithLocal) {
      throw new Error('Local model inference not supported on this platform');
    }

    // Convert messages to standard format
    const chatMessages = messages.map((m: any) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content
    }));

    try {
      const response = await this.platform.chatWithLocal(modelId, chatMessages, {
        onStream: options.onStream,
        temperature: options.temperature ?? 0.7,
        maxTokens: options.maxTokens ?? 2048,
        format: options.format,
        topicId: options.topicId
      });

      return response;
    } catch (error: any) {
      MessageBus.send('error', `Direct local chat failed: ${error.message}`);
      throw error;
    }
  }

  async loadSettings(): Promise<any> {
    // Runtime settings only - no default model concept here
  }

  /**
   * Stop streaming for a specific topic
   * @param topicId The topic ID to stop streaming for
   * @returns true if a stream was cancelled, false if no active stream found
   */
  stopStreaming(topicId: string): boolean {
    MessageBus.send('debug', `Stopping streaming for topic: ${topicId}`)
    return cancelStreamingForTopic(topicId)
  }

  getStoredApiKey(provider: any): any {
    // Implement secure key storage
    return null
  }

  async setApiKey(provider: any, apiKey: any): Promise<any> {
    // Store API key securely
    MessageBus.send('debug', `API key set for ${provider}`)
  }

  async getAllModels(): Promise<any[]> {
    return await this.getAllLLMsFromStorage()
  }

  async getModel(id: any): Promise<any | null> {
    return await this.getLLMFromStorage(id)
  }

  /**
   * Get available models for external consumers
   * Deduplicates by composite key (name + server) to prevent duplicate entries
   */
  async getAvailableModels(): Promise<any[]> {
    const llms = await this.getAllLLMsFromStorage()

    // Deduplicate by composite key (name + server) - LLM Recipe uses both as isId
    const seen = new Set<string>()
    const dedupedLlms = llms.filter((llm: any) => {
      const key = `${llm.name}@${llm.server || 'localhost'}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })

    return dedupedLlms.map((llm: any) => ({
      id: llm.modelId,
      name: llm.name || llm.modelId,
      provider: llm.provider,
      server: llm.server || '', // Include server URL for UI display
      description: llm.description || '',
      contextLength: llm.contextLength || 4096,
      maxTokens: llm.maxTokens || 2048,
      capabilities: llm.capabilities || [],
      // Inference type from storage (ondevice/server/cloud)
      inferenceType: llm.inferenceType || (llm.provider === 'ollama' ? 'server' : 'cloud'),
      // Determine modelType for backward compat
      modelType: llm.inferenceType === 'ondevice' ? 'ondevice' : (llm.provider === 'ollama' ? 'local' : 'remote'),
      size: llm.size, // Include size if available
      isLoaded: llm.isLoaded || false, // Include load status
      isDefault: llm.isDefault || false // Include default status
    }))
  }

  /**
   * Get all registered MCP tools
   * Returns array of tool definitions from the mcpTools registry
   */
  getAllMCPTools(): Array<{name: string, description: string, server: string}> {
    const tools: Array<{name: string, description: string, server: string}> = []

    for (const [toolName, toolDef] of this.mcpTools.entries()) {
      tools.push({
        name: toolName,
        description: toolDef.description || '',
        server: toolDef.server || 'lama'
      })
    }

    return tools
  }

  /**
   * Get all registered models from ONE.core storage
   * Returns array of LLM model objects
   * @deprecated Use getAllLLMsFromStorage() instead
   */
  getModels(): any[] {
    // This is a synchronous wrapper - in practice, models should be fetched via getAllLLMsFromStorage
    // For now, return empty array as models are loaded async
    MessageBus.send('alert', 'getModels() is deprecated - use getAllLLMsFromStorage() instead');
    return [];
  }

  /**
   * Discover Ollama models from local Ollama instance
   * Registers available Ollama models for use in the application
   */
  async discoverOllamaModels(): Promise<void> {
    MessageBus.send('debug', 'Discovering Ollama models...');

    try {
      // Get local Ollama models
      const ollamaModels = await getLocalOllamaModels();

      if (!ollamaModels || ollamaModels.length === 0) {
        MessageBus.send('debug', 'No Ollama models found');
        return;
      }

      // Store models in ONE.core storage via channelManager
      if (!this.channelManager) {
        MessageBus.send('alert', 'channelManager not available - cannot store Ollama models');
        return;
      }

      MessageBus.send('debug', `Registering ${ollamaModels.length} Ollama models...`);

      for (const model of ollamaModels) {
        try {
          const modelId = `ollama:${model.name}`;

          // Check if model already exists
          const existing = await this.getLLMFromStorage(modelId);
          if (existing) {
            continue;
          }

          // Create LLM object in storage
          const llmObject = {
            $type$: 'LLM',
            modelId: modelId,
            name: model.name,
            provider: 'ollama',
            description: model.details?.family || 'Ollama model',
            contextLength: (model.details as any)?.context_length || 4096,
            maxTokens: 2048,
            capabilities: ['chat', 'completion'],
            apiKey: '' // Ollama doesn't need API key
          };

          // await this.saveLLMToStorage(llmObject); // TODO: Method doesn't exist
          MessageBus.send('debug', `Registered Ollama model: ${modelId}`);
        } catch (error) {
          MessageBus.send('error', `Failed to register Ollama model ${model.name}:`, error);
        }
      }

      MessageBus.send('log', 'Ollama model discovery complete');
    } catch (error) {
      MessageBus.send('error', 'Failed to discover Ollama models:', error);
      throw error;
    }
  }

  /**
   * Set the personId for a model (used by AIAssistantModel)
   * @deprecated personId should be stored via LLMConfigPlan
   */
  async setModelPersonId(modelId: any, personId: any): Promise<void> {
    // This functionality is deprecated - personId is now stored in LLM object via storage
    MessageBus.send('alert', 'setModelPersonId is deprecated - use LLMConfigPlan')
  }

  /**
   * Check if a personId belongs to an AI model
   */
  async isAIPersonId(personId: any): Promise<boolean> {
    const personIdStr = personId?.toString()
    if (!personIdStr) return false

    const llms = await this.getAllLLMsFromStorage()
    for (const llm of llms) {
      if (llm.personId?.toString() === personIdStr) {
        return true
      }
    }
    return false
  }

  debugToolsState(): any {
    MessageBus.send('debug', `Tools state: mcpTools=${this.mcpTools.size}, mcpClients=${this.mcpClients.size}, initialized=${this.isInitialized}`)
    return {
      toolCount: this.mcpTools.size,
      clientCount: this.mcpClients.size,
      tools: Array.from(this.mcpTools.keys()),
      initialized: this.isInitialized
    }
  }

  /**
   * Test a Claude API key
   */
  async testClaudeApiKey(apiKey: any): Promise<any> {
    return await testAnthropicApiKey(apiKey);
  }

  /**
   * Test an OpenAI API key
   */
  async testOpenAIApiKey(apiKey: any): Promise<any> {
    return await testOpenAIKey(apiKey);
  }

  /**
   * Discover Claude models from Anthropic API
   * Registers available Claude models for use in the application
   */
  async discoverClaudeModels(apiKey?: string): Promise<void> {
    MessageBus.send('debug', 'Discovering Claude models...');

    try {
      // Get API key from user settings if not provided
      let effectiveApiKey = apiKey;
      if (!effectiveApiKey && this.userSettingsManager) {
        effectiveApiKey = await this.userSettingsManager.getApiKey('anthropic');
      }

      if (!effectiveApiKey) {
        MessageBus.send('debug', 'No Claude API key available, skipping Claude model discovery');
        return;
      }

      // Test the API key first
      const isValid = await this.testClaudeApiKey(effectiveApiKey);
      if (!isValid) {
        throw new Error('Invalid Claude API key');
      }

      // Define available Claude models
      // These are the current Anthropic models as of 2025
      const claudeModels = [
        {
          modelId: 'claude:claude-sonnet-4.5-20250929',
          name: 'Claude Sonnet 4.5',
          provider: 'anthropic',
          description: 'Latest Claude Sonnet model with extended thinking',
          contextLength: 200000,
          maxTokens: 8192,
          capabilities: ['chat', 'completion', 'extended-thinking']
        },
        {
          modelId: 'claude:claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet',
          provider: 'anthropic',
          description: 'Balanced intelligence and speed',
          contextLength: 200000,
          maxTokens: 8192,
          capabilities: ['chat', 'completion']
        },
        {
          modelId: 'claude:claude-3-5-haiku-20241022',
          name: 'Claude 3.5 Haiku',
          provider: 'anthropic',
          description: 'Fastest Claude model for quick responses',
          contextLength: 200000,
          maxTokens: 8192,
          capabilities: ['chat', 'completion']
        },
        {
          modelId: 'claude:claude-3-opus-20240229',
          name: 'Claude 3 Opus',
          provider: 'anthropic',
          description: 'Most capable Claude model for complex tasks',
          contextLength: 200000,
          maxTokens: 4096,
          capabilities: ['chat', 'completion']
        }
      ];

      // Store models in ONE.core storage via channelManager
      if (!this.channelManager) {
        MessageBus.send('alert', 'channelManager not available - cannot store Claude models');
        return;
      }

      MessageBus.send('debug', `Registering ${claudeModels.length} Claude models...`);

      for (const model of claudeModels) {
        try {
          // Check if model already exists
          const existing = await this.getLLMFromStorage(model.modelId);
          if (existing) {
            continue;
          }

          // Create LLM object in storage with all mandatory fields
          const now = Date.now();
          const nowStr = new Date().toISOString();
          const llmObject = {
            $type$: 'LLM',
            modelId: model.modelId,
            name: model.name,
            filename: model.modelId, // Required field - use modelId as filename for API models
            provider: model.provider,
            description: model.description,
            contextLength: model.contextLength,
            maxTokens: model.maxTokens,
            capabilities: model.capabilities,
            server: 'https://api.anthropic.com', // Claude API endpoint
            modelType: 'remote' as const, // Claude is API-based
            active: true,
            deleted: false,
            created: now,
            modified: now,
            createdAt: nowStr,
            lastUsed: nowStr
          };

          await this.channelManager.postToChannel('lama', llmObject);

          MessageBus.send('debug', `Registered Claude model: ${model.name}`);
        } catch (error) {
          MessageBus.send('error', `Failed to register model ${model.modelId}:`, error);
        }
      }

      MessageBus.send('log', 'Claude model discovery complete');
    } catch (error: any) {
      MessageBus.send('error', 'Claude model discovery failed:', error);
      throw error;
    }
  }

  /**
   * Discover and register local ONNX models (on-device inference)
   * Called by platform layer with list of installed text-generation models
   */
  async discoverLocalModels(installedModels: Array<{
    id: string;
    name: string;
    sizeBytes: number;
    contextLength?: number;
    familyName?: string;
  }>): Promise<void> {
    console.log(`[LLMManager] discoverLocalModels: ${installedModels.length} models`);

    if (!this.channelManager) {
      console.error('[LLMManager] channelManager not available - cannot store local models');
      return;
    }

    for (const model of installedModels) {
      try {
        // Model IDs no longer use 'local:' prefix - routing is handled by inferenceType field
        const modelId = model.id;
        console.log(`[LLMManager] Processing local model: ${modelId}`);

        // Check if model already exists
        const existing = await this.getLLMFromStorage(modelId);
        if (existing) {
          console.log(`[LLMManager] Local model already registered: ${modelId}`);
          continue;
        }

        // Create LLM object in storage
        const now = Date.now();
        const nowStr = new Date().toISOString();
        const llmObject = {
          $type$: 'LLM',
          modelId: modelId,
          name: model.familyName || model.name,
          filename: model.id,
          provider: 'transformers',
          description: `On-device ${model.name}`,
          contextLength: model.contextLength || 4096,
          maxTokens: 2048,
          capabilities: ['chat'],
          server: 'local', // Required isId field - 'local' for on-device
          modelType: 'local' as const,
          inferenceType: 'ondevice' as const,
          size: model.sizeBytes,
          active: true,
          deleted: false,
          created: now,
          modified: now,
          createdAt: nowStr,
          lastUsed: nowStr
        };

        console.log(`[LLMManager] Storing LLM object:`, JSON.stringify(llmObject, null, 2));
        // Store in ONE.core storage first (like LLMConfigPlan.setConfig does)
        const result = await storeVersionedObject(llmObject);
        const hash = typeof result === 'string' ? result : result.idHash;
        console.log(`[LLMManager] Stored LLM object with hash: ${hash}`);
        // Then post to channel for sync
        await this.channelManager.postToChannel('lama', llmObject);
        console.log(`[LLMManager] ✅ Stored local model: ${model.name} (${modelId})`);
      } catch (error) {
        console.error(`[LLMManager] ❌ Failed to register local model ${model.id}:`, error);
        MessageBus.send('error', `Failed to register local model ${model.id}:`, error);
      }
    }

    MessageBus.send('log', 'Local model discovery complete');
  }

  /**
   * Register a -private variant that REFERENCES base model config
   * -private is a separate identity (Person) but uses same model config
   * @deprecated -private variants are now created via LLMConfigPlan
   */
  async registerPrivateVariant(modelId: any): Promise<string | null> {
    MessageBus.send('alert', 'registerPrivateVariant is deprecated - use LLMConfigPlan')
    return null
  }

  /**
   * Register private variant for LAMA conversations
   * @deprecated -private variants are now created via LLMConfigPlan
   */
  async registerPrivateVariantForModel(modelId: any): Promise<void> {
    MessageBus.send('alert', 'registerPrivateVariantForModel is deprecated - use LLMConfigPlan')
  }

  /**
   * Get health status for a model
   */
  getModelHealth(modelId: string): LLMHealthStatus {
    return this.modelHealth.get(modelId) || LLMHealthStatus.UNKNOWN;
  }

  /**
   * Update health status after successful call
   */
  private markModelHealthy(modelId: string): void {
    this.modelHealth.set(modelId, LLMHealthStatus.HEALTHY);
    this.lastHealthCheck.set(modelId, Date.now());
  }

  /**
   * Update health status after failed call
   */
  private markModelUnhealthy(modelId: string, error: Error): void {
    const status = this.classifyError(error);
    this.modelHealth.set(modelId, status);
    this.lastHealthCheck.set(modelId, Date.now());
  }

  /**
   * Classify error to determine if it's retryable
   */
  private classifyError(error: Error): LLMHealthStatus {
    const message = error.message.toLowerCase();

    // Configuration errors (won't recover without user intervention)
    if (
      message.includes('api key') ||
      message.includes('authentication') ||
      message.includes('unauthorized') ||
      message.includes('invalid credentials') ||
      message.includes('model') && message.includes('not found')
    ) {
      return LLMHealthStatus.FAILED;
    }

    // Network/connection errors (may recover on retry)
    if (
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('fetch failed')
    ) {
      return LLMHealthStatus.UNHEALTHY;
    }

    // Default to unhealthy (retryable)
    return LLMHealthStatus.UNHEALTHY;
  }

  /**
   * Get available healthy alternative models
   */
  async getHealthyAlternatives(currentModelId: string): Promise<string[]> {
    const alternatives: string[] = [];
    const llms = await this.getAllLLMsFromStorage();

    for (const llm of llms) {
      const modelId = llm.modelId;

      // Skip current model
      if (modelId === currentModelId) continue;

      // Skip private variants for now
      if (modelId.includes('-private')) continue;

      // Check if model is healthy or unknown (untested)
      const health = this.getModelHealth(modelId);
      if (health === LLMHealthStatus.HEALTHY || health === LLMHealthStatus.UNKNOWN) {
        alternatives.push(modelId);
      }
    }

    return alternatives;
  }

  /**
   * Create error context with recovery information
   */
  async createErrorContext(modelId: string, error: Error, topicId?: string): Promise<LLMErrorContext> {
    const healthStatus = this.getModelHealth(modelId);
    const isRetryable = healthStatus !== LLMHealthStatus.FAILED;
    const alternativeModels = await this.getHealthyAlternatives(modelId);

    return {
      modelId,
      error,
      healthStatus,
      isRetryable,
      alternativeModels,
      topicId
    };
  }

  /**
   * Get cached context for a topic
   */
  getCachedContext(topicId: string): number[] | undefined {
    return this.ollamaContextCache.get(topicId);
  }

  /**
   * Clear cached context for a topic
   */
  clearCachedContext(topicId: string): void {
    if (this.ollamaContextCache.delete(topicId)) {
      MessageBus.send('debug', `Cleared cached context for topic ${topicId}`);
    }
  }

  /**
   * Clear all cached contexts
   */
  clearAllCachedContexts(): void {
    const count = this.ollamaContextCache.size;
    this.ollamaContextCache.clear();
    MessageBus.send('debug', `Cleared all cached contexts (${count} topics)`);
  }

  /**
   * Analyze using cached context (for analytics/topic extraction)
   * Uses cached KV state to avoid reprocessing the entire conversation
   *
   * @param topicId - Topic ID with cached context
   * @param prompt - Analytics prompt (e.g., "Extract keywords from this conversation")
   * @param modelId - Model to use for analysis
   * @param options - Additional options
   * @returns Analysis result
   */
  async analyzeWithCache(
    topicId: string,
    prompt: string,
    modelId: string,
    options: any = {}
  ): Promise<string> {
    MessageBus.send('debug', `Analyzing with cached context for topic ${topicId}`);

    // Get cached context
    const cachedContext = this.ollamaContextCache.get(topicId);
    if (!cachedContext) {
      throw new Error(`No cached context found for topic ${topicId}. Run a regular chat first.`);
    }

    // Read model from storage
    const llmObject = await this.getLLMFromStorage(modelId);
    if (!llmObject) {
      throw new Error(`Model ${modelId} not found in storage`);
    }

    // Use LLM object directly
    const model = {
      id: llmObject.modelId,
      name: llmObject.name || llmObject.modelId,
      provider: llmObject.provider,
      baseUrl: llmObject.server,
      parameters: {
        modelName: llmObject.modelId,
        temperature: 0.3, // Lower temp for analytics (more deterministic)
        maxTokens: 2048
      }
    };

    MessageBus.send('debug', `Reusing ${cachedContext.length} tokens of cached context`);

    // Use single-message format with cached context
    const response = await chatWithOllama(
      model.parameters.modelName,
      [{ role: 'user', content: prompt }],
      {
        temperature: model.parameters.temperature,
        max_tokens: model.parameters.maxTokens,
        context: cachedContext, // Reuse cached KV state
        topicId, // For tracking
        format: options.format // Support structured output for analytics
      },
      model.baseUrl || 'http://localhost:11434'
    );

    // Extract content from response
    if (typeof response === 'object' && response !== null && 'content' in response) {
      return (response as any).content;
    }
    return response as string;
  }

  async shutdown(): Promise<any> {
    MessageBus.send('log', 'Shutting down...')

    // Close MCP connections
    for (const [name, client] of this.mcpClients) {
      try {
        await client.close()
        MessageBus.send('debug', `Closed MCP client: ${name}`)
      } catch (error) {
        MessageBus.send('error', `Error closing ${name}:`, error)
      }
    }

    this.mcpClients.clear()
    this.mcpTools.clear()
    this.modelSettings.clear()
    this.isInitialized = false

    MessageBus.send('log', 'Shutdown complete')
  }

  /**
   * Get concurrency statistics for monitoring
   */
  getConcurrencyStats(): {
    activeByGroup: Record<string, number>;
    pendingByGroup: Record<string, number>;
    totalActive: number;
    totalPending: number;
  } {
    return this.concurrencyManager.getStats();
  }

  /**
   * Check if a model can run immediately without queuing
   */
  canModelRunImmediately(modelId: string): boolean {
    return this.concurrencyManager.canRunImmediately(modelId);
  }
}

// Export both the class (for custom instantiation) and a default singleton
export { LLMManager }
export default new LLMManager()