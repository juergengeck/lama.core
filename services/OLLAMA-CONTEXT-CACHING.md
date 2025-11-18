# Ollama Context Caching Implementation

## Overview

This implementation leverages Ollama's KV (Key-Value) cache to dramatically improve performance for analytics and conversation continuation. By caching the conversation state after each LLM response, we can:

- **Reuse context across messages** in the same topic/conversation
- **Run analytics queries 3-12x faster** by avoiding reprocessing
- **Maintain conversation state** across multiple requests efficiently

## Architecture: Two-Phase Streaming + Caching

```
┌─────────────────────────────────────────────────────────┐
│  PHASE 1: User-Facing Response (STREAMING ENABLED)      │
│  User Message (topicId: "abc123")                       │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  LLMManager.chat() - STREAMING                           │
│  • Retrieves cached context for topicId                 │
│  • Sends to Ollama with context + streaming=true        │
│  • Streams response to user in real-time ✅              │
│  • Extracts context from final chunk                    │
│  • Caches context for topicId                           │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  PHASE 2: Analytics (USES CACHED CONTEXT)               │
│  • TopicAnalyzer.analyzeMessages(topicId, messages)     │
│  • Detects cached context available                     │
│  • Uses LLMManager.analyzeWithCache() for:              │
│    - Keyword extraction (3-12x faster)                  │
│    - Summary generation (3-12x faster)                  │
│    - Subject identification (3-12x faster)              │
│  • No reprocessing of conversation history!             │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Next Message in Same Topic (STREAMING)                 │
│  • Reuses cached context (no reprocessing!)             │
│  • Ollama uses KV cache for instant inference           │
│  • Streams response to user ✅                           │
│  • Updates cached context                               │
└─────────────────────────────────────────────────────────┘
```

### Key Benefits of Two-Phase Approach

**Phase 1 (User-Facing)**:
- ✅ Streaming enabled for real-time UX
- ✅ Uses cached context for faster response
- ✅ Caches updated context for Phase 2

**Phase 2 (Analytics)**:
- ✅ Runs in background using cached context
- ✅ 3-12x faster than replaying conversation
- ✅ No impact on user-facing response time

## Key Changes

### 1. ollama.ts - Context Extraction & Reuse

**Context Extraction:**
```typescript
// Extract context array from streaming response chunks
if (json.context && Array.isArray(json.context)) {
  contextArray = json.context
}

// Return with metadata
return {
  content: fullResponse,
  thinking: fullThinking || undefined,
  context: contextArray,  // ← NEW: Context for caching
  _hasContext: !!contextArray
}
```

**Context Reuse:**
```typescript
// Add context to request body for conversation continuation
if (options.context && Array.isArray(options.context)) {
  requestBody.context = options.context;
  console.log(`🔄 Reusing cached context (${options.context.length} tokens)`);
}
```

### 2. llm-manager.ts - Context Cache Management

**Cache Storage:**
```typescript
// Map: topicId → context array (KV cache state)
private ollamaContextCache: Map<string, number[]>;
```

**Automatic Caching:**
```typescript
// After each Ollama response, cache the context
if (options.topicId && typeof response === 'object' && '_hasContext' in response) {
  const contextArray = response.context;
  if (contextArray) {
    this.ollamaContextCache.set(options.topicId, contextArray);
    console.log(`💾 Cached context for topic ${options.topicId}`);
  }
}
```

**Analytics Method:**
```typescript
async analyzeWithCache(topicId: string, prompt: string, modelId: string): Promise<string> {
  const cachedContext = this.ollamaContextCache.get(topicId);

  // Reuse cached KV state - no reprocessing!
  return await chatWithOllama(modelName, [{ role: 'user', content: prompt }], {
    context: cachedContext,
    temperature: 0.3  // Lower for deterministic analytics
  });
}
```

### 3. TopicAnalyzer - Use Cached Context

**Keyword Extraction:**
```typescript
async extractKeywords(text: any, maxKeywords = 10, existingKeywords = [], topicId?: string) {
  const hasCache = topicId && this.llmManager.getCachedContext?.(topicId);

  if (hasCache) {
    // Use cached context - 3-12x faster!
    const models = await this.llmManager.getAllModels();
    const defaultModel = models.find(m => m.provider === 'ollama') || models[0];
    response = await this.llmManager.analyzeWithCache(topicId, prompt, defaultModel.modelId);
  } else {
    // Fallback to full history
    response = await this.llmManager.chat({ messages: [{ role: 'user', content: prompt }] });
  }
}
```

**Summary Generation:**
```typescript
async generateSummary(topicId: any, subjects: any, messages: any) {
  const hasCache = topicId && this.llmManager.getCachedContext?.(topicId);

  if (hasCache) {
    // Reuse cached conversation state
    response = await this.llmManager.analyzeWithCache(topicId, prompt, defaultModel.modelId);
  }
}
```

## Usage

### Regular Chat (Automatic Context Caching)

