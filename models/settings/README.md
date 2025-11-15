# Settings Managers

Unified directory for all settings management in lama.core.

## Overview

All settings managers are consolidated in `models/settings/` following a consistent pattern:

1. **Use ONE.core versioned objects** - Settings stored as versioned objects with history
2. **ID-based retrieval** - Direct retrieval via `getObjectByIdHash()` (no queries)
3. **Type-safe** - All types defined in `@OneObjectInterfaces.d.ts`
4. **Recipe-based** - Each setting type has a corresponding recipe in `recipes/`

## Settings Managers

### AISettingsManager

**Purpose**: AI Assistant application configuration per instance
**Recipe**: `AISettingsRecipe.ts`
**ID Field**: `name` (instance name)
**Type**: `AISettings`

**Configuration includes**:
- Default provider (ollama, anthropic, lmstudio, openai)
- Model selection preferences
- Auto-select best model flag
- Temperature and max tokens
- System prompt
- Stream responses
- Auto-summarize
- MCP enablement

**Usage**:
```typescript
import { AISettingsManager } from '@lama/core/models';

const manager = new AISettingsManager(nodeOneCore);
const settings = await manager.getSettings();
await manager.setDefaultModelId('llama3.2:latest');
```

### GlobalLLMSettingsManager

**Purpose**: Core LLM parameters per user (Person)
**Recipe**: `GlobalLLMSettingsRecipe.ts`
**ID Field**: `creator` (Person ID)
**Type**: `GlobalLLMSettings`

**Configuration includes**:
- Temperature
- Max tokens
- Default prompt
- Auto-summary enable flag
- Auto-response enable flag

**Usage**:
```typescript
import { GlobalLLMSettingsManager } from '@lama/core/models';

const deps = {
  storeVersionedObject,
  getObjectByIdHash,
  calculateIdHashOfObj
};
const manager = new GlobalLLMSettingsManager(deps, creatorId);
const settings = await manager.getSettings();
await manager.setDefaultModelId('llama3.2:latest');
```

### WordCloudSettingsManager

**Purpose**: Word cloud visualization settings
**Recipe**: `WordCloudSettingsRecipe.ts`
**ID Field**: `creator` (Person ID)
**Type**: `WordCloudSettings`

**Configuration includes**:
- Max words per subject
- Related word threshold
- Min word frequency
- Show summary keywords flag
- Font scale (min/max)
- Color scheme
- Layout density

**Usage**:
```typescript
import { wordCloudSettingsManager } from '@lama/core/models';

const settings = await wordCloudSettingsManager.getSettings(creatorId);
await wordCloudSettingsManager.updateSettings(creatorId, {
  maxWordsPerSubject: 30,
  colorScheme: 'plasma'
});
```

## Key Differences

### AISettings vs GlobalLLMSettings

- **AISettings**: Application-level configuration per instance (provider, features)
- **GlobalLLMSettings**: Core LLM parameters per user (temperature, prompts)

Both are separate but complementary:
- AISettings controls **what** AI features are available and how they're configured
- GlobalLLMSettings controls **how** LLMs behave (parameters, defaults)

### settings.core Integration

**Note**: There is also `settings.core` which provides app-level preferences stored in platform-specific storage (SecureStore, IndexedDB). This is separate from ONE.core versioned objects.

**Future**: `settings.core` should migrate to use ONE.core for storage instead of direct platform APIs.

## Architecture

```
models/
└── settings/
    ├── index.ts                      # Unified exports
    ├── AISettingsManager.ts          # AI app configuration (per instance)
    ├── GlobalLLMSettingsManager.ts   # LLM parameters (per user)
    └── WordCloudSettingsManager.ts   # Word cloud viz (per user)

recipes/
├── AISettingsRecipe.ts               # AISettings type definition
├── GlobalLLMSettingsRecipe.ts        # GlobalLLMSettings type definition
└── one-ai/recipes/
    └── WordCloudSettingsRecipe.ts    # WordCloudSettings type definition

@OneObjectInterfaces.d.ts             # Ambient type declarations
```

## Pattern

All settings managers follow this pattern:

1. **Default settings constant** - `DEFAULT_*_SETTINGS`
2. **Create function** - `create*Settings(params)`
3. **Type guard** - `is*Settings(obj)`
4. **Manager class** with:
   - `getSettings()` - Retrieve current settings
   - `updateSettings(updates)` - Create new version
   - ID hash caching for performance

## Performance

- **Cache hit**: <1ms (in-memory)
- **Cache miss with idHash**: ~15ms (direct retrieval)
- **First time**: ~30ms (calculate idHash + retrieve + create defaults)

## Migration Notes

**Date**: 2025-11-15

Settings managers were consolidated from multiple locations:
- `services/AISettingsManager.ts` → `models/settings/AISettingsManager.ts`
- `models/GlobalLLMSettingsManager.ts` → `models/settings/GlobalLLMSettingsManager.ts`
- `one-ai/storage/word-cloud-settings-manager.ts` → `models/settings/WordCloudSettingsManager.ts`

All imports updated to use unified path: `@lama/core/models`
