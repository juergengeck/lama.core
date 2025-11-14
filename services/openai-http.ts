/**
 * Browser-compatible OpenAI API client using fetch()
 * No Node.js SDK dependencies - pure HTTP implementation
 */

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatOptions {
  apiKey: string;
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  tools?: any[];
  onStream?: (chunk: string) => void;
  signal?: AbortSignal;
  proxyUrl?: string; // Optional CORS proxy for browser use
}

/**
 * Chat with OpenAI API using fetch() - works in browser and Node.js
 */
export async function chatWithOpenAIHTTP(options: OpenAIChatOptions): Promise<string> {
  const {
    apiKey,
    model,
    messages,
    temperature = 0.7,
    max_tokens = 4096,
    tools,
    onStream,
    signal
  } = options;

  const requestBody: any = {
    model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature,
    max_tokens
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  // Streaming vs non-streaming
  if (onStream) {
    requestBody.stream = true;
  }

  // Use proxy if provided (for browser CORS), otherwise direct API call
  const apiUrl = options.proxyUrl
    ? `${options.proxyUrl}/https://api.openai.com/v1/chat/completions`
    : 'https://api.openai.com/v1/chat/completions';

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  // Non-streaming response
  if (!onStream) {
    const data = await response.json();

    if (data.choices && data.choices.length > 0) {
      const message = data.choices[0].message;
      return message.content || '';
    }

    throw new Error('Unexpected response format from OpenAI API');
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

          // Handle delta events
          if (event.choices && event.choices.length > 0) {
            const delta = event.choices[0].delta;
            if (delta && delta.content) {
              const chunk = delta.content;
              fullResponse += chunk;
              onStream(chunk);
            }
          }
        } catch (e) {
          // Ignore JSON parse errors for incomplete chunks
          console.warn('[OpenAIHTTP] Failed to parse event:', data.substring(0, 100));
        }
      }
    }

    return fullResponse;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Test an OpenAI API key
 */
export async function testOpenAIApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    return response.ok;
  } catch (error) {
    console.error('[OpenAIHTTP] API key test failed:', error);
    return false;
  }
}