```typescript
// First message in topic - builds initial cache
await llmManager.chat(messages, modelId, {
  topicId: 'topic-123',
  onStream: (chunk) => console.log(chunk)
});

// Second message - reuses cached context (instant!)
await llmManager.chat(newMessages, modelId, {
  topicId: 'topic-123',  // Same topicId = cached context reused
  onStream: (chunk) => console.log(chunk)
});
```

### Analytics with Cached Context

```typescript
// Run keyword extraction on cached conversation
const keywords = await llmManager.analyzeWithCache(
  'topic-123',
  'Extract the 5 most important keywords from this conversation',
  'llama3.2:latest'
);

// Run multiple analytics queries on same cached state
const summary = await llmManager.analyzeWithCache(
  'topic-123',
  'Summarize the main points of this conversation in 2 sentences',
  'llama3.2:latest'
);

const sentiment = await llmManager.analyzeWithCache(
  'topic-123',
  'What is the overall sentiment of this conversation?',
  'llama3.2:latest'
);
```

### Cache Management

```typescript
// Check if context is cached
const hasCache = llmManager.getCachedContext('topic-123');

// Clear cache for a topic
llmManager.clearCachedContext('topic-123');

// Clear all cached contexts
llmManager.clearAllCachedContexts();
```

## Performance Benefits

Based on research (markaicode.com/ollama-caching-strategies):

- **First message**: Normal processing time (e.g., 15-30s)
- **Subsequent messages with cache**: 3-12x faster (under 3s)
- **Analytics queries**: Near-instant (context already in KV cache)
- **Memory usage**: Minimal (context array is just token IDs)

## How Ollama Caching Works

1. **KV Cache**: Stores precomputed attention vectors for previous tokens
2. **Context Array**: Encodes the conversation state as token IDs
3. **Context Reuse**: When provided, Ollama skips reprocessing those tokens
4. **Keep Alive**: Model stays loaded in memory (set to `-1` for indefinite)

## When Context is Used

### Phase 1: User-Facing Chat (ALWAYS STREAMING)

**Streaming is now enabled by default** because:
- Context caching eliminates the need to wait for full response
- Users get real-time feedback (better UX)
- Context is extracted from streaming chunks automatically

```typescript
// Phase 1: Stream response to user
await llmManager.chat(messages, modelId, {
  topicId: 'abc123',
  onStream: (chunk) => displayToUser(chunk),  // ✅ Streaming enabled
  // Context cached automatically from streaming response
});
```

### Phase 2: Background Analytics (USES CACHED CONTEXT)

**After Phase 1 completes**, analytics run using cached context:

```typescript
// Phase 2: Fast analytics with cached context
const keywords = await topicAnalyzer.analyzeMessages(
  'abc123',
  messages  // Uses cached context automatically
);
// 3-12x faster than replaying full conversation!
```

**Automatic context caching occurs when:**
- `topicId` is provided in chat options
- Ollama returns a context array in the response
- Context is automatically stored in `ollamaContextCache`

**Cached context is reused when:**
- Same `topicId` is used in subsequent chat calls (Phase 1)
- `analyzeWithCache()` is called with a topic that has cached context (Phase 2)
- TopicAnalyzer detects cached context and uses it automatically

## Limitations

1. **Ollama Only**: Context caching only works with Ollama provider
2. **Topic Scope**: Context is per-topic, not shared across topics
3. **Model Consistency**: Context from one model may not work with another
4. **Memory**: Contexts are stored in memory (cleared on app restart)

## Future Enhancements

- Persist context to disk for long-term conversations
- Automatic cache expiration based on time or topic activity
- Context compression for very long conversations
- Cross-model context compatibility research

## Debug Logging

Watch for these log messages:

```
[Ollama-xyz] 🔄 Reusing cached context (1234 tokens) - skipping reprocessing
[LLMManager] 💾 Cached context for topic abc123 (1234 tokens)
[TopicAnalyzer] 🔄 Using cached context for keyword extraction
[TopicAnalyzer] 🔄 Using cached context for summary generation
```

## Testing

To test the caching implementation:

```typescript
// 1. Send first message (builds cache)
const response1 = await chat(messages, modelId, { topicId: 'test-123' });

// 2. Check cache was created
console.log('Has cache:', !!llmManager.getCachedContext('test-123'));

// 3. Send second message (should be much faster)
const t0 = Date.now();
const response2 = await chat(newMessages, modelId, { topicId: 'test-123' });
console.log('Time with cache:', Date.now() - t0);

// 4. Run analytics (should be near-instant)
const keywords = await llmManager.analyzeWithCache(
  'test-123',
  'Extract keywords',
  modelId
);
```

## References

- Ollama API Documentation: https://github.com/ollama/ollama/blob/main/docs/api.md
- Ollama Caching Strategies: https://markaicode.com/ollama-caching-strategies-improve-repeat-query-performance/
- Ollama KV Cache Issue: https://github.com/ollama/ollama/issues/8577
