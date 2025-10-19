/**
 * LM Studio Integration Service for Main Process
 * Handles communication with LM Studio via OpenAI-compatible API
 */

import fetch from 'node-fetch'

const LM_STUDIO_BASE_URL = 'http://localhost:1234/v1'

interface LLMOptions {
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/**
 * Check if LM Studio is running
 */
async function isLMStudioRunning(): Promise<any> {
  try {
    const response = await fetch(`${LM_STUDIO_BASE_URL}/models`)
    return response.ok
  } catch (error) {
    console.log('[LMStudio] Service not running on localhost:1234')
    return false
  }
}

/**
 * Get available models from LM Studio
 */
async function getAvailableModels(): Promise<any> {
  try {
    const response = await fetch(`${LM_STUDIO_BASE_URL}/models`)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()
    return data.data || []
  } catch (error) {
    console.error('[LMStudio] Failed to get models:', error)
    return []
  }
}

/**
 * Chat with LM Studio using OpenAI-compatible API
 */
async function chatWithLMStudio(modelName: any, messages: any, options: LLMOptions = {}): Promise<any> {
  try {
    console.log(`[LMStudio] Chatting with ${modelName}, ${messages.length} messages`)

    // LM Studio uses OpenAI-compatible format
    const formattedMessages: any[] = messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content
    }))

    console.log(`[LMStudio] Sending ${formattedMessages.length} messages`)

    const requestBody = {
      model: modelName || 'default', // LM Studio will use the loaded model
      messages: formattedMessages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1000,
      stream: false
    }
    
    console.log('[LMStudio] Request body:', JSON.stringify(requestBody, null, 2))
    
    const response = await fetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LM Studio API error: ${response.status} - ${errorText}`)
    }
    
    const data = await response.json()
    console.log('[LMStudio] Response received:', data.choices?.[0]?.message?.content?.substring(0, 100) + '...')
    
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content
    }
    
    throw new Error('No response from LM Studio')
  } catch (error) {
    console.error('[LMStudio] Chat error:', error)
    throw error
  }
}

/**
 * Stream chat with LM Studio (returns an async generator)
 */
async function* streamChatWithLMStudio(modelName: any, messages: any, options: LLMOptions = {}) {
  try {
    console.log(`[LMStudio] Streaming chat with ${modelName}`)

    const formattedMessages: any[] = messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content
    }))

    const response = await fetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelName || 'default',
        messages: formattedMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 1000,
        stream: true
      })
    })
    
    if (!response.ok) {
      throw new Error(`LM Studio API error: ${response.status}`)
    }
    
    const reader = response.body
    let buffer = ''
    
    for await (const chunk of reader) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') {
            return
          }
          try {
            const parsed = JSON.parse(data)
            if (parsed.choices?.[0]?.delta?.content) {
              yield parsed.choices[0].delta.content
            }
          } catch (e: any) {
            console.error('[LMStudio] Failed to parse streaming data:', e)
          }
        }
      }
    }
  } catch (error) {
    console.error('[LMStudio] Stream error:', error)
    throw error
  }
}

export {
  isLMStudioRunning,
  getAvailableModels,
  chatWithLMStudio,
  streamChatWithLMStudio
}