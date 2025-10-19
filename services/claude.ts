/**
 * Claude AI Service for Main Process
 * Provides integration with Anthropic's Claude API in Node.js environment
 */

import Anthropic from '@anthropic-ai/sdk'

export interface ClaudeConfig {
  apiKey: string
  baseURL?: string
  maxRetries?: number
  timeout?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

class ClaudeService {
  private client?: Anthropic
  private config?: ClaudeConfig

  /**
   * Initialize the Claude service with API credentials
   */
  initialize(config: ClaudeConfig): void {
    this.config = config
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: config.maxRetries || 2,
      timeout: config.timeout || 60000
    })

    console.log('[ClaudeService] Initialized with API key')
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return !!this.client
  }

  /**
   * Chat with Claude
   */
  async chat(
    modelId: string,
    messages: ChatMessage[],
    options?: {
      temperature?: number
      max_tokens?: number
      system?: string
      onStream?: (chunk: string) => void
    }
  ): Promise<string> {
    if (!this.client) {
      throw new Error('Claude service not initialized')
    }

    // Convert messages to Anthropic format
    const anthropicMessages = messages
      .filter(m => m.role !== 'system') // System message is handled separately
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))

    // Extract system message if present
    const systemMessage = messages.find(m => m.role === 'system')?.content || options?.system

    try {
      if (options?.onStream) {
        // Streaming response
        const stream = await this.client.messages.create({
          model: modelId,
          max_tokens: options?.max_tokens || 4096,
          temperature: options?.temperature || 0.7,
          system: systemMessage,
          messages: anthropicMessages,
          stream: true
        })

        let fullResponse = ''
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const chunk = event.delta.text
            fullResponse += chunk
            options.onStream(chunk)
          }
        }

        return fullResponse
      } else {
        // Non-streaming response
        const response = await this.client.messages.create({
          model: modelId,
          max_tokens: options?.max_tokens || 4096,
          temperature: options?.temperature || 0.7,
          system: systemMessage,
          messages: anthropicMessages
        })

        // Extract text from response
        const textContent = response.content
          .filter(block => block.type === 'text')
          .map(block => (block as any).text)
          .join('\n')

        return textContent
      }
    } catch (error) {
      console.error('[ClaudeService] Chat failed:', error)
      throw error
    }
  }

  /**
   * Clear the service
   */
  clear(): void {
    this.client = undefined
    this.config = undefined
  }
}

// Export singleton instance
export const claudeService = new ClaudeService()

// Helper function for direct use
export async function chatWithClaude(
  modelId: string,
  messages: ChatMessage[],
  options?: {
    temperature?: number
    max_tokens?: number
    apiKey?: string
    onStream?: (chunk: string) => void
  }
): Promise<string> {
  // Initialize with API key if provided
  if (options?.apiKey && !claudeService.isInitialized()) {
    claudeService.initialize({ apiKey: options.apiKey })
  }

  if (!claudeService.isInitialized()) {
    throw new Error('Claude service not initialized. Please provide an API key.')
  }

  return claudeService.chat(modelId, messages, options)
}
