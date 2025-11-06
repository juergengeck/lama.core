# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**lama.core** is a platform-agnostic business logic library providing shared plans, services, and models for LAMA applications. It contains pure business logic with no platform-specific dependencies.

## Architecture: Build-Time vs Runtime Dependencies

### Key Principle

lama.core imports from `@refinio/one.core` and `@refinio/one.models` at **build-time only**. Consuming projects (lama.electron, lama.browser, lama.worker) supply these dependencies at **runtime**.

```
BUILD TIME (TypeScript compilation):
  lama.core/tsconfig.json → @refinio/* resolves to ./packages/*
  → TypeScript compiles successfully using local types

RUNTIME:
  lama.electron imports lama.core
  → lama.electron's one.core/one.models instances are used
  → Single runtime instance (no duplicates)
```

### Directory Structure

```
lama.core/
├── packages/              # Build-time only (NOT included in runtime)
│   ├── one.core/          # @refinio/one.core@0.6.1-beta-3
│   └── one.models/        # @refinio/one.models@14.1.0-beta-5
├── plans/                 # Platform-agnostic business logic plans
│   ├── ChatPlan.ts
│   ├── AIAssistantPlan.ts
│   ├── ContactsPlan.ts
│   └── ...
├── ai/                    # AI initialization infrastructure
│   └── AIInitializationHandler.ts  # AI service initialization orchestration
├── initialization/        # Core initialization system
│   └── CoreInitializer.ts          # Enforces correct init order
├── services/              # LLM and external service integrations
│   ├── llm-manager.ts
│   ├── ollama.ts
│   ├── claude.ts
│   └── llm-platform.ts    # Platform abstraction interface
├── models/ai/             # AI component architecture
│   ├── AIContactManager.ts
│   ├── AITopicManager.ts
│   ├── AIPromptBuilder.ts
│   └── ...
├── one-ai/                # Topic analysis and knowledge extraction
│   ├── models/            # Subject, Keyword, Summary
│   ├── services/          # TopicAnalyzer, RealTimeKeywordExtractor
│   ├── storage/           # ONE.core object storage
│   └── recipes/           # ONE.core type definitions
└── package.json           # No dependencies on one.core/one.models
```

## Dependencies

