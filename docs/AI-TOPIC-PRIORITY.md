# AI Topic Priority System

Implementation of priority-based queue management for AI topics in the LLM manager.

## Overview

AI topics can be assigned priorities (1-10, with 10 being highest) to control the order of LLM request processing. This works in conjunction with the parallel execution system to ensure important conversations get processed first.

## Architecture

### Priority Levels

```typescript
Priority 10 (Critical)    - Immediate processing
Priority 7 (Medium-High)  - Important topics
Priority 5 (Normal)       - Default priority
Priority 3 (Low)          - Background topics
Priority 1 (Minimal)      - Lowest priority
```

### Data Model

**MessageQueueEntry** (`types.ts`):
```typescript
interface MessageQueueEntry {
  topicId: string;
  text: string;
  senderId: SHA256IdHash<Person>;
  queuedAt: number;
  priority?: number;  // 1-10, higher = more urgent, default = 5
}
```

### AITopicManager

**Priority Tracking:**
```typescript
// Set priority for a topic (1-10, clamped)
setTopicPriority(topicId: string, priority: number): void

// Get priority for a topic (defaults to 5)
getTopicPriority(topicId: string): number
```

### AIMessageProcessor

**Priority Queue Processing:**

Messages are sorted by:
1. **Priority** (highest first): 10 → 9 → 8 → ... → 1
2. **Age** (oldest first for same priority): Earlier queued → Later queued

```typescript
const sortedMessages = [...pendingMessages].sort((a, b) => {
  const priorityA = a.priority || 5;
  const priorityB = b.priority || 5;

  // Higher priority comes first
  if (priorityA !== priorityB) {
    return priorityB - priorityA;
  }

  // Same priority: older message comes first
  return a.queuedAt - b.queuedAt;
});
```

## UI Components

### 1. ConversationCard Context Menu

**Location:** `lama.ui/src/components/journal/ConversationCard.tsx`

**Features:**
- Priority options only shown for AI topics (`isAITopic`)
- 5 priority levels with color coding
- Signal icon indicates priority level

**Usage:**
```typescript
<ConversationCard
  conversation={conv}
  onSetPriority={async (topicId, priority) => {
    await window.electronAPI.invoke('setTopicPriority', { topicId, priority })
  }}
  // ... other props
/>
```

### 2. TopicPrioritySettings Panel

**Location:** `lama.ui/src/components/settings/TopicPrioritySettings.tsx`

**Features:**
- Displays all AI topics with priority sliders
- Real-time updates with optimistic UI
- Color-coded badges and labels
- Auto-save on slider change
- Platform-agnostic with dependency injection

**Usage:**
```typescript
import { TopicPrioritySettings } from '@lama/ui'

<TopicPrioritySettings
  operations={{
    getAllTopicPriorities: () =>
      window.electronAPI.invoke('getAllTopicPriorities'),
    setTopicPriority: (topicId, priority) =>
      window.electronAPI.invoke('setTopicPriority', { topicId, priority })
  }}
/>
```

## IPC Handlers

**Location:** `lama.cube/main/ipc/plans/ai.ts`

**Endpoints:**
```typescript
// Set priority for a topic
setTopicPriority({ topicId, priority }): Promise<{ success: boolean }>

// Get priority for a topic
getTopicPriority({ topicId }): Promise<{ success: boolean, priority: number }>

// Get all topics with priorities
getAllTopicPriorities(): Promise<{
  success: boolean,
  priorities: Array<{
    topicId: string,
    priority: number,
    displayName: string
  }>
}>
```

## Integration with Parallel Execution

Priority works in conjunction with concurrency management:

### Scenario: Mixed Priority Requests

```
Local Ollama (1 slot available):
  - Topic A (priority 10) processing
  - Queue: [Topic B (priority 3), Topic C (priority 8)]

When A completes:
  → Topic C starts (priority 8 > 3)
  → Topic B remains queued
```

### Scenario: Remote API (Unlimited)

```
Claude API:
  - Topic X (priority 10) → Starts immediately
  - Topic Y (priority 5) → Starts immediately
  - Topic Z (priority 1) → Starts immediately

All run in parallel, priority doesn't matter for remote APIs
(unless system-wide rate limiting is added in future)
```

## Use Cases

### 1. User Interaction Priority

```
User actively chatting with Topic "Work" → Set priority 10
Background analysis in Topic "Research" → Set priority 3

Result: User's active conversation always processes first
```

### 2. Time-Sensitive Topics

```
Topic "Urgent Support" → Priority 10
Topic "Casual Chat" → Priority 5
Topic "Archive Processing" → Priority 1

Result: Urgent topics jump the queue when resources limited
```

### 3. Resource-Constrained Environments

```
Local Ollama with 3 active topics:
  - "Customer Support" (priority 10)
  - "Internal Q&A" (priority 7)
  - "Testing" (priority 3)

Processing order: Support → Q&A → Testing
```

## Priority Configuration Best Practices

### Recommended Priorities

| Use Case | Priority | Rationale |
|----------|----------|-----------|
| Active user conversation | 10 | Immediate response needed |
| Important automated tasks | 8 | High priority, but not user-facing |
| Standard conversations | 5 | Default balanced priority |
| Background analysis | 3 | Can wait for resources |
| Batch processing | 1 | Lowest priority |

### Default Behavior

- **New topics**: Priority 5 (Normal)
- **Unset priority**: Defaults to 5
- **Clamping**: Values automatically clamped to 1-10 range

## Implementation Files

**lama.core:**
- `models/ai/types.ts` - MessageQueueEntry with priority field
- `models/ai/AITopicManager.ts` - Priority tracking methods
- `models/ai/AIMessageProcessor.ts` - Priority-based queue sorting

**lama.ui:**
- `components/journal/ConversationCard.tsx` - Context menu with priority options
- `components/settings/TopicPrioritySettings.tsx` - Priority settings panel
- `components/ui/slider.tsx` - Slider component for priority selection

**lama.cube:**
- `main/ipc/plans/ai.ts` - Priority IPC handlers

## Related Documentation

- [Parallel LLM Execution](./PARALLEL-LLM-EXECUTION.md) - Parallel execution system
- [Message Queue System](./MESSAGE-QUEUE.md) - Message queuing architecture

## Date

Implemented: 2025-11-17
