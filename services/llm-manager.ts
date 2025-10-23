/**
 * LLM Manager (Platform-Agnostic)
 * Handles AI model operations with optional MCP integration
 * Can run in Node.js or browser environments
 */

import { OEvent } from '@refinio/one.models/lib/misc/OEvent.js';
import type { LLMPlatform } from './llm-platform.js';
import { LLM_RESPONSE_SCHEMA } from '../schemas/llm-response.schema.js';

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

  constructor(platform?: LLMPlatform, mcpManager?: any, forwardLog?: (level: string, message: string) => void) {
    this.platform = platform
    this.mcpManager = mcpManager
    this.forwardLog = forwardLog
    this.models = new Map()
    this.modelSettings = new Map()
    this.mcpClients = new Map()
    this.mcpTools = new Map()
    this.isInitialized = false
    this.ollamaConfig = null

    // Methods are already bound as class methods, no need for explicit binding
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
      const { cancelAllOllamaRequests } = await import('./ollama.js')
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
      const lmstudio: any = await import('./lmstudio.js');
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
      const { getLocalOllamaModels, parseOllamaModel } = await import('./ollama.js')
      const ollamaModels: any = await getLocalOllamaModels()

      if (ollamaModels.length > 0) {
        console.log(`[LLMManager] Discovered ${ollamaModels.length} Ollama models`)

        for (const rawModel of ollamaModels) {
          const parsedModel = parseOllamaModel(rawModel)

          // Register the base model
          this.models.set(parsedModel.id, {
            id: parsedModel.id,
            name: parsedModel.displayName,
            provider: 'ollama',
            description: `${parsedModel.description} (${parsedModel.size})`,
            capabilities: ['chat', 'completion'],
            contextLength: 8192,
            size: parsedModel.sizeBytes, // Numeric size in bytes for sorting/display
            parameters: {
              modelName: parsedModel.name, // The actual Ollama model name
              temperature: 0.7,
              maxTokens: 2048
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

          this.models.set(modelId, {
            id: modelId,
            name: displayName,
            provider: 'anthropic',
            description: `Claude model: ${model.id}`,
            capabilities: ['chat', 'analysis', 'reasoning'],
            contextLength: model.max_tokens || 200000,
            parameters: {
              temperature: 0.7,
              maxTokens: 8192
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
    console.log(`[LLMManager] ABOUT TO ENHANCE MESSAGES`)

    // Add tool descriptions to system message
    const enhancedMessages = this.enhanceMessagesWithTools(messages)
    console.log(`[LLMManager] ENHANCEMENT COMPLETE`)

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

    // Process tool calls if present
    response = await this.processToolCalls(response, context)

    return response
  }

  getToolDescriptions(): any {
    return this.mcpManager?.getToolDescriptions() || null
  }

  enhanceMessagesWithTools(messages: any): any {
    // Check if this is a simple welcome message request
    const isWelcomeMessage = messages.some((m: any) =>
      m.content && (
        m.content.includes('Generate a welcome message') ||
        m.content.includes('Generate a brief, friendly welcome')
      )
    )

    // Skip tool enhancement for welcome messages
    if (isWelcomeMessage) {
      console.log(`[LLMManager] Skipping tool enhancement for welcome message`)
      return messages
    }

    const logMsg1 = `[LLMManager] ============= ENHANCING MESSAGES =============`
    const logMsg2 = `[LLMManager] MCP Tools size: ${this.mcpTools.size}`
    const toolDescriptions = this.getToolDescriptions()

    // Check for null/undefined BEFORE accessing .length
    if (!toolDescriptions) {
      const logMsg5 = `[LLMManager] NO TOOL DESCRIPTIONS - returning original messages`
      console.log(logMsg1)
      console.log(logMsg2)
      console.log(logMsg5)
      this.forwardLog?.('log', logMsg1)
      this.forwardLog?.('log', logMsg2)
      this.forwardLog?.('warn', logMsg5)
      return messages
    }

    const logMsg3 = `[LLMManager] Tool descriptions length: ${toolDescriptions.length}`
    const logMsg4 = `[LLMManager] ============================================`

    console.log(logMsg1)
    console.log(logMsg2)
    console.log(logMsg3)
    console.log(logMsg4)

    // Forward to renderer (optional)
    this.forwardLog?.('log', logMsg1)
    this.forwardLog?.('log', logMsg2)
    this.forwardLog?.('log', logMsg3)
    this.forwardLog?.('log', logMsg4)

    const enhanced = [...messages]
    const systemIndex = enhanced.findIndex(m => m.role === 'system')

    if (systemIndex >= 0) {
      enhanced[systemIndex] = {
        ...enhanced[systemIndex],
        content: enhanced[systemIndex].content + toolDescriptions
      }
      console.log(`[LLMManager] Enhanced existing system message with tools`)
    } else {
      enhanced.unshift({
        role: 'system',
        content: 'You are a private AI assistant with access to all of the owner\'s conversations and filesystem tools. You can help with any topic across all chats.' + toolDescriptions
      })
      console.log(`[LLMManager] Added new system message with tools`)
    }

    console.log(`[LLMManager] Enhanced messages count: ${enhanced.length}, first message preview: ${enhanced[0]?.content?.substring(0, 200)}...`)
    return enhanced
  }

  async processToolCalls(response: any, context?: any): Promise<any> {
    console.log('[LLMManager] Checking for tool calls in response...')
    console.log('[LLMManager] Response preview:', response?.substring(0, 200))

    // Check for tool calls in response - try both with and without backticks
    let toolCallMatch = response?.match(/```json\s*({[\s\S]*?})\s*```/)
    if (!toolCallMatch) {
      // Try without backticks for plain JSON response (anywhere in the response)
      toolCallMatch = response?.match(/(\{[^}]*"tool"[^}]*"parameters"[^}]*\})/)
      if (toolCallMatch) {
        console.log('[LLMManager] Found plain JSON tool call')
      }
    }

    if (!toolCallMatch) {
      console.log('[LLMManager] No tool call found in response')
      return response || ''
    }

    console.log('[LLMManager] Found potential tool call:', toolCallMatch[0])

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
        
        // Format the result based on tool type with elegant, natural language
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
        } else if (toolCall.tool.includes('read_file') || toolCall.tool.includes('read_text')) {
          // Format file reading results
          if (result.content && Array.isArray(result.content)) {
            const textContent = result.content.find((c: any) => c.type === 'text')
            if (textContent && textContent.text) {
              const fileName = toolCall.parameters?.path || 'the file'
              formattedResult = `Here's the content of ${fileName}:\n\n\`\`\`\n${textContent.text}\n\`\`\``
            } else {
              formattedResult = 'File content:\n\n' + JSON.stringify(result, null, 2)
            }
          } else {
            formattedResult = result
          }
        } else if (toolCall.tool.includes('write_file') || toolCall.tool.includes('edit_file')) {
          // Format file writing/editing results
          formattedResult = '✅ File operation completed successfully.'
          if (toolCall.parameters?.path) {
            formattedResult = `✅ Successfully updated ${toolCall.parameters.path}`
          }
        } else if (toolCall.tool.includes('search')) {
          // Format search results
          if (result.content && Array.isArray(result.content)) {
            const textContent = result.content.find((c: any) => c.type === 'text')
            if (textContent && textContent.text) {
              formattedResult = `Search results:\n\n${textContent.text}`
            } else {
              formattedResult = 'Search completed.'
            }
          } else {
            formattedResult = result
          }
        } else if (result.content && Array.isArray(result.content)) {
          // Generic MCP tool response with content array
          const textParts = result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
          formattedResult = textParts.join('\n\n')
        } else if (typeof result === 'string') {
          formattedResult = result
        } else {
          // Fallback to JSON for complex objects
          formattedResult = JSON.stringify(result, null, 2)
        }
        
        // Return the elegantly formatted result
        return response.replace(toolCallMatch[0], formattedResult)
      }
    } catch (error) {
      console.error('[LLMManager] Tool execution failed:', error)
    }
    
    return response || ''
  }

  async chatWithOllama(model: any, messages: any, options: any = {}): Promise<unknown> {
    const { chatWithOllama } = await import('./ollama.js')

    return await chatWithOllama(
      model.parameters.modelName,
      messages,
      {
        temperature: model.parameters.temperature,
        max_tokens: model.parameters.maxTokens,
        onStream: options.onStream,
        format: options.format  // Pass through structured output schema
      }
    )
  }
  
  /**
   * Chat with response and topic analysis in a single LLM call
   * Streams response in real-time, then parses JSON for analysis
   */
  async chatWithAnalysis(messages: any, modelId = null, options: any = {}, topicId?: string): Promise<unknown> {
    const startTime = Date.now()

    try {
      if (!modelId) {
        throw new Error('Model ID is required for chatWithAnalysis')
      }
      const model = this.models.get(modelId)
      if (!model) {
        throw new Error('No model available')
      }

      console.log(`[LLMManager] Chat with analysis using ${model.id}, topicId: ${topicId}`)

      // Schema is now always available from lama.core

      // STREAMING STRATEGY:
      // Stream natural response FIRST (no structured output in user-facing response)
      // Then extract analysis SEPARATELY using structured output

      // Generate response with streaming
      // NOTE: chat() will process tool calls automatically, so we call it directly
      let fullResponse = ''
      console.log('[LLMManager] chatWithAnalysis: About to call this.chat()')
      console.log('[LLMManager] chatWithAnalysis: modelId =', modelId)
      console.log('[LLMManager] chatWithAnalysis: messages.length =', messages.length)
      console.log('[LLMManager] chatWithAnalysis: options.onStream =', typeof options.onStream)

      // Call chat() which handles tool execution, and pass through streaming options
      fullResponse = await this.chat(messages, modelId, options) as string

      console.log('[LLMManager] chatWithAnalysis: chat() returned, fullResponse.length =', fullResponse.length)

      // After chat() has processed tool calls, extract clean response for analysis
      let cleanResponse = fullResponse

      // Extract the clean response (everything before JSON block for topic analysis)
      // Only filter out topic analysis JSON (has "subjects" field), not tool call JSON
      const jsonBlockMatch = fullResponse.match(/\n*\{[\s\S]*"subjects"[\s\S]*\}\s*$/);
      if (jsonBlockMatch) {
        cleanResponse = fullResponse.substring(0, jsonBlockMatch.index).trim()
        console.log('[LLMManager] Filtered out embedded analysis JSON from response')
      }

      console.log('[LLMManager] Response streaming complete, now extracting analysis...')

      // First, try to extract JSON from the embedded response
      let embeddedAnalysis = null
      const embeddedJsonMatch = fullResponse.match(/\{[\s\S]*"subjects"[\s\S]*\}/);
      if (embeddedJsonMatch) {
        try {
          const jsonStr = embeddedJsonMatch[0]
          embeddedAnalysis = JSON.parse(jsonStr)
          console.log('[LLMManager] Found embedded analysis JSON in response')
        } catch (e) {
          console.warn('[LLMManager] Failed to parse embedded JSON:', e)
        }
      }

      // If we have embedded analysis, use it; otherwise, make a separate call
      let analysisJson: string
      let parsed: { subjects: any[], summary: string }

      if (embeddedAnalysis) {
        // Use the embedded analysis
        parsed = embeddedAnalysis
        console.log('[LLMManager] Using embedded analysis from response')
      } else {
        // Make a separate structured output call
        const analysisMessages = [
          {
            role: 'system',
            content: `Extract subjects and concepts from this conversation. Return ONLY JSON:
{
  "subjects": [{"name": "subject-name", "concepts": ["concept1", "concept2"]}],
  "summary": "brief summary"
}`
          },
          ...messages,
          {
            role: 'assistant',
            content: cleanResponse
          },
          {
            role: 'user',
            content: 'Extract the subjects, keywords, and summary from the above conversation.'
          }
        ]

        try {
          // Use qwen2.5:7b for structured analysis (supports format parameter)
          // Fallback to user's model if qwen2.5:7b not available
          const analysisModelId = this.models.has('qwen2.5:7b') ? 'qwen2.5:7b' : modelId
          console.log(`[LLMManager] Using ${analysisModelId} for analysis extraction`)

          analysisJson = await this.chat(analysisMessages, analysisModelId, {
            format: LLM_RESPONSE_SCHEMA,
            temperature: 0
          }) as string

          // Parse analysis
          let cleanJson = analysisJson.trim()
          if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
          }
          parsed = JSON.parse(cleanJson)
        } catch (error) {
          console.warn('[LLMManager] Structured analysis failed:', (error as Error).message)
          parsed = { subjects: [], summary: '' }
        }
      }

      // Convert to internal format, handling both embedded and structured output formats
      const analysis = {
        subjects: (parsed.subjects || []).map((subject: any) => {
          // Handle both formats:
          // Embedded: { name, isNew, key_concepts: [{concept, confidence}] }
          // Structured: { name, concepts: ["term1", "term2"] }
          let keywords = []

          // Try all possible field names: key_concepts, keyConcepts, concepts
          const conceptsArray = subject.key_concepts || subject.keyConcepts || subject.concepts

          if (conceptsArray && Array.isArray(conceptsArray)) {
            keywords = conceptsArray.map((item: any) => {
              // Handle various formats:
              // 1. {keyword: "term", confidence: 0.9} - LLM sometimes uses "keyword" instead of "term"
              // 2. {term: "term", confidence: 0.9} - Schema format
              // 3. {concept: "term", confidence: 0.9} - Legacy format
              // 4. "term" - String format
              if (typeof item === 'object' && item !== null) {
                const term = item.keyword || item.term || item.concept
                if (term) {
                  return {
                    term: String(term),
                    confidence: item.confidence || 0.8
                  }
                }
              }
              // Fallback: treat as string
              return {
                term: String(item),
                confidence: 0.8
              }
            })
          }

          return {
            name: subject.name,
            description: subject.description || `Subject: ${subject.name}`,
            isNew: subject.isNew !== undefined ? subject.isNew : true,
            keywords
          }
        }),
        summaryUpdate: parsed.summary || ''
      }

      console.log('[LLMManager] Analysis extraction complete')
      console.log('[LLMManager] - Subjects count:', analysis.subjects.length)
      console.log('[LLMManager] - Summary:', analysis.summaryUpdate?.substring(0, 100))
      console.log(`[LLMManager] Chat with analysis completed in ${Date.now() - startTime}ms`)

      return {
        response: cleanResponse,  // Return clean response without JSON
        analysis,
        topicId
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[LLMManager] Chat with analysis error:', error)
      throw new Error(`Chat with analysis failed: ${errorMessage}`)
    }
  }

  async chatWithLMStudio(model: any, messages: any, options: any = {}): Promise<any> {
    const lmstudio: any = await import('./lmstudio.js')
    
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
    const { chatWithClaude } = await import('./claude.js')

    // Platform layer must provide API key - lama.core is platform-agnostic
    const apiKey = options.apiKey
    if (!apiKey) {
      throw new Error('Claude API key not provided - platform layer must supply options.apiKey')
    }

    // Extract base model ID - stored as claude:claude-3-5-sonnet-20241022
    // Need to send just: claude-3-5-sonnet-20241022
    const baseModelId = model.id.startsWith('claude:') ? model.id.substring(7) : model.id

    console.log(`[LLMManager] Calling Claude with model ID: ${baseModelId}`)

    return await chatWithClaude(
      baseModelId,
      messages,
      {
        apiKey,
        temperature: model.parameters.temperature,
        max_tokens: model.parameters.maxTokens,
        onStream: options.onStream
      }
    )
  }

  async loadSettings(): Promise<any> {
    // Runtime settings only - no default model concept here
    console.log('[LLMManager] Loaded runtime settings')
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