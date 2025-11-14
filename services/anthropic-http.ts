/**
 * Browser-compatible Anthropic API client using fetch()
 * No Node.js SDK dependencies - pure HTTP implementation
 *
 * CORS Support: Anthropic enables CORS with 'anthropic-dangerous-direct-browser-access' header
 * See: https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/
 */

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicChatOptions {
  apiKey: string;
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens?: number;
  temperature?: number;
  tools?: any[];
  onStream?: (chunk: string) => void;
  signal?: AbortSignal;
  proxyUrl?: string; // Optional proxy (not needed with CORS header)
}

/**
 * Chat with Anthropic API using fetch() - works in browser and Node.js
 */
export async function chatWithAnthropicHTTP(options: AnthropicChatOptions): Promise<string> {
  const {
    apiKey,
    model,
    messages,
    system,
    max_tokens = 4096,
    temperature = 0.7,
    tools,
    onStream,
    signal
  } = options;

  const requestBody: any = {
    model,
    max_tokens,
    temperature,
    messages: messages.map(m => ({ role: m.role, content: m.content }))
  };

  if (system) {
    requestBody.system = system;
  }

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  // Streaming vs non-streaming
  if (onStream) {
    requestBody.stream = true;
  }

  // Use proxy if provided (for browser CORS), otherwise direct API call
  const apiUrl = options.proxyUrl
    ? `${options.proxyUrl}/https://api.anthropic.com/v1/messages`
    : 'https://api.anthropic.com/v1/messages';

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true' // Enable CORS support
    },
    body: JSON.stringify(requestBody),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  // Non-streaming response
  if (!onStream) {
    const data = await response.json();

    // Extract text content from content blocks
    if (data.content && Array.isArray(data.content)) {
      const textBlocks = data.content.filter((block: any) => block.type === 'text');
      return textBlocks.map((block: any) => block.text).join('');
    }

    throw new Error('Unexpected response format from Anthropic API');
  }

  // Streaming response
  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue;

        const data = line.slice(6); // Remove 'data: ' prefix

        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);

          // Handle content_block_delta events
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const chunk = event.delta.text;
            fullResponse += chunk;
            onStream(chunk);
          }
        } catch (e) {
          // Ignore JSON parse errors for incomplete chunks
          console.warn('[AnthropicHTTP] Failed to parse event:', data.substring(0, 100));
        }
      }
    }

    return fullResponse;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Test an Anthropic API key
 */
export async function testAnthropicApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true' // Enable CORS support
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      })
    });

    return response.ok;
  } catch (error) {
    console.error('[AnthropicHTTP] API key test failed:', error);
    return false;
  }
}
