/**
 * Ollama Integration Service (Platform-Agnostic)
 * Handles communication with local Ollama instance
 * Works in both Node.js and browser environments using native fetch
 */

// Use native fetch (Node.js 18+ and all browsers)
// No imports needed - fetch and AbortController are global

// Track active requests with AbortControllers
const activeRequests = new Map()

// Generate unique request ID
let requestCounter = 0
function getRequestId(): any {
  return `ollama-${Date.now()}-${++requestCounter}`
}

/**
 * Cancel all active Ollama requests
 */
export function cancelAllOllamaRequests(): any {
  console.log(`[Ollama] Cancelling ${activeRequests.size} active requests`)
  for (const [id, controller] of activeRequests) {
    try {
      controller.abort()
      console.log(`[Ollama] Cancelled request ${id}`)
    } catch (error) {
      console.error(`[Ollama] Error cancelling request ${id}:`, error)
    }
  }
  activeRequests.clear()
}

/**
 * Check if Ollama is running
 */
async function isOllamaRunning(baseUrl: string = 'http://localhost:11434', authHeaders?: Record<string, string>): Promise<any> {
  try {
    const headers = authHeaders || {};
    const response: any = await fetch(`${baseUrl}/api/tags`, { headers })
    return response.ok
  } catch (error) {
    console.log(`[Ollama] Service not running on ${baseUrl}`)
    return false
  }
}

/**
 * Test if a specific Ollama model is available
 */
async function testOllamaModel(modelName: any, baseUrl: string = 'http://localhost:11434', authHeaders?: Record<string, string>): Promise<any> {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(authHeaders || {})
    };

    const response: any = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelName,
        prompt: 'test',
        stream: false,
        options: {
          num_predict: 1
        }
      })
    })

    return response.ok
  } catch (error) {
    console.error(`[Ollama] Model ${modelName} test failed:`, error)
    return false
  }
}

/**
 * Chat with Ollama using the /api/chat endpoint
 *
 * @param options.format - Optional JSON schema for structured outputs (Ollama native)
 */
