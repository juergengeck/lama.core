# Core Initialization Pattern

## Overview

Initialization is handled via **ModuleRegistry** from `@refinio/api`. The old `CoreInitializer.ts` has been removed in favor of a unified module system.

## How It Works

Both platforms use the same modules from `lama.core/modules/`, with platform-specific adapters injected via dependency injection:

```
lama.core/modules/    → Shared modules (CoreModule, AIModule, ChatModule, etc.)
lama.core/services/   → Platform abstraction interfaces (LLMPlatform)
platform adapters     → BrowserLLMPlatform / ElectronLLMPlatform
```

### Initialization Flow

1. Platform supplies adapters to ModuleRegistry
2. Platform registers shared modules from lama.core
3. ModuleRegistry.initAll() topologically sorts and initializes

```typescript
import { ModuleRegistry } from '@refinio/api';
import { CoreModule, AIModule, JournalModule } from '@lama/core/modules';

const registry = new ModuleRegistry();

// Supply platform adapters
registry.supply('OneCore', this);
registry.supply('LLMPlatform', new BrowserLLMPlatform());

// Register shared modules (same for both platforms)
registry.register(new CoreModule(commServerUrl));
registry.register(new JournalModule());
registry.register(new AIModule());
// ...

await registry.initAll();  // Topological sort ensures correct order
```

## Module Dependencies

ModuleRegistry uses static `demands` and `supplies` to determine initialization order:

- **CoreModule**: demands OneCore → supplies LeuteModel, ChannelManager, TopicModel
- **JournalModule**: demands LeuteModel, ChannelManager → supplies JournalPlan
- **AIModule**: demands LeuteModel, ChannelManager, LLMPlatform → supplies AIAssistantPlan

## Benefits

- **Single source of truth**: Modules in lama.core, platforms only supply adapters
- **Automatic ordering**: ModuleRegistry's topological sort ensures correct order
- **Type-safe DI**: Platform adapters implement shared interfaces
- **No duplication**: Same module code runs on both browser and electron
