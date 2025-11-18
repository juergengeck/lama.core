# Parallel LLM Execution System

Implementation of intelligent parallel execution for LLM requests based on resource constraints.

## Overview

The system allows:
1. **Remote APIs** (Claude, OpenAI) to run in parallel (unlimited concurrency)
2. **Remote servers** (remote Ollama/LM Studio) to run in parallel (unlimited concurrency)
3. **Local servers** (local Ollama/LM Studio) to have limited concurrency (1 per instance)

This ensures remote API calls never wait for local resources, while protecting local servers from overload.

## Architecture

### Resource Classification

Three resource types for intelligent concurrency management:

```typescript
enum LLMResourceType {
  REMOTE_API = 'remote-api',        // Claude, OpenAI - unlimited parallel
  REMOTE_SERVER = 'remote-server',  // Remote Ollama/LM Studio - unlimited parallel
  LOCAL_SERVER = 'local-server'     // Local Ollama/LM Studio - limited to 1 concurrent
}
```

### Concurrency Configuration

```typescript
interface LLMConcurrencyConfig {
  resourceType: LLMResourceType;
  concurrencyGroupId: string;        // Unique per instance
  maxConcurrent: number | null;      // null = unlimited
  provider: string;
  baseUrl?: string;
}
```

## Components

### 1. LLMConcurrencyManager (`llm-concurrency-manager.ts`)

Core concurrency control system with intelligent slot management.

**Key Features:**
- **Automatic Resource Detection**: Infers concurrency config from modelId and provider
- **Priority Queue**: Requests queued by priority (high→low), then age (old→new)
- **Concurrency Groups**: Each local instance gets its own group with limit of 1
- **Smart Slot Allocation**:
  - Remote APIs: Immediate grant (unlimited)
  - Remote servers: Immediate grant (server handles its own limits)
  - Local servers: Queue if busy, process when slot available

**Methods:**
```typescript
acquireSlot(modelId, topicId, priority): Promise<string>
releaseSlot(requestId): void
getStats(): { activeByGroup, pendingByGroup, totalActive, totalPending }
canRunImmediately(modelId): boolean
```

### 2. LLM Manager Integration (`llm-manager.ts`)

**Concurrency wrapping in chat() method:**

```typescript
// Acquire slot (waits if local resource busy)
const requestId = await this.concurrencyManager.acquireSlot(
  effectiveModelId,
  topicId,
  topicPriority
);

try {
  // Execute LLM call
  response = await this.chatWith[Provider](...)
} finally {
  // Always release slot
  this.concurrencyManager.releaseSlot(requestId);
}
```

**New Methods:**
- `getConcurrencyStats()` - Monitor active/pending requests
- `canModelRunImmediately(modelId)` - Check availability

### 3. AIMessageProcessor Integration (`AIMessageProcessor.ts`)

**Passes priority to LLM manager:**

```typescript
// Get topic priority for concurrency management
const topicPriority = this.topicManager.getTopicPriority(topicId);

// Pass to LLM manager
await chatInterface.chatWithAnalysis(history, modelId, {
  topicId,
  priority: topicPriority,  // Used for queue ordering
  // ... other options
});
```

## Resource Type Detection

Automatic detection based on provider and URL:

| Provider | Base URL Contains | Classification | Max Concurrent |
|----------|------------------|----------------|----------------|
| `anthropic` | N/A | REMOTE_API | Unlimited |
| `openai` | N/A | REMOTE_API | Unlimited |
| `ollama` | `localhost` / `127.0.0.1` | LOCAL_SERVER | 1 |
| `ollama` | Other URLs | REMOTE_SERVER | Unlimited |
| `lmstudio` | `localhost` / `127.0.0.1` | LOCAL_SERVER | 1 |
| `lmstudio` | Other URLs | REMOTE_SERVER | Unlimited |

## Concurrency Groups

Each resource gets a unique concurrency group ID:

```
remote-api-anthropic                       → All Claude models (unlimited)
remote-api-openai                          → All OpenAI models (unlimited)
local-ollama-http://localhost:11434        → Local Ollama (max 1)
remote-ollama-http://server.com:11434      → Remote Ollama (unlimited)
local-lmstudio-http://localhost:1234       → Local LM Studio (max 1)
```

## Execution Scenarios

### Scenario 1: Multiple Remote API Requests

```
Topic A (priority 10) + Claude → ✅ Immediate execution
Topic B (priority 5) + OpenAI → ✅ Immediate execution
Topic C (priority 8) + Claude → ✅ Immediate execution

Result: All run in parallel - no waiting
```

### Scenario 2: Multiple Local Ollama Requests

```
Topic A (priority 10) + local Ollama → ✅ Immediate execution
Topic B (priority 8) + local Ollama → ⏳ Queued (slot busy)
Topic C (priority 5) + local Ollama → ⏳ Queued (slot busy)

When A completes:
  → B starts (higher priority than C)
When B completes:
  → C starts
```

### Scenario 3: Mixed Resource Types

```
Topic A (priority 5) + local Ollama  → ✅ Immediate (local slot available)
Topic B (priority 10) + Claude        → ✅ Immediate (remote API, unlimited)
Topic C (priority 3) + local Ollama   → ⏳ Queued (local slot busy with A)
Topic D (priority 7) + remote Ollama  → ✅ Immediate (remote server, unlimited)

Result: B, A, and D run in parallel. C waits for A to complete.
```

## Priority + Concurrency Integration

The system uses **BOTH** priority and concurrency:

1. **Topic Priority** (1-10): Determines queue order when resources busy
2. **Resource Type**: Determines if queuing is needed
3. **Result**: High-priority topics jump the queue when slots free up

**Example:**
```
Local Ollama processing Topic X (priority 5)
Queue: [Topic Y (priority 3), Topic Z (priority 8)]

When X completes:
  → Z processes next (priority 8 > 3)
  → Y waits
```

## Monitoring & Debugging

### Get Concurrency Stats

```typescript
const stats = llmManager.getConcurrencyStats();
console.log(stats);
// {
//   activeByGroup: {
//     'local-ollama-http://localhost:11434': 1,
//     'remote-api-anthropic': 3
//   },
//   pendingByGroup: {
//     'local-ollama-http://localhost:11434': 2
//   },
//   totalActive: 4,
//   totalPending: 2
// }
```

### Check Immediate Availability

```typescript
if (llmManager.canModelRunImmediately('gpt-oss:20b')) {
  // Will execute immediately
} else {
  // Will queue and wait
}
```

## Benefits

✅ **Remote APIs run in parallel** - No artificial queuing for Claude/OpenAI
✅ **Local resources protected** - Prevents overloading local Ollama/LM Studio
✅ **Priority respected** - High-priority topics process first when slots available
✅ **Automatic detection** - No manual configuration needed
✅ **Fair queuing** - FIFO within same priority level
✅ **Zero blocking for remote** - Remote requests never wait for local resources

## Implementation Files

**lama.core:**
- `models/ai/types.ts` - LLMResourceType enum and LLMConcurrencyConfig interface
- `services/llm-concurrency-manager.ts` - Concurrency control system
- `services/llm-manager.ts` - Concurrency integration and stats methods
- `models/ai/AIMessageProcessor.ts` - Priority passing to LLM manager

## Related Documentation

- [AI Topic Priority System](./AI-TOPIC-PRIORITY.md) - Topic priority configuration
- [LLM Manager Architecture](./LLM-MANAGER.md) - LLM manager design
- [Message Queue System](./MESSAGE-QUEUE.md) - Message queuing and processing

## Date

Implemented: 2025-11-17
