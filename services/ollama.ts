/**
 * Ollama Integration Service (Platform-Agnostic)
 * Handles communication with local Ollama instance
 * Works in both Node.js and browser environments using native fetch
 */

// Use native fetch (Node.js 18+ and all browsers)
// No imports needed - fetch and AbortController are global

// Track active requests with AbortControllers
// Map: requestId -> { controller, topicId }
const activeRequests = new Map()

// Map topicId to requestIds for quick lookup
const topicToRequests = new Map()

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
  for (const [id, data] of activeRequests) {
    try {
      data.controller.abort()
      console.log(`[Ollama] Cancelled request ${id}`)
    } catch (error) {
      console.error(`[Ollama] Error cancelling request ${id}:`, error)
    }
  }
  activeRequests.clear()
  topicToRequests.clear()
}

/**
 * Cancel streaming for a specific topic
 */
export function cancelStreamingForTopic(topicId: string): boolean {
  console.log(`[Ollama] Cancelling streaming for topic: ${topicId}`)
  const requestIds = topicToRequests.get(topicId)

  if (!requestIds || requestIds.size === 0) {
    console.log(`[Ollama] No active requests found for topic: ${topicId}`)
    return false
  }

  let cancelled = false
  for (const requestId of requestIds) {
    const data = activeRequests.get(requestId)
    if (data) {
      try {
        data.controller.abort()
        console.log(`[Ollama] Cancelled request ${requestId} for topic ${topicId}`)
        activeRequests.delete(requestId)
        cancelled = true
      } catch (error) {
        console.error(`[Ollama] Error cancelling request ${requestId}:`, error)
      }
    }
  }

  topicToRequests.delete(topicId)
  return cancelled
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
  const topicId = options.topicId // Extract topicId from options if provided

  // Track this request with its controller and topicId
  activeRequests.set(requestId, { controller, topicId })

  // Track by topicId for quick cancellation
  if (topicId) {
    if (!topicToRequests.has(topicId)) {
      topicToRequests.set(topicId, new Set())
    }
    topicToRequests.get(topicId).add(requestId)
  }

  console.log(`[Ollama] Starting request ${requestId} to ${baseUrl}${topicId ? ` (topic: ${topicId})` : ''}`)

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
      keep_alive: -1,  // Keep model loaded indefinitely (prevents 15-20s reload delays)
      options: {
        temperature: options.temperature || 0.7,
        num_predict: options.max_tokens || 4096,  // Increased default for longer responses
        top_k: 40,
        top_p: 0.95
      }
    };

    // Add context for conversation continuation (KV cache reuse)
    if (options.context && Array.isArray(options.context)) {
      requestBody.context = options.context;
      console.log(`[Ollama-${requestId}] 🔄 Reusing cached context (${options.context.length} tokens) - skipping reprocessing`);
    }

    // DEBUG: Log the actual num_predict value being sent
    console.log(`[Ollama-${requestId}] 🔧 Request config: model=${modelName}, num_predict=${requestBody.options.num_predict}, max_tokens=${options.max_tokens}, messages=${formattedMessages.length}`);

    // Add format parameter for structured outputs (Ollama native)
    if (options.format) {
      requestBody.format = options.format;
      console.log('[Ollama] ========== OLLAMA STRUCTURED OUTPUT ==========');
      console.log('[Ollama] Using structured output format (JSON schema)');
      console.log('[Ollama] Stream disabled for structured output');
      console.log('[Ollama] Format schema:', JSON.stringify(options.format, null, 2));
      console.log('[Ollama] ==============================================');
    }

    const requestBodyStr = JSON.stringify(requestBody);
    console.log(`[Ollama-${requestId}] ⏱️  T+${Date.now() - t0}ms: Sending fetch to ${baseUrl}/api/chat`)
    console.log(`[Ollama-${requestId}] 📦 Request size: ${requestBodyStr.length} bytes, ${formattedMessages.length} messages`)
    console.log(`[Ollama-${requestId}] 📝 Request preview: ${requestBodyStr.substring(0, 500)}...`)

    const response: any = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: requestBodyStr
    })

    console.log(`[Ollama-${requestId}] ⏱️  T+${Date.now() - t0}ms: Response received (status: ${response.status})`)

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`)
    }

    // Non-streaming response (for structured outputs)
    if (!useStreaming) {
      const json = await response.json()

      // Debug: Log the full response structure
      console.log('[Ollama] ========== NON-STREAMING RESPONSE STRUCTURE ==========');
      console.log('[Ollama] Response keys:', Object.keys(json));
      console.log('[Ollama] Full response:', JSON.stringify(json, null, 2).substring(0, 1000));
      console.log('[Ollama] =======================================================');

      // Handle different response formats
      let content = json.message?.content || json.response || json.thinking || ''
      console.log(`[Ollama] Extracted content length: ${content.length}`)
      console.log(`[Ollama] Non-streaming response preview: ${content.substring(0, 200)}...`)

      if (!content) {
        console.error('[Ollama] No content found! Response structure:', JSON.stringify(json, null, 2));
        throw new Error('Ollama generated no response - check response structure above')
      }
      return content
    }

    // Process streaming response using ReadableStream (web standard)
    let fullResponse = ''
    let fullThinking = '' // Separate accumulation for thinking (reasoning models)
    let contextArray: number[] | undefined = undefined // Ollama context for caching
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

            // Extract context array for caching (if present)
            if (json.context && Array.isArray(json.context)) {
              contextArray = json.context
            }

            // Handle different response formats:
            // 1. Regular models: json.message.content
            // 2. Reasoning models: json.message.thinking (store separately, NEVER show)
            // 3. Alternative formats: json.response, json.message (if string), json.text
            let content = ''
            let thinking = ''

            // Extract content (what we show to user)
            if (json.message && typeof json.message === 'object' && json.message.content) {
              content = json.message.content
            } else if (json.message && typeof json.message === 'string') {
              // Sometimes message is directly a string
              content = json.message
            } else if (json.response) {
              // Some models use 'response' field
              content = json.response
            } else if (json.text) {
              // Some models use 'text' field
              content = json.text
            }

            // Extract thinking separately (reasoning models like gpt-oss, deepseek-r1)
            // CRITICAL: Never use thinking as content - it's internal reasoning
            if (json.message && json.message.thinking) {
              thinking = json.message.thinking
            } else if (json.thinking) {
              thinking = json.thinking
            }

            // Accumulate content for display
            if (content) {
              fullResponse += content

              // Stream to callback if provided (ONLY stream content, not thinking)
              if ((options as any).onStream) {
                ;(options as any).onStream(content, false)
              }
            }

            // Accumulate thinking separately and stream it via separate callback
            if (thinking) {
              fullThinking += thinking

              // Stream thinking to separate callback if provided
              if ((options as any).onThinkingStream) {
                ;(options as any).onThinkingStream(thinking)
              }
            }

            if (!content && !thinking && !json.done) {
              // Log details for debugging but don't crash
              // (Skip final completion messages with done: true)
              console.warn('[Ollama] No content/thinking extracted from JSON. Keys:', Object.keys(json))
              if (json.message) {
                console.warn('[Ollama] message type:', typeof json.message, 'message keys:', Object.keys(json.message || {}))
              }
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

        // Extract context from final chunk
        if (json.context && Array.isArray(json.context)) {
          contextArray = json.context
        }

        let content = ''
        let thinking = ''

        // Extract content
        if (json.message && json.message.content) {
          content = json.message.content
        }

        // Extract thinking separately (NEVER use as content)
        if (json.message && json.message.thinking) {
          thinking = json.message.thinking
        } else if (json.thinking) {
          thinking = json.thinking
        }

        // Accumulate content
        if (content) {
          fullResponse += content
          if ((options as any).onStream) {
            (options as any).onStream(content, false)
          }
        }

        // Accumulate thinking and stream it separately
        if (thinking) {
          fullThinking += thinking

          // Stream thinking to separate callback if provided
          if ((options as any).onThinkingStream) {
            (options as any).onThinkingStream(thinking)
          }
        }
      } catch (e: any) {
        console.error('[Ollama] Error parsing final JSON:', e.message)
      }
    }
    
    const responseTime = Date.now() - startTime
    console.log(`[Ollama] ⏱️ Full response completed in ${responseTime}ms`)

    // Check if we got EITHER response OR thinking
    const hasResponse = fullResponse && fullResponse !== '';
    const hasThinking = fullThinking && fullThinking !== '';

    if (!hasResponse && !hasThinking) {
      // Completely empty - this is an actual error
      throw new Error('Ollama generated no response - model may not support structured output or failed to generate')
    }

    {
      console.log('[Ollama] ========== OLLAMA RESPONSE TRACE ==========')
      if (hasResponse) {
        console.log('[Ollama] Full response length:', fullResponse.length)
        console.log('[Ollama] Full response (first 500 chars):', fullResponse.substring(0, 500))
        console.log('[Ollama] Full response (last 200 chars):', fullResponse.substring(Math.max(0, fullResponse.length - 200)))
      } else {
        console.log('[Ollama] No response content (thinking-only model)')
      }
      if (hasThinking) {
        console.log('[Ollama] Thinking captured (length):', fullThinking.length)
        console.log('[Ollama] Thinking (first 200 chars):', fullThinking.substring(0, 200))
      }
      console.log('[Ollama] ===========================================')
    }

    // Clean up request tracking
    activeRequests.delete(requestId)
    if (topicId) {
      const requestSet = topicToRequests.get(topicId)
      if (requestSet) {
        requestSet.delete(requestId)
        if (requestSet.size === 0) {
          topicToRequests.delete(topicId)
        }
      }
    }
    console.log(`[Ollama] Completed request ${requestId}`)

    // Return structured response with thinking and context as metadata
    // If there's thinking or context, return object; otherwise return string for backwards compat
    if (fullThinking || contextArray) {
      return {
        content: fullResponse,
        thinking: fullThinking || undefined,
        context: contextArray,
        _hasThinking: !!fullThinking,
        _hasContext: !!contextArray
      }
    }
    return fullResponse
  } catch (error) {
    console.error(`[Ollama] Chat error for request ${requestId}:`, error)
    
    // Clean up on error
    activeRequests.delete(requestId)
    if (topicId) {
      const requestSet = topicToRequests.get(topicId)
      if (requestSet) {
        requestSet.delete(requestId)
        if (requestSet.size === 0) {
          topicToRequests.delete(topicId)
        }
      }
    }

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