### package.json

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.65.0",
    "node-fetch": "^2.7.0"
  },
  "peerDependencies": {
    "@refinio/one.core": "*",
    "@refinio/one.models": "*"
  }
  // Consuming projects supply one.core/one.models at runtime
}
```

### Why peerDependencies?

- **Avoid duplicate modules**: Consuming projects have their own one.core/one.models
- **Platform-agnostic**: lama.core doesn't choose which platform implementation to use
- **Single runtime instance**: Only the consuming project's instance is loaded
- **Build-time types**: Resolved via tsconfig.json paths to ./packages/*

### TypeScript Resolution

**tsconfig.json**:
```json
{
  "paths": {
    "@refinio/*": ["./packages/*"]  // Build-time only
  }
}
```

TypeScript finds types in `./packages/*` during compilation, but these are NOT bundled or included at runtime.

## Plan Pattern

All plans follow dependency injection pattern - they receive dependencies via constructor:

```typescript
// ChatPlan.ts
export class ChatPlan {
  constructor(
    private nodeOneCore: any,      // Injected by consuming project
    private stateManager: any      // Injected by consuming project
  ) {}

  async sendMessage(params) {
    // Pure business logic using injected dependencies
  }
}
```

**Consuming projects create plan instances**:

```typescript
// lama.electron/main/ipc/plans/chat.ts
import { ChatPlan } from '@lama/core/plans/ChatPlan.js';
import nodeOneCore from '../../core/node-one-core.js';
import stateManager from '../../state/manager.js';

const chatPlan = new ChatPlan(nodeOneCore, stateManager);

export default {
  async sendMessage(event, params) {
    return await chatPlan.sendMessage(params);
  }
};
```

## Platform Abstraction

### LLMPlatform Interface

Platform-specific event emission is abstracted via `LLMPlatform` interface:

```typescript
// lama.core/services/llm-platform.ts
export interface LLMPlatform {
  emitProgress(data: any): void;
  emitError(error: Error): void;
  emitMessageUpdate(data: any): void;
}
```

**Platform implementations**:
- **ElectronLLMPlatform** (lama.electron) - Uses BrowserWindow.webContents.send()
- **BrowserLLMPlatform** (lama.browser) - Uses postMessage()

## Building lama.core

```bash
npm install     # Installs @anthropic-ai/sdk, node-fetch only
npm run build   # Compiles TypeScript using ./packages/* for types
npm run watch   # Watch mode for development
npm run clean   # Remove all .js files (except node_modules, packages, dist)
```

**Note**: TypeScript errors in packages/ are from upstream one.core/one.models source and are ignored during lama.core development.

## Consuming lama.core

Projects use lama.core via `file:` reference:

```json
// lama.electron/package.json
{
  "dependencies": {
    "@lama/core": "file:../lama.core",
    "@refinio/one.core": "file:./packages/one.core",
    "@refinio/one.models": "file:./packages/one.models"
  }
}
```

At runtime:
- lama.electron loads its own one.core/one.models
- lama.core plans use those instances (single instance across app)

## Version Synchronization

All projects use synchronized versions:

```
Current versions:
- @refinio/one.core:   0.6.1-beta-3
- @refinio/one.models: 14.1.0-beta-5
```

When updating:
1. Update lama.core/packages/ first
2. Test in lama.electron (canary)
3. Update all other projects

## Key Modules

### Plans (plans/)
Pure business logic with dependency injection:
- **AIAssistantPlan** - AI assistant orchestration (component-based)
- **AIPlan** - AI operations
- **AuditPlan** - Audit logging and compliance
- **ChatMemoryPlan** - Chat memory management
- **CryptoPlan** - Cryptographic operations
- **KeywordDetailPlan** - Keyword detail management
- **LLMConfigPlan** - LLM configuration
- **MemoryPlan** - Memory operations
- **ProposalsPlan** - Context-aware knowledge sharing
- **SubjectsPlan** - Subject management
- **TopicAnalysisPlan** - Keyword/subject extraction
- **WordCloudSettingsPlan** - Word cloud configuration

### Services (services/)
External integrations and platform abstractions:
- **llm-manager.ts** - Multi-provider LLM orchestration
- **ollama.ts** - Ollama HTTP client
- **claude.ts** - Anthropic Claude API client
- **lmstudio.ts** - LM Studio HTTP client
- **llm-platform.ts** - Platform abstraction interface

### AI Models (models/ai/)
Component-based AI assistant architecture:
- **AIContactManager** - AI Person/Profile/Someone lifecycle
- **AITopicManager** - Topic-to-model mappings
- **AITaskManager** - Dynamic task associations (IoM)
- **AIPromptBuilder** - Prompt construction with context
- **AIMessageProcessor** - Message queuing and LLM invocation

### Topic Analysis (one-ai/)
Knowledge extraction from conversations:
- **TopicAnalyzer** - Extract subjects and keywords from messages
- **Subject** - Distinct theme (identified by keyword combination)
- **Keyword** - Extracted term/concept
- **Summary** - Versioned overview of subjects in a topic

### AI Initialization (ai/)
AI service initialization infrastructure:
- **AIInitializationHandler** - Orchestrates AI initialization flow
  - Initializes UserSettingsManager
  - Discovers Claude models and API keys
  - Configures LLM manager
  - Initializes AI Assistant Plan

### Core Initialization (initialization/)
System-wide initialization orchestration:
- **CoreInitializer** - Enforces correct initialization order across all core models
  - **Critical order**: LLM infrastructure MUST initialize before ChannelManager
  - **Why**: ChannelManager processes existing messages on init, needs LLM contact cache populated
  - **Flow**: LeuteModel → LLM → ChannelManager → TopicModel → Connections → Chat plans
  - **Fail fast**: No fallbacks, no mitigation - throw on errors

## Development Workflow

### Adding a New Plan

1. Create plan in `plans/NewPlan.ts`:
```typescript
export class NewPlan {
  constructor(
    private nodeOneCore: any,
    private customDep: any
  ) {}

  async doSomething(params) {
    // Business logic
  }
}
```

2. Consuming project creates plan instance:
```typescript
import { NewPlan } from '@lama/core/plans/NewPlan.js';
const plan = new NewPlan(nodeOneCore, customDep);
```

### Adding a New Service

Services are self-contained with optional platform injection:

```typescript
// services/my-service.ts
export class MyService {
  constructor(private platform?: LLMPlatform) {}

  async doWork() {
    // Platform-agnostic logic
    this.platform?.emitProgress({ status: 'working' });
  }
}
```

## Engineering Principles (from ~/.claude/CLAUDE.md)

- **No fallbacks**: Fail fast and throw - fix problems, don't mitigate
- **No delays**: Operations should be immediate or properly async
- **Use what you have**: Don't create redundant abstractions
- **Fix, do not mitigate**: Understand before implementing
- **SHA256Hash and SHA256IdHash are branded types**: Strings with type safety
- **Let one.helpers do its job**: Don't reimplement existing utilities

## Common Patterns

### Type Imports from one.core

```typescript
import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
```

**Use `type` imports** - these are erased at runtime (no actual dependency).

### ONE.core Storage Operations

```typescript
// Versioned objects (Subject, Keyword, etc.)
const result = await storeVersionedObject(subject);
// Returns: { hash, idHash, versionHash }

// Always store before posting to channel
await channelManager.postToChannel(topicId, subject);
```

## Testing Strategy

Currently: No test suite (deferred)

Future:
- Unit tests with mocked one.core dependencies
- Integration tests with real one.core instances
- Run in Node.js (plans are platform-agnostic)

## Migration Notes

**Date**: 2025-10-22

lama.core was migrated from peerDependencies to build-time packages/:

**Before**:
```json
"peerDependencies": {
  "@refinio/one.core": "*",
  "@refinio/one.models": "*"
}
// tsconfig.json paths pointed to ../lama.browser/node_modules/@refinio/*
```

**After**:
```
packages/one.core/    # Build-time only
packages/one.models/  # Build-time only
// tsconfig.json paths point to ./packages/*
// NO runtime dependencies
```

This aligns with how `@refinio/one.models` imports `@refinio/one.core`.

## Related Documentation

- `MIGRATION-STATUS.md` - Architecture migration details
- `LAMA-CORE-ARCHITECTURE-DISCUSSION.md` - Design decisions
- Each consuming project has its own CLAUDE.md with platform-specific details