async function chatWithOllama(
  modelName: any,
  messages: any,
  options: any = {},
  baseUrl: string = 'http://localhost:11434',
  authHeaders?: Record<string, string>
): Promise<any> {
  const requestId = getRequestId()
  const controller = new AbortController()

  // Track this request
  activeRequests.set(requestId, controller)
  console.log(`[Ollama] Starting request ${requestId} to ${baseUrl}`)

  try {
    const t0 = Date.now()
    console.log(`[Ollama-${requestId}] ⏱️  T+0ms: Request started`)

    // Trust the caller (AIPromptBuilder) to provide properly formatted messages
    // No need to reorganize - messages are already in the correct order
    const formattedMessages = messages

    const startTime = Date.now()
    console.log(`[Ollama-${requestId}] ⏱️  T+${Date.now() - t0}ms: Using ${formattedMessages.length} messages from prompt builder`)

    // Prepare headers with auth if provided
    const headers = {
      'Content-Type': 'application/json',
      'Connection': 'keep-alive',
      ...(authHeaders || {})
    };

    // Structured outputs require non-streaming mode
    const useStreaming = !options.format;

    // Use the chat endpoint for proper conversation handling
    const requestBody: any = {
      model: modelName,
      messages: formattedMessages,
      stream: useStreaming,
      options: {
        temperature: options.temperature || 0.7,
        num_predict: options.max_tokens || -1,  // -1 = unlimited, let model stop naturally via EOS
        top_k: 40,
        top_p: 0.95
      }
    };

    // Add format parameter for structured outputs (Ollama native)
    if (options.format) {
      requestBody.format = options.format;
      console.log('[Ollama] ========== OLLAMA STRUCTURED OUTPUT ==========');
      console.log('[Ollama] Using structured output format (JSON schema)');
      console.log('[Ollama] Stream disabled for structured output');
      console.log('[Ollama] Format schema:', JSON.stringify(options.format, null, 2));
      console.log('[Ollama] ==============================================');
    }

    console.log(`[Ollama-${requestId}] ⏱️  T+${Date.now() - t0}ms: Sending fetch to ${baseUrl}/api/chat`)

    const response: any = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    })

    console.log(`[Ollama-${requestId}] ⏱️  T+${Date.now() - t0}ms: Response received (status: ${response.status})`)

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`)
    }

    // Non-streaming response (for structured outputs)
    if (!useStreaming) {
      const json = await response.json()
      // Handle different response formats
      let content = json.message?.content || json.thinking || ''
      console.log(`[Ollama] Non-streaming response: ${content.substring(0, 200)}...`)
      if (!content) {
        throw new Error('Ollama generated no response')
      }
      return content
    }

    // Process streaming response using ReadableStream (web standard)
    let fullResponse = ''
    let firstChunkTime = null
    let buffer = ''

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        if (!firstChunkTime) {
          firstChunkTime = Date.now()
          console.log(`[Ollama-${requestId}] ⏱️  T+${firstChunkTime - t0}ms: 🎉 FIRST CHUNK RECEIVED (time to first token)`)
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const json = JSON.parse(line)

            // DEBUG: Log the actual structure we receive
            console.log('[Ollama] Received JSON:', JSON.stringify(json, null, 2))

            // Handle different response formats:
            // 1. Regular models: json.message.content
            // 2. Reasoning models (gpt-oss, deepseek-r1): json.thinking or json.message.thinking
            let content = ''

            if (json.message && json.message.content) {
              content = json.message.content
            } else if (json.message && json.message.thinking) {
              // Reasoning models can put thinking inside message object
              content = json.message.thinking
            } else if (json.thinking) {
              // Or thinking at top level
              content = json.thinking
            }

            if (content) {
              fullResponse += content
              console.log('[Ollama] Extracted content, length:', content.length)

              // Stream to callback if provided
              if ((options as any).onStream) {
                console.log('[Ollama] ✅ Calling onStream callback with content length:', content.length)
                ;(options as any).onStream(content, false)
              } else {
                console.warn('[Ollama] ⚠️  No onStream callback provided!')
              }
            } else {
              console.warn('[Ollama] No content extracted from JSON. Keys:', Object.keys(json))
            }
          } catch (e: any) {
            console.error('[Ollama] Error parsing JSON line:', e.message, 'Line:', line)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer)
        let content = ''

        if (json.message && json.message.content) {
          content = json.message.content
        } else if (json.thinking) {
          // Reasoning models use 'thinking' field
          content = json.thinking
        }

        if (content) {
          fullResponse += content
          if ((options as any).onStream) {
            (options as any).onStream(content, false)
          }
        }
      } catch (e: any) {
        console.error('[Ollama] Error parsing final JSON:', e.message)
      }
    }
    
    const responseTime = Date.now() - startTime
    console.log(`[Ollama] ⏱️ Full response completed in ${responseTime}ms`)

    // Handle empty response - fail fast, no fallback
    if (!fullResponse || fullResponse === '') {
      throw new Error('Ollama generated no response - model may not support structured output or failed to generate')
    }

    {
      console.log('[Ollama] ========== OLLAMA RESPONSE TRACE ==========')
      console.log('[Ollama] Full response length:', fullResponse.length)
      console.log('[Ollama] Full response (first 500 chars):', fullResponse.substring(0, 500))
      console.log('[Ollama] Full response (last 200 chars):', fullResponse.substring(Math.max(0, fullResponse.length - 200)))
      console.log('[Ollama] ===========================================')
    }
    
    // Clean up request tracking
    activeRequests.delete(requestId)
    console.log(`[Ollama] Completed request ${requestId}`)
    
    return fullResponse
  } catch (error) {
    console.error(`[Ollama] Chat error for request ${requestId}:`, error)
    
    // Clean up on error
    activeRequests.delete(requestId)
    
    // Handle abort
    if (error.name === 'AbortError') {
      console.log(`[Ollama] Request ${requestId} was aborted`)
      throw new Error('Request was cancelled')
    }
    
    // Fallback response if Ollama is not available
    if ((error as Error).message.includes('ECONNREFUSED')) {
      return "I'm sorry, but I can't connect to the Ollama service. Please make sure Ollama is running on your system (http://localhost:11434). You can start it with 'ollama serve' in your terminal."
    }
    
    throw error
  }
}

/**
 * Generate completion with Ollama
 */
async function generateWithOllama(
  modelName: any,
  prompt: any,
  options: any = {},
  baseUrl: string = 'http://localhost:11434',
  authHeaders?: Record<string, string>
): Promise<any> {
  return chatWithOllama(modelName, [{ role: 'user', content: prompt }], options, baseUrl, authHeaders)
}

/**
 * Ollama model interfaces
 */
export interface OllamaModel {
  name: string
  size: number
  digest: string
  modified_at: string
  details?: {
    format: string
    family: string
    parameter_size: string
    quantization_level: string
  }
}

export interface OllamaModelInfo {
  id: string
  name: string
  displayName: string
  size: string
  sizeBytes: number
  description: string
  capabilities: string[]
  contextLength: number
  parameterSize: string
}

/**
 * Get list of locally available Ollama models
 */
export async function getLocalOllamaModels(baseUrl: string = 'http://localhost:11434'): Promise<OllamaModel[]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`)
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`)
    }

    const data = await response.json() as { models?: OllamaModel[] }
    return data.models || []
  } catch (error) {
    console.error('[Ollama] Failed to fetch local models:', error)
    return []
  }
}

/**
 * Extract parameter size from model name
 */
function extractModelSize(name: string): string {
  const match = name.match(/(\d+\.?\d*)[bB]/);
  if (match) {
    const size = parseFloat(match[1])
    if (size < 1) {
      return `${Math.round(size * 1000)}M`
    }
    return `${size}B`
  }

  // Check for millions
  const mMatch = name.match(/(\d+)m/i);
  if (mMatch) {
    return `${mMatch[1]}M`
  }

  return 'Unknown'
}

/**
 * Parse raw Ollama model into structured model info
 */
export function parseOllamaModel(model: OllamaModel): OllamaModelInfo {
  const sizeGB = (model.size / 1e9).toFixed(1)

  // Use actual model name and details from Ollama
  const displayName = model.name
  const parameterSize = model.details?.parameter_size || extractModelSize(model.name) || 'Unknown'

  // Detect capabilities based on model name
  const capabilities = ['chat', 'completion']
  const nameLower = model.name.toLowerCase()
  if (nameLower.includes('code') || nameLower.includes('coder')) {
    capabilities.push('code', 'code-completion')
  }

  // Build description from model details
  const family = model.details?.family || ''
  const quantization = model.details?.quantization_level || ''

  let description = `${family} ${parameterSize}`.trim()
  if (quantization) {
    description += ` (${quantization})`
  }
  if (!description) {
    description = `Ollama model (${sizeGB}GB)`
  }

  // Estimate context length (default to 4096 for older models)
  let contextLength = 4096
  if (nameLower.includes('llama3')) {
    contextLength = 8192
  } else if (nameLower.includes('mistral')) {
    contextLength = 8192
  } else if (nameLower.includes('qwen')) {
    contextLength = 32768
  }

  return {
    id: model.name,
    name: model.name,
    displayName,
    size: `${sizeGB}GB`,
    sizeBytes: model.size,
    description,
    capabilities,
    contextLength,
    parameterSize
  }
}

export {
  isOllamaRunning,
  testOllamaModel,
  chatWithOllama,
  generateWithOllama
}