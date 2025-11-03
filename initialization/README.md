# Core Initialization Pattern

## Problem

Initialization order was scattered across platforms with no enforcement:
- lama.browser manually orchestrated init() calls
- lama.cube manually orchestrated init() calls
- ChatHandler depended on LLM cache being populated before channelManager processes messages
- Easy to break, fragile, no fail-fast guarantees

## Solution

**CoreInitializer** enforces correct initialization order in one place.

### Flow

```
connection.core → lama.core → chat.core
     ↓              ↓            ↓
  Models        AI/LLM      Chat handlers
```

### Order Enforced

1. **LeuteModel** - Contacts/identities foundation
2. **LLM Infrastructure** - llmManager, aiAssistantModel (populates cache)
3. **ChannelManager** - NOW safe to process existing messages
4. **TopicModel** - Conversations
5. **ConnectionsModel** - P2P/federation
6. **Chat Handlers** - Business logic

### Critical Dependencies

- LLM cache **MUST** be populated before `channelManager.init()`
- `channelManager.init()` processes existing messages from storage
- ChatHandler needs LLM cache to identify AI senders in those messages
- If cache is empty → error: "AI sender detected but no LLM object found"

## Usage

### Platform Initialization

```typescript
import { initializeCoreModels } from '@lama/core/initialization/CoreInitializer.js';

// Create all dependencies FIRST
const model = new Model();
// ... create handlers, managers, etc ...

// Then initialize in correct order via CoreInitializer
await initializeCoreModels({
    oneCore: this,
    leuteModel: this.leuteModel,
    channelManager: this.channelManager,
    topicModel: this.topicModel,
    connections: this.connections,
    llmManager: this.llmManager,
    llmObjectManager: this.llmObjectManager,
    aiAssistantModel: this.aiAssistantModel,
    chatHandler: this.chatHandler,
    topicAnalysisModel: this.topicAnalysisModel,
    topicGroupManager: this.topicGroupManager
}, (progress) => {
    console.log(`Init: ${progress.stage} (${progress.percent}%)`);
});
```

### Platform Shutdown

```typescript
import { shutdownCoreModels } from '@lama/core/initialization/CoreInitializer.js';

// Shutdown platform-specific handlers first
await this.myPlatformHandler.shutdown();

// Then use CoreInitializer for core models (reverse order)
await shutdownCoreModels({
    // same deps as init
});
```

## Benefits

✅ **Enforced order** - Can't accidentally break initialization sequence
✅ **Centralized** - One place to fix flow control issues
✅ **Fail fast** - No fallbacks, no mitigation - proper dependencies
✅ **Platform agnostic** - Works for browser, electron, worker, etc.
✅ **Progress tracking** - Optional callback for UI feedback

## Platforms

### lama.browser ✅
- Uses CoreInitializer (Model.ts:413)
- Removed manual init() orchestration
- Clean separation: platform handlers → CoreInitializer → done

### lama.cube ⏸️
- TODO: Migrate to CoreInitializer
- Currently manual orchestration in node-one-core.ts

## Files

- `CoreInitializer.ts` - Main initialization logic
- `README.md` - This file
