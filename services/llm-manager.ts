/**
 * LLM Manager (Platform-Agnostic)
 * Handles AI model operations with optional MCP integration
 * Can run in Node.js or browser environments
 */

import { OEvent } from '@refinio/one.models/lib/misc/OEvent.js';
import type { LLMPlatform } from './llm-platform.js';
import { LLM_RESPONSE_SCHEMA } from '../schemas/llm-response.schema.js';
import { chatWithOllama, getLocalOllamaModels, parseOllamaModel, cancelAllOllamaRequests, cancelStreamingForTopic } from './ollama.js';
import { chatWithClaude } from './claude.js';
import * as lmstudio from './lmstudio.js';
import { SystemPromptBuilder } from './system-prompt-builder.js';
import type { SystemPromptContext } from './system-prompt-builder.js';

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
  models: Map<string, any>;
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
    this.models = new Map()
    this.modelSettings = new Map()
    this.mcpClients = new Map()
    this.mcpTools = new Map()
    this.isInitialized = false
    this.ollamaConfig = null

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
   * Update SystemPromptBuilder dependencies (called after ONE.core is initialized)
   */
  updateSystemPromptDependencies(
    userSettingsManager?: any,
    topicAnalysisModel?: any,
    channelManager?: any
  ): void {
    console.log('[LLMManager] Updating SystemPromptBuilder dependencies')
    console.log(`[LLMManager] userSettingsManager passed: ${userSettingsManager ? 'YES' : 'NO (undefined)'}`)
    this.userSettingsManager = userSettingsManager
    console.log(`[LLMManager] this.userSettingsManager after assignment: ${this.userSettingsManager ? 'SET' : 'NOT SET'}`)
    this.systemPromptBuilder = new SystemPromptBuilder(
      this.mcpManager,
      userSettingsManager,
      topicAnalysisModel,
      channelManager
    )
    console.log('[LLMManager] ✅ SystemPromptBuilder dependencies updated')
}

  /**
   * Load active Ollama configuration
   * Platform-specific code should call this with config loaded from storage
   */
  async loadOllamaConfig(config?: any): Promise<any> {
    if (config) {
      this.ollamaConfig = config
      console.log('[LLMManager] Loaded Ollama config:', {
        modelType: this.ollamaConfig.modelType,
        baseUrl: this.ollamaConfig.baseUrl,
        hasAuth: this.ollamaConfig.hasAuthToken
      })
      return this.ollamaConfig
    }

    // No config provided, use localhost default
    this.ollamaConfig = {
      modelType: 'local',
      baseUrl: 'http://localhost:11434',
      authType: 'none',
      hasAuthToken: false
    }
    console.log('[LLMManager] No Ollama config provided, using localhost default')
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
      console.error('[LLMManager] Failed to get auth headers:', error)
      return undefined
    }
  }

  /**
   * Pre-warm the LLM connection to reduce cold start delays
   */
  async preWarmConnection(): Promise<any> {
    console.log('[LLMManager] Pre-warming LLM connection...')
    try {
      // Get Ollama base URL from config
      const baseUrl = this.getOllamaBaseUrl()
      const authHeaders = await this.getOllamaAuthHeaders()

      // Send a minimal ping to Ollama to establish connection
      // Use first available model for pre-warming
      const modelToWarm = Array.from(this.models.keys())[0] || 'llama3.2:latest'

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
        console.log('[LLMManager] ✅ LLM connection pre-warmed successfully to', baseUrl)
      } else {
        console.log('[LLMManager] Pre-warm response not OK:', response.status)
      }
    } catch (err: any) {
      console.log('[LLMManager] Pre-warm connection error:', err.message)
    }
  }

  async init(force = false): Promise<any> {
    if (this.isInitialized && !force) {
      console.log('[LLMManager] Already initialized')
      return
    }

    console.log('[LLMManager] Initializing in main process...')

    try {
      // Cancel any pending Ollama requests from before restart
      cancelAllOllamaRequests()
      console.log('[LLMManager] Cleared any pending Ollama requests')

      // Load Ollama network configuration
      await this.loadOllamaConfig()

      // Load saved settings
      await this.loadSettings()

      // Register available models
      await this.registerModels()

      // Initialize MCP servers
      await this.initializeMCP()

      this.isInitialized = true
      console.log('[LLMManager] Initialized successfully with MCP support')

      // Pre-warm LLM connection in background (don't await)
      this.preWarmConnection().catch(err => {
        console.log('[LLMManager] Pre-warm failed (non-critical):', err.message)
      })

      // Immediate verification after initialization
      console.log('[LLMManager] POST-INIT VERIFICATION:')
      console.log(`  - mcpTools.size: ${this.mcpTools.size}`)
      console.log(`  - mcpClients.size: ${this.mcpClients.size}`)
      console.log(`  - Available tools:`, Array.from(this.mcpTools.keys()))
    } catch (error) {
      console.error('[LLMManager] Initialization failed:', error)
      throw error
    }
  }

  async registerModels(): Promise<any> {
    // Check for LM Studio availability (optional)
    try {
      const isLMStudioAvailable: any = await lmstudio.isLMStudioRunning()

      if (isLMStudioAvailable) {
        console.log('[LLMManager] LM Studio is available')
        const lmStudioModels: any = await lmstudio.getAvailableModels()

        if (lmStudioModels.length > 0) {
          // Register each available LM Studio model
          for (const model of lmStudioModels) {
            this.models.set(`lmstudio:${model.id}`, {
              id: `lmstudio:${model.id}`,
              name: `${model.id} (LM Studio)`,
              provider: 'lmstudio',
              description: 'Local model via LM Studio',
              capabilities: ['chat', 'completion', 'streaming'],
              contextLength: model.context_length || 4096,
              parameters: {
                modelName: model.id,
                temperature: 0.7,
                maxTokens: 2048
              }
            })
          }

          // Also register a default LM Studio option
          this.models.set('lmstudio:default', {
            id: 'lmstudio:default',
            name: 'LM Studio (Active Model)',
            provider: 'lmstudio',
            description: 'Currently loaded model in LM Studio',
            capabilities: ['chat', 'completion', 'streaming'],
            contextLength: 4096,
            parameters: {
              modelName: 'default',
              temperature: 0.7,
              maxTokens: 2048
            }
          })

          console.log(`[LLMManager] Registered ${lmStudioModels.length} LM Studio models`)
        }
      }
    } catch (error) {
      console.log('[LLMManager] LM Studio not available:', (error as Error).message)
    }

    // Discover Ollama models dynamically
    await this.discoverOllamaModels()

    // Discover Claude models during init (reads API key from secure storage)
    await this.discoverClaudeModels()

    console.log(`[LLMManager] Registered ${this.models.size} models`)

    // No default model concept in LLM manager
    console.log(`[LLMManager] ${this.models.size} models registered`)
  }

  async discoverOllamaModels(): Promise<any> {
    try {
      const ollamaModels: any = await getLocalOllamaModels()

      if (ollamaModels.length > 0) {
        console.log(`[LLMManager] Discovered ${ollamaModels.length} Ollama models`)

        for (const rawModel of ollamaModels) {
          const parsedModel = parseOllamaModel(rawModel)

          // All Ollama models get base capabilities
          const capabilities = ['chat', 'completion'];

          // Register the base model
          this.models.set(parsedModel.id, {
            id: parsedModel.id,
            name: parsedModel.displayName,
            provider: 'ollama',
            description: `${parsedModel.description} (${parsedModel.size})`,
            capabilities,
            contextLength: 8192,
            size: parsedModel.sizeBytes, // Numeric size in bytes for sorting/display
            parameters: {
              modelName: parsedModel.name, // The actual Ollama model name
              temperature: 0.7,
              maxTokens: 1024  // Reduced from 2048 - reasoning models expand this significantly
            }
          })

          console.log(`[LLMManager] Registered Ollama model: ${parsedModel.id}`)
        }
      } else {
        console.log('[LLMManager] No Ollama models found')
      }
    } catch (error) {
      console.log('[LLMManager] Failed to discover Ollama models:', (error as Error).message)
    }
  }

  async discoverClaudeModels(providedApiKey?: string): Promise<any> {
    try {
      // Platform layer must provide API key - lama.core is platform-agnostic
      if (!providedApiKey) {
        console.log('[LLMManager] No Claude API key provided, skipping Claude model discovery')
        return
      }

      const apiKey = providedApiKey

      console.log('[LLMManager] Discovering Claude models with API key:', apiKey?.substring(0, 20) + '...')

      // Query Anthropic API for available models
      const response: any = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[LLMManager] Failed to fetch Claude models from API:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        })
        return
      }

      const data = await response.json()
      console.log('[LLMManager] Raw API response:', data)

      if (data.data && Array.isArray(data.data)) {
        console.log(`[LLMManager] Discovered ${data.data.length} Claude models from API`)

        for (const model of data.data) {
          const modelId = `claude:${model.id}`

          // Generate human-readable name from model ID if display_name not provided
          let displayName = model.display_name
          if (!displayName) {
            // Transform "claude-3-5-sonnet-20241022" into "Claude 3.5 Sonnet"
            displayName = model.id
              .replace(/^claude-/, 'Claude ')
              .replace(/-(\d+)$/, '') // Remove date suffix
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (char: string) => char.toUpperCase()) // Capitalize each word
          }

          // Determine max output tokens based on model family
          // Claude 3 (opus/sonnet/haiku): 4096 tokens
          // Claude 3.5+: 8192 tokens
          // Claude 4+: 16384 tokens
          let maxOutputTokens = 8192 // Default for newer models
          if (model.id.match(/^claude-3-(?:opus|sonnet|haiku)-/)) {
            maxOutputTokens = 4096
          } else if (model.id.match(/^claude-4/)) {
            maxOutputTokens = 16384
          }

          this.models.set(modelId, {
            id: modelId,
            name: displayName,
            provider: 'anthropic',
            description: `Claude model: ${model.id}`,
            capabilities: ['chat', 'analysis', 'reasoning', 'structured_output'],
            contextLength: model.max_tokens || 200000,
            parameters: {
              temperature: 0.7,
              maxTokens: maxOutputTokens
            }
          })

          console.log(`[LLMManager] Registered Claude model: ${modelId} as "${displayName}"`)
        }
      }
    } catch (error) {
      console.log('[LLMManager] Failed to discover Claude models:', (error as Error).message)
    }
  }

  async initializeMCP(): Promise<any> {
    console.log('[LLMManager] Initializing MCP servers...')

    // MCP is optional - skip if not available
    if (!this.mcpManager) {
      console.log('[LLMManager] MCP manager not available, skipping MCP initialization')
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
        console.log(`[LLMManager] Registered ${registeredTools.length} MCP tools`)
      }
      
      console.log(`[LLMManager] MCP initialized with ${this.mcpTools.size} tools`)
    } catch (error) {
      console.warn('[LLMManager] MCP initialization failed (non-critical):', error)
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
        console.log('[LLMManager] MCP SDK not available (browser platform), skipping LAMA MCP server')
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
          console.log(`[LLMManager] Registered LAMA tool: ${tool.name}`)
        })
      }
      
      console.log('[LLMManager] LAMA MCP server started')
    } catch (error) {
      console.warn('[LLMManager] Failed to start LAMA MCP server:', error)
    }
  }

  async chat(messages: any, modelId: any, options: any = {}): Promise<unknown> {
    // modelId is required - no default
    if (!modelId) {
      throw new Error('Model ID is required for chat')
    }
    const effectiveModelId = modelId
    const model = this.models.get(effectiveModelId)
    if (!model) {
      throw new Error(`Model ${effectiveModelId} not found. Available models: ${Array.from(this.models.keys()).join(', ')}`)
    }

    console.log(`[LLMManager] Chat with ${(model as any).id} (${messages.length} messages), ${this.mcpTools.size} MCP tools available`)

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
      console.log(`[LLMManager] Tools explicitly disabled via disableTools option`)
    } else {
      console.log(`[LLMManager] ABOUT TO ENHANCE MESSAGES`)
    }

    // Add tool descriptions to system message (unless explicitly disabled)
    const enhancedMessages = shouldDisableTools ? messages : await this.enhanceMessagesWithContext(messages, {})
    console.log(`[LLMManager] ENHANCEMENT ${shouldDisableTools ? 'SKIPPED' : 'COMPLETE'}`)

    // Inject API key for Anthropic if not provided
    if ((model as any).provider === 'anthropic' && !(options as any)?.apiKey) {
      console.log(`[LLMManager] 🔍 DEBUG: this.userSettingsManager = ${this.userSettingsManager ? 'EXISTS' : 'UNDEFINED'}`)
      console.log(`[LLMManager] 🔍 DEBUG: this.userSettingsManager type = ${typeof this.userSettingsManager}`)
      if (this.userSettingsManager) {
        const apiKey = await this.userSettingsManager.getApiKey('anthropic')
        if (apiKey) {
          console.log(`[LLMManager] Injected Claude API key from UserSettings`)
          options = { ...options, apiKey }
        } else {
          console.error(`[LLMManager] ❌ No Claude API key found in UserSettings`)
        }
      } else {
        console.error(`[LLMManager] ❌ UserSettingsManager not available, cannot retrieve API key`)
        console.error(`[LLMManager] ❌ This should NOT happen if updateSystemPromptDependencies() was called!`)
      }
    }

    let response

    if ((model as any).provider === 'ollama') {
      response = await this.chatWithOllama(model as any, enhancedMessages, options)
    } else if ((model as any).provider === 'lmstudio') {
      response = await this.chatWithLMStudio(model as any, enhancedMessages, options)
    } else if ((model as any).provider === 'anthropic') {
      response = await this.chatWithClaude(model as any, enhancedMessages, options)
    } else {
      throw new Error(`Unsupported provider: ${(model as any).provider}`)
    }

    // Build context for tool execution
    const context = {
      modelId: effectiveModelId,
      isPrivateModel: effectiveModelId.endsWith('-private'),
      topicId: options.topicId,
      personId: options.personId
    }

    // Process tool calls if present (ReACT pattern - tool results go back to LLM)
    response = await this.processToolCalls(response, context, enhancedMessages, modelId, options)

    return response
  }

  getToolDescriptions(): any {
    return this.mcpManager?.getToolDescriptions() || null
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
      console.log(`[LLMManager] Skipping context enhancement for welcome message`)
      return messages
    }

    const logMsg1 = `[LLMManager] ============= ENHANCING MESSAGES WITH SYSTEM PROMPT =============`
    const logMsg2 = `[LLMManager] Topic ID: ${context?.topicId || 'none'}`
    const logMsg3 = `[LLMManager] Current subjects: ${context?.currentSubjects?.join(', ') || 'none'}`

    console.log(logMsg1)
    console.log(logMsg2)
    console.log(logMsg3)

    this.forwardLog?.('log', logMsg1)
    this.forwardLog?.('log', logMsg2)
    this.forwardLog?.('log', logMsg3)

    try {
      const enhanced = await this.systemPromptBuilder.enhanceMessages(messages, context)

      console.log(`[LLMManager] Enhanced messages count: ${enhanced.length}`)
      console.log(`[LLMManager] First message role: ${enhanced[0]?.role}, content length: ${enhanced[0]?.content?.length}`)
      console.log(`[LLMManager] System message preview: ${enhanced[0]?.content?.substring(0, 300)}...`)

      return enhanced
    } catch (error) {
      console.error('[LLMManager] Failed to enhance messages:', error)
      this.forwardLog?.('error', `Failed to enhance messages: ${(error as Error).message}`)
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
    console.log('[LLMManager] Checking for tool calls in response...')

    // Handle both string responses and object responses (with thinking)
    let responseText: string;
    let hasThinking = false;
    if (typeof response === 'object' && response._hasThinking) {
      // Response includes thinking metadata
      responseText = response.content;
      hasThinking = true;
      console.log('[LLMManager] Response includes thinking metadata, using content field');
    } else if (typeof response === 'string') {
      responseText = response;
    } else {
      console.warn('[LLMManager] Unexpected response type:', typeof response);
      return response || '';
    }

    console.log('[LLMManager] Response preview:', responseText?.substring(0, 200))

    // Check for tool calls in response - try both with and without backticks
    let toolCallMatch = responseText?.match(/```json\s*({[\s\S]*?})\s*```/)
    let toolCallJson = null

    if (!toolCallMatch) {
      // Try to extract plain JSON with robust brace counting
      toolCallJson = this.extractJsonFromText(responseText)
      if (toolCallJson) {
        console.log('[LLMManager] Found plain JSON tool call using brace counting')
        // Create a match-like array for compatibility with existing code
        toolCallMatch = [toolCallJson, toolCallJson] as RegExpMatchArray
      }
    }

    if (!toolCallMatch) {
      console.log('[LLMManager] No tool call found in response')
      return response || ''
    }

    console.log('[LLMManager] Found potential tool call:', toolCallMatch[1])

    try {
      const toolCall = JSON.parse(toolCallMatch[1])
      if (toolCall.tool) {
        console.log(`[LLMManager] Executing tool: ${toolCall.tool} with params:`, toolCall.parameters)

        const result: any = await this.mcpManager?.executeTool(
          toolCall.tool,
          toolCall.parameters || {},
          context // Pass context for memory tools
        )

        console.log('[LLMManager] Tool execution result:', JSON.stringify(result).substring(0, 200))

        // Extract tool result text for the LLM to process
        let toolResultText = ''
        if (result.content && Array.isArray(result.content)) {
          const textParts = result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
          toolResultText = textParts.join('\n\n')
        } else if (typeof result === 'string') {
          toolResultText = result
        } else {
          toolResultText = JSON.stringify(result, null, 2)
        }

        // CRITICAL: Implement ReACT pattern - send tool result back to LLM for natural response
        // Instead of returning the tool result directly, let the LLM process it
        if (messages && modelId && options) {
          console.log('[LLMManager] ReACT: Sending tool result back to LLM for natural response...')

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
          console.log('[LLMManager] ReACT: Recursively calling chat() for follow-up...')

          const reactOptions = {
            ...options,
            disableTools: true // Disable tools for the follow-up call to avoid infinite loops
          }

          // Recursive call to chat() - will go through full pipeline including processToolCalls
          // but tools are disabled so it won't loop
          const finalResponse = await this.chat(conversationWithToolResult, modelId, reactOptions)

          console.log('[LLMManager] ReACT: Got natural response from recursive chat()')
          return finalResponse
        }

        // FALLBACK (for backward compatibility if messages/modelId not provided)
        // Format the result and return it directly
        console.warn('[LLMManager] No messages/modelId provided - falling back to direct tool result (not ideal)')

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
      console.error('[LLMManager] Tool execution failed:', error)
    }

    return response || ''
  }

  async chatWithOllama(model: any, messages: any, options: any = {}): Promise<unknown> {
    try {
      return await chatWithOllama(
        model.parameters.modelName,
        messages,
        {
          temperature: model.parameters.temperature,
          max_tokens: model.parameters.maxTokens,
          onStream: options.onStream,
          onThinkingStream: options.onThinkingStream,  // Pass through thinking stream callback
          format: options.format,  // Pass through structured output schema
          topicId: options.topicId  // Pass through topicId for request tracking and cancellation
        }
      )
    } catch (error: any) {
      // If structured output was requested and failed, cache this
      if (options.format && error.message?.includes('generated no response')) {
        model.structuredOutputTested = false;
        console.log(`[LLMManager] Model ${model.id} does not support structured output - cached for future calls`);
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

    // Extract base model ID - stored as claude:claude-3-5-sonnet-20241022
    // Need to send just: claude-3-5-sonnet-20241022
    const baseModelId = model.id.startsWith('claude:') ? model.id.substring(7) : model.id

    console.log(`[LLMManager] Calling Claude with model ID: ${baseModelId}`)

    // Get MCP tools if available and not explicitly disabled
    const claudeOptions: any = {
      apiKey,
      temperature: model.parameters.temperature,
      max_tokens: model.parameters.maxTokens,
      onStream: options.onStream
    };

    // Add MCP tools unless explicitly disabled
    if (!options.disableTools && this.mcpManager) {
      const tools = this.mcpManager.getClaudeTools?.();
      if (tools && Array.isArray(tools) && tools.length > 0) {
        claudeOptions.tools = tools;
        console.log(`[LLMManager] Passing ${tools.length} MCP tools to Claude`);
      }
    }

    return await chatWithClaude(
      baseModelId,
      messages,
      claudeOptions
    )
  }

  async loadSettings(): Promise<any> {
    // Runtime settings only - no default model concept here
    console.log('[LLMManager] Loaded runtime settings')
  }

  /**
   * Stop streaming for a specific topic
   * @param topicId The topic ID to stop streaming for
   * @returns true if a stream was cancelled, false if no active stream found
   */
  stopStreaming(topicId: string): boolean {
    console.log(`[LLMManager] Stopping streaming for topic: ${topicId}`)
    return cancelStreamingForTopic(topicId)
  }

  getStoredApiKey(provider: any): any {
    // Implement secure key storage
    return null
  }

  async setApiKey(provider: any, apiKey: any): Promise<any> {
    // Store API key securely
    console.log(`[LLMManager] API key set for ${provider}`)
  }

  getModels(): any {
    return Array.from(this.models.values())
  }

  getModel(id: any): any {
    return this.models.get(id)
  }

  /**
   * Get available models for external consumers
   */
  getAvailableModels(): any {
    return Array.from(this.models.values()).map((model: any) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      description: model.description,
      contextLength: model.contextLength || 4096,
      maxTokens: model.parameters?.maxTokens || 2048,
      capabilities: model.capabilities || [],
      // Determine modelType: local for Ollama, remote for API-based services
      modelType: model.provider === 'ollama' ? 'local' : 'remote',
      size: model.size, // Include size if available
      isLoaded: model.isLoaded || false, // Include load status
      isDefault: model.isDefault || false // Include default status
    }))
  }
  
  /**
   * Set the personId for a model (used by AIAssistantModel)
   */
  setModelPersonId(modelId: any, personId: any): any {
    const model = this.models.get(modelId)
    if (model) {
      model.personId = personId
      console.log(`[LLMManager] Set personId for ${modelId}: ${personId?.toString().substring(0, 8)}...`)
    }
  }
  
  /**
   * Check if a personId belongs to an AI model
   */
  isAIPersonId(personId: any): any {
    const personIdStr = personId?.toString()
    if (!personIdStr) return false
    
    for (const model of this.models.values()) {
      if (model.personId?.toString() === personIdStr) {
        return true
      }
    }
    return false
  }

  debugToolsState(): any {
    console.log(`[LLMManager] DEBUG - Tools state:`)
    console.log(`  - mcpTools.size: ${this.mcpTools.size}`)
    console.log(`  - mcpClients.size: ${this.mcpClients.size}`)
    console.log(`  - Available tools:`, Array.from(this.mcpTools.keys()))
    console.log(`  - isInitialized: ${this.isInitialized}`)
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
    try {
      // Make a minimal API call to test the key
      const response: any = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      })
      
      return response.ok
    } catch (error) {
      console.error('[LLMManager] Claude API key test failed:', error)
      return false
    }
  }

  /**
   * Test an OpenAI API key
   */
  async testOpenAIApiKey(apiKey: any): Promise<any> {
    try {
      // Make a minimal API call to test the key
      const response: any = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      })
      
      return response.ok
    } catch (error) {
      console.error('[LLMManager] OpenAI API key test failed:', error)
      return false
    }
  }

  /**
   * Register a -private variant of a model for LAMA conversations
   */
  registerPrivateVariant(modelId: any): any {
    const baseModel = this.models.get(modelId)
    if (!baseModel) {
      console.warn(`[LLMManager] Cannot create private variant - base model ${modelId} not found`)
      return null
    }

    const privateModelId = `${modelId}-private`
    const privateModel = {
      ...baseModel,
      id: privateModelId,
      name: `${baseModel.name}-private`,
      description: `${baseModel.description} (Private for LAMA)`
    }

    this.models.set(privateModelId, privateModel)
    console.log(`[LLMManager] Registered private variant: ${privateModelId}`)
    return privateModelId
  }

  /**
   * Register private variant for LAMA conversations
   * Called by AI assistant when needed
   */
  registerPrivateVariantForModel(modelId: any): any {
    const model = this.models.get(modelId)
    if (!model) {
      throw new Error(`Model ${modelId} not found`)
    }

    this.registerPrivateVariant(modelId)
    console.log(`[LLMManager] Registered private variant for: ${modelId}`)
  }

  async shutdown(): Promise<any> {
    console.log('[LLMManager] Shutting down...')

    // Close MCP connections
    for (const [name, client] of this.mcpClients) {
      try {
        await client.close()
        console.log(`[LLMManager] Closed MCP client: ${name}`)
      } catch (error) {
        console.error(`[LLMManager] Error closing ${name}:`, error)
      }
    }

    this.mcpClients.clear()
    this.mcpTools.clear()
    this.models.clear()
    this.modelSettings.clear()
    this.isInitialized = false

    console.log('[LLMManager] Shutdown complete')
  }
}

// Export both the class (for custom instantiation) and a default singleton
export { LLMManager }
export default new LLMManager()