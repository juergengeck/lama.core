/**
 * Ollama Integration Service for Main Process
 * Handles communication with local Ollama instance
 */

import fetch from 'node-fetch'
// AbortController is built into Node.js since v15.0.0, no import needed

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
    // Keep conversation structure for better context
    const systemMessages = messages.filter((msg: any) => msg.role === 'system')
    const nonSystemMessages = messages.filter((msg: any) => msg.role !== 'system')
    const recentNonSystemMessages = nonSystemMessages.slice(-10) // Keep more context
    const formattedMessages = [...systemMessages, ...recentNonSystemMessages]

    const startTime = Date.now()

    // Prepare headers with auth if provided
    const headers = {
      'Content-Type': 'application/json',
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
        num_predict: options.max_tokens || 2048,
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

    const response: any = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    })
    
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

    // Process streaming response - node-fetch v2 compatibility
    let fullResponse = ''
    let firstChunkTime = null
    let buffer = ''

    // For node-fetch v2, we need to handle the stream differently
    response.body.on('data', (chunk: any) => {
      if (!firstChunkTime) {
        firstChunkTime = Date.now()
      }

      buffer += chunk.toString()
      const lines = buffer.split('\n')

      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const json = JSON.parse(line)
          // Handle different response formats:
          // 1. Regular models: json.message.content
          // 2. Reasoning models (gpt-oss, deepseek-r1): json.thinking
          let content = ''

          if (json.message && json.message.content) {
            content = json.message.content
          } else if (json.thinking) {
            // Reasoning models use 'thinking' field
            content = json.thinking
          }

          if (content) {
            fullResponse += content

            // Stream to callback if provided
            if ((options as any).onStream) {
              (options as any).onStream(content, false)
            }
          }
        } catch (e: any) {
          console.error('[Ollama] Error parsing JSON line:', e.message, 'Line:', line)
        }
      }
    })

    // Wait for the stream to finish
    await new Promise((resolve, reject) => {
      response.body.on('end', resolve)
      response.body.on('error', reject)
    })

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

export {
  isOllamaRunning,
  testOllamaModel,
  chatWithOllama,
  generateWithOllama
}