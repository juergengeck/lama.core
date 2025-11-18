# AI/LLM Architecture (MIGRATED - January 2025)

> **Status**: ✅ Migration Complete - Person-centric architecture is now live

## Overview

The LAMA AI architecture uses a **Person-centric** approach where AI assistants and LLM models are represented as ONE.core Person identities with Profile-based delegation.

## Core Concepts

### AI Person
**What**: The assistant's identity/personality (e.g., "Claude", "Research Assistant", "Code Helper")

**Structure**:
- **Person**: Email `${aiId}@ai.local`, name = display name
- **Profile**: Contains:
  - `profileId`: `ai:${aiId}` (ID property)
  - `delegatesTo`: `SHA256IdHash<Person>` - points to LLM Person (or another AI Person)
  - `nickname`: Display name
  - `entityType`: `'ai'`
- **Someone**:
  - `someoneId`: `ai:${aiId}`
  - Links Person ↔ Profile

**Capabilities**:
- Can delegate to LLM Person (normal case)
- Can delegate to another AI Person (AI chaining)
- Changing `delegatesTo` changes which model the AI uses

### LLM Person
**What**: The model's identity (e.g., "claude-sonnet-4-5", "gpt-4", "llama-3")

**Structure**:
- **Person**: Email `${modelId}@llm.local`, name = model name
- **Profile**: Contains:
  - `profileId`: `llm:${modelId}` (ID property)
  - `llmConfigId`: `string` - references LLM config object (if needed)
  - `provider`: `string` - e.g., "anthropic", "openai", "ollama"
  - `nickname`: Model display name
  - `entityType`: `'llm'`
- **Someone**:
  - `someoneId`: `llm:${modelId}`
  - Links Person ↔ Profile

## Relationship Flow

### Simple Case: AI → LLM
```
AI Person ("Claude")
  └─ Profile.delegatesTo → LLM Person ("claude-sonnet-4-5")
                              └─ Profile.llmConfigId → LLM Config (API keys, etc.)
```

### Chaining: AI → AI → LLM
```
AI Person ("Research Assistant")
  └─ Profile.delegatesTo → AI Person ("Claude")
                              └─ Profile.delegatesTo → LLM Person ("claude-sonnet-4-5")
                                                          └─ Profile.llmConfigId → LLM Config
```

## Benefits

1. **Flexible Model Switching**: Change AI's delegatesTo without losing identity/history
2. **AI Chaining**: Support AI → AI delegation for complex workflows
3. **Clean Separation**: Identity (Person) vs Configuration (LLM object)
4. **ONE.core Native**: Uses Person/Profile/Someone as designed
5. **Conversation History**: AI Person stays constant even when switching models

## Implementation (Current)

### AIManager

**Location**: `/models/ai/AIManager.ts`

Manages AI and LLM Person identities with Profile-based delegation.

```typescript
class AIManager {
  // AI Person management
  async createAI(aiId: string, name: string, delegatesTo: SHA256IdHash<Person>): Promise<SHA256IdHash<Person>>;
  async setAIDelegation(aiId: string, delegatesTo: SHA256IdHash<Person>): Promise<void>;
  async getAIDelegation(aiId: string): Promise<SHA256IdHash<Person> | null>;

  // LLM Person management
  async createLLM(modelId: string, name: string, provider: string): Promise<SHA256IdHash<Person>>;

  // Resolution (follows delegation chain)
  async resolveLLMPerson(personId: SHA256IdHash<Person>): Promise<SHA256IdHash<Person>>;

  // Lookups
  getPersonId(entityId: string): SHA256IdHash<Person> | null;
  getEntityId(personId: SHA256IdHash<Person>): string | null;
  isAI(personId: SHA256IdHash<Person>): boolean;
  isLLM(personId: SHA256IdHash<Person>): boolean;
}
```

### AITopicManager

**Location**: `/models/ai/AITopicManager.ts`

Maps topics to AI Persons (not model IDs).

```typescript
class AITopicManager {
  // Storage: topicId → AI Person ID
  private _topicAIMap: Map<string, SHA256IdHash<Person>>;

  // Register topic with AI Person
  registerAITopic(topicId: string, aiPersonId: SHA256IdHash<Person>): void;

  // Get AI Person for topic
  getAIPersonForTopic(topicId: string): SHA256IdHash<Person> | null;

  // Scan existing conversations for AI Persons
  async scanExistingConversations(aiManager: AIManager): Promise<number>;
}
```

### Data Flow

**Topic Creation**:
```
1. Create LLM Person for model
   AIManager.createLLM(modelId, name, provider) → llmPersonId

2. Create AI Person that delegates to LLM
   AIManager.createAI(aiId, name, llmPersonId) → aiPersonId

3. Register topic with AI Person
   AITopicManager.registerAITopic(topicId, aiPersonId)
```

**Message Processing**:
```
1. Get AI Person for topic
   aiPersonId = AITopicManager.getAIPersonForTopic(topicId)

2. Resolve to LLM Person (follows delegation chain)
   llmPersonId = await AIManager.resolveLLMPerson(aiPersonId)

3. Get model ID
   llmId = AIManager.getEntityId(llmPersonId)  // "llm:modelId"
   modelId = llmId.replace(/^llm:/, '')

4. Process with LLM
   LLMManager.chat(modelId, ...)
```

## Migration Status

### ✅ Completed

1. **AIManager** - Created (replaces AIContactManager)
2. **AITopicManager** - Updated to store AI Person IDs
3. **AIPromptBuilder** - Updated to resolve Person chains
4. **AIMessageProcessor** - Updated to use AIManager
5. **TopicAnalysisPlan** - Updated to use async resolution
6. **AIAssistantPlan** - Updated with Person resolution
7. **Interfaces** - Updated IAITopicManager
8. **AIContactManager** - Deleted (deprecated)
9. **Build** - All TypeScript compilation errors fixed

### 🗑️ Removed

- `AIContactManager.ts` - Replaced by AIManager
- `IAIContactManager` - Marked as deprecated
- `getModelIdForTopic()` - Now resolves through Person chain (async)
- `getModelInfoForTopic()` - Removed (not needed)
- `switchTopicModel()` - Removed (use `switchTopicAI`)

## Current Architecture

**Old**:
```
Topic → Model ID (string) → AI Contact Person
```

**New**:
```
Topic → AI Person ID → LLM Person ID → Model ID
         (stored)        (via delegation)   (resolved at runtime)
```

## Key Principles

1. **Persons First**: Everything is a Person identity, not a string ID
2. **Delegation Over Direct Reference**: Use Profile.delegatesTo for indirection
3. **Runtime Resolution**: Resolve Person chains when needed, don't cache model IDs
4. **ONE.core Native**: Use standard recipes and storage patterns
5. **Fail Fast**: No fallbacks, no null-checks that hide problems
