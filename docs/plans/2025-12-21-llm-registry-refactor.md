# LLM Registry Refactor: Decoupling LLMs from Identity

**Status: Phase 1-2 Complete** (2025-12-21)

## Problem

LLM configurations are currently stored in identity-bound channels (`participantsHash = myMainIdentity()`). This creates an incorrect architectural coupling:

1. **LLMManager requires `leuteModel`** to get participants hash for storage lookup
2. **LLMs tied to identity** when they're just capability providers
3. **First-run bootstrapping issues** - LLM needed before identity fully established

## Current Flow (Wrong)

```
discoverOllamaModels()
  → create LLM object
  → getAppChannelParticipants() → requires leuteModel.myMainIdentity()
  → postToChannel(participantsHash, llmObject)

chat(modelId)
  → getLLMFromStorage(modelId)
  → getAppChannelParticipants() → requires leuteModel
  → channelManager.objectIteratorWithType('LLM', { participants })
  → find matching LLM
```

## Correct Pattern: Follow DiscoveryService

DiscoveryService manages peers as resources without identity coupling:

```typescript
class DiscoveryService {
  // In-memory registry of discovered peers
  private discoveredPeers: Map<string, PeerIdentity> = new Map();

  // Providers injected at init (platform-specific)
  private localDiscovery: LocalDiscoveryProvider | null = null;
  private relayDiscovery: RelayDiscoveryProvider | null = null;

  // Discovery adds to in-memory registry
  private addPeer(peer: PeerIdentity, source: 'local' | 'relay'): void {
    this.discoveredPeers.set(peer.id, peer);
    this.emit('peerDiscovered', peer);
  }
}
```

LLMs should follow the same pattern - they're resources, not identity data.

## Proposed Architecture

### 1. LLMRegistry (In-Memory)

```typescript
// services/llm-registry.ts

export interface LLMRegistryEntry {
  llm: LLM;
  source: 'ollama' | 'lmstudio' | 'anthropic' | 'openai' | 'local';
  discoveredAt: number;
  lastVerifiedAt: number;
  available: boolean;  // Can we reach it right now?
}

export class LLMRegistry {
  private entries: Map<string, LLMRegistryEntry> = new Map();

  // Events
  public onModelDiscovered = new OEvent<(entry: LLMRegistryEntry) => void>();
  public onModelLost = new OEvent<(modelId: string) => void>();
  public onModelUpdated = new OEvent<(entry: LLMRegistryEntry) => void>();

  register(llm: LLM, source: LLMRegistryEntry['source']): void {
    const entry: LLMRegistryEntry = {
      llm,
      source,
      discoveredAt: Date.now(),
      lastVerifiedAt: Date.now(),
      available: true
    };
    this.entries.set(llm.modelId, entry);
    this.onModelDiscovered.emit(entry);
  }

  get(modelId: string): LLM | null {
    return this.entries.get(modelId)?.llm ?? null;
  }

  getAll(): LLM[] {
    return Array.from(this.entries.values()).map(e => e.llm);
  }

  getByProvider(provider: string): LLM[] {
    return this.getAll().filter(llm => llm.provider === provider);
  }

  getByCapability(capability: string): LLM[] {
    // Filter by inferenceType, context length, etc.
  }

  markUnavailable(modelId: string): void {
    const entry = this.entries.get(modelId);
    if (entry) {
      entry.available = false;
      this.onModelUpdated.emit(entry);
    }
  }

  remove(modelId: string): void {
    if (this.entries.delete(modelId)) {
      this.onModelLost.emit(modelId);
    }
  }
}
```

### 2. User Preferences (App-Level Settings)

User's selected model and API keys stored via `UserSettingsManager` (already exists):

```typescript
// Already exists - just add selected model
interface UserSettings {
  apiKeys: { anthropic?: string; openai?: string };
  selectedModelId?: string;  // Add this
  modelPreferences?: {
    defaultTemperature?: number;
    defaultMaxTokens?: number;
  };
}
```

### 3. LLMManager Changes

```typescript
class LLMManager {
  // NEW: In-memory registry (like DiscoveryService.discoveredPeers)
  private llmRegistry: LLMRegistry;

  // KEEP: Adapter registry (handles routing to backends)
  private adapterRegistry: LLMAdapterRegistry;

  // KEEP: User settings (API keys, preferences)
  private userSettingsManager: UserSettingsManager;

  // REMOVE: No longer needed
  // private leuteModel: LeuteModel;
  // private channelManager: ChannelManager;
  // private getAppChannelParticipants(): Promise<...>
  // private getLLMFromStorage(): Promise<...>
  // private getAllLLMsFromStorage(): Promise<...>

  // NEW: Simple lookup from registry
  getLLM(modelId: string): LLM | null {
    return this.llmRegistry.get(modelId);
  }

  getAvailableModels(): LLM[] {
    return this.llmRegistry.getAll();
  }

  // SIMPLIFIED: chat() uses registry directly
  async chat(messages: any, modelId: string, options: any = {}): Promise<unknown> {
    const llm = this.llmRegistry.get(modelId);
    if (!llm) {
      throw new Error(`Model ${modelId} not found in registry`);
    }

    // Inject API key from settings if needed
    if (llm.provider === 'anthropic' && !options.apiKey) {
      options.apiKey = await this.userSettingsManager.getApiKey('anthropic');
    }

    const adapter = this.adapterRegistry.getAdapter(llm);
    return adapter.chat(llm, messages, options);
  }

  // SIMPLIFIED: Discovery registers to in-memory, not channel
  async discoverOllamaModels(): Promise<void> {
    const models = await fetchOllamaModels(this.ollamaConfig.baseUrl);

    for (const model of models) {
      const llm: LLM = {
        $type$: 'LLM',
        modelId: model.name,
        name: model.name,
        provider: 'ollama',
        inferenceType: 'server',
        server: this.ollamaConfig.baseUrl,
        // ... other fields
      };

      this.llmRegistry.register(llm, 'ollama');
    }
  }
}
```

### 4. AIModule Changes

```typescript
class AIModule {
  static demands = [
    // REMOVE: { targetType: 'LeuteModel', required: true }
    // KEEP other demands
    { targetType: 'ChannelManager', required: true },  // For chat storage, not LLM storage
  ];

  async init(): Promise<void> {
    // REMOVE: this.llmManager.setLeuteModel(leuteModel);

    // LLMManager only needs:
    this.llmManager.setUserSettingsManager(this.userSettingsManager);
    this.llmManager.setAdapterRegistry(getAdapterRegistry());

    // Discovery populates registry
    await this.llmManager.discoverOllamaModels();
    await this.llmManager.discoverClaudeModels();
  }
}
```

### 5. LLMConfigPlan Changes

The plan becomes simpler - it just manages user preferences:

```typescript
class LLMConfigPlan {
  // REMOVE: All channel-based storage methods
  // - getAppChannelParticipants()
  // - postToChannel()
  // - objectIteratorWithType('LLM')

  // SIMPLIFIED: Set active model (stores preference, not LLM object)
  async setActiveModel(modelId: string): Promise<void> {
    // Verify model exists in registry
    const llm = this.llmManager.getLLM(modelId);
    if (!llm) {
      throw new Error(`Model ${modelId} not found`);
    }

    // Store user preference
    await this.userSettingsManager.setSetting('selectedModelId', modelId);
  }

  // SIMPLIFIED: Get active model
  async getActiveModel(): Promise<LLM | null> {
    const modelId = await this.userSettingsManager.getSetting('selectedModelId');
    return modelId ? this.llmManager.getLLM(modelId) : null;
  }

  // API keys already use UserSettingsManager - no change needed
  async setApiKey(provider: string, key: string): Promise<void> {
    await this.userSettingsManager.setApiKey(provider, key);
  }
}
```

## Migration Path

### Phase 1: Add LLMRegistry (Additive)

1. Create `services/llm-registry.ts`
2. Add `llmRegistry` to LLMManager alongside existing storage
3. Discovery methods populate both registry AND storage (temporary)
4. `chat()` tries registry first, falls back to storage

### Phase 2: Switch to Registry

1. Update `chat()` to use registry only
2. Update `LLMConfigPlan` to use registry + settings
3. Remove `getLLMFromStorage()`, `getAllLLMsFromStorage()`
4. Remove `leuteModel` dependency from LLMManager

### Phase 3: Cleanup

1. Remove channel-based LLM storage code
2. Remove `setLeuteModel()` from AIModule
3. Update AIModule demands (remove LeuteModel requirement for LLM)

## Benefits

1. **No identity coupling** - LLMs are resources, not identity data
2. **Simpler bootstrapping** - No chicken-and-egg with identity
3. **Faster lookups** - In-memory vs channel iteration
4. **Cleaner architecture** - Matches DiscoveryService pattern
5. **Easier testing** - No ONE.core mocking needed for LLM tests

## Files to Modify

| File | Changes |
|------|---------|
| `services/llm-registry.ts` | NEW - In-memory LLM registry |
| `services/llm-manager.ts` | Remove storage methods, add registry |
| `modules/AIModule.ts` | Remove leuteModel wiring for LLM |
| `plans/LLMConfigPlan.ts` | Use registry + settings, not channels |
| `models/ai/AIMessageProcessor.ts` | Already fixed (uses chat()) |

## Current Prompting Architecture

Understanding what stays where:

### AI Object (ONE.core - versioned, identity-related)
```typescript
AI {
  aiId: string;              // Unique AI identity
  displayName: string;       // "Claude", "Atlas", etc.
  personId: SHA256IdHash;    // Reference to Person
  modelId: string;           // Which LLM to use (string ID, not reference)
  personality: {
    traits: string[];        // ["helpful", "concise"]
    creationContext: {...};  // When/where created
    systemPromptAddition: string;  // User customizations
  }
}
```

**AI is identity** - stored in ONE.core, syncs across devices.

### LLM Object (Registry - ephemeral, resource)
```typescript
LLM {
  modelId: string;           // "llama3.2:latest", "claude-sonnet-4-20250514"
  name: string;              // Display name
  provider: string;          // "ollama", "anthropic", "openai"
  server: string;            // "http://localhost:11434"
  inferenceType: string;     // "ondevice", "server", "cloud"
  capabilities: string[];    // ["chat", "extended-thinking"]
  contextLength: number;     // 128000
  // ... model parameters
}
```

**LLM is a resource** - discovered at runtime, not identity data.

### SystemPromptBuilder (Runtime composition)
```
Priority 0:  base-identity      → Fallback "You are a helpful AI assistant"
Priority 5:  ai-identity        → From AI object (name, traits, creation context)
Priority 10: user-preferences   → From UserSettingsManager
Priority 25: current-subject    → Current conversation context
Priority 100: mcp-tools         → Tool descriptions
```

**System prompts are composed** - not stored on LLM object.

### What This Means for Refactor

| Data | Storage | Why |
|------|---------|-----|
| AI identity (name, traits) | ONE.core AI object | Syncs across devices, user's personalization |
| AI → LLM mapping | AI.modelId (string) | AI chooses which LLM to use |
| Available LLMs | In-memory registry | Ephemeral resources, discovered at runtime |
| User's selected model | UserSettingsManager | App preference, not identity |
| API keys | UserSettingsManager | Already there |
| System prompt additions | AI.personality.systemPromptAddition | Per-AI customization |

**LLM.systemPrompt field is LEGACY** - not used. SystemPromptBuilder composes at runtime.

## Multiple Ollama Servers

Current: Single `ollamaConfig.baseUrl`
Required: Multiple servers with independent discovery

### Server Configuration (UserSettingsManager)

```typescript
interface OllamaServerConfig {
  id: string;              // Unique ID for this server
  name: string;            // "Local", "Home Server", "Work GPU"
  baseUrl: string;         // "http://localhost:11434"
  authType?: 'none' | 'bearer';
  enabled: boolean;        // Can disable without deleting
}

interface UserSettings {
  ollamaServers: OllamaServerConfig[];
  // ... other settings
}
```

### Discovery Updates

```typescript
class LLMManager {
  // Discover from ALL configured servers
  async discoverOllamaModels(): Promise<void> {
    const servers = await this.userSettingsManager.getOllamaServers();

    for (const server of servers) {
      if (!server.enabled) continue;

      try {
        const models = await fetchOllamaModels(server.baseUrl);

        for (const model of models) {
          // modelId includes server to avoid collisions
          // e.g., "llama3.2:latest@localhost:11434"
          const modelId = `${model.name}@${new URL(server.baseUrl).host}`;

          const llm: LLM = {
            $type$: 'LLM',
            modelId,
            name: model.name,
            provider: 'ollama',
            server: server.baseUrl,
            // ...
          };

          this.llmRegistry.register(llm, 'ollama');
        }
      } catch (error) {
        // Server unreachable - log but continue
        console.warn(`Ollama server ${server.name} unreachable:`, error);
      }
    }
  }
}
```

### Registry Key Strategy

Models from different servers could have same name (e.g., "llama3.2:latest" on two servers).

**Option A: Include server in modelId**
```
llama3.2:latest@localhost:11434
llama3.2:latest@gpu-server.local:11434
```
- Pro: Unique keys, explicit
- Con: Longer IDs, need to handle when server changes

**Option B: Registry keyed by modelId + server**
```typescript
private entries: Map<string, Map<string, LLMRegistryEntry>>; // server → modelId → entry
```
- Pro: Clean modelId
- Con: Two-level lookup

**Recommendation: Option A** - single flat map, explicit server in ID.

## Open Questions

1. **Persistence across restarts?**
   - Recommendation: Re-discover on startup (like DiscoveryService)
   - Servers list persists in UserSettings, models re-discovered
   - Ensures fresh state, handles server changes

2. **Model availability checking?**
   - Check on-demand, mark unavailable on failure
   - Optional: Background heartbeat every 60s for active servers
   - UI shows availability indicator

3. **Default model selection when server unavailable?**
   - If selected model's server is down, fall back to first available
   - Or: Fail explicitly, let user choose alternative

## Implementation Notes (2025-12-21)

### What Was Implemented

**Phase 1: LLMRegistry (Complete)**
- Created `services/llm-registry.ts` with in-memory Map storage
- Events: `onModelDiscovered`, `onModelLost`, `onModelUpdated`, `onCleared`
- Methods: `register()`, `get()`, `getAll()`, `getByProvider()`, `getByServer()`, `getByServerId()`, `markAvailable()`, `markUnavailable()`, `remove()`, `removeBySource()`, `removeByServer()`
- Singleton via `getLLMRegistry()`

**Phase 1: LLMManager Updates (Complete)**
- Added `llmRegistry` property
- Added `getRegistry()` public accessor
- `chat()` tries registry first, falls back to storage
- `getAllModels()`, `getModel()`, `getAvailableModels()` combine registry + storage

**Phase 1: Discovery Updates (Complete)**
- `discoverOllamaModels(baseUrl?, serverId?)` registers to registry
- `discoverClaudeModels()` registers to registry
- `discoverLocalModels()` registers to registry
- ModelId includes server host: `llama3.2:latest@localhost:11434`

**Phase 2: Multi-Server Support (Complete)**
- Added `OllamaServerConfig` interface to `@OneObjectInterfaces.d.ts`
- Updated `GlobalLLMSettingsRecipe` with `ollamaServers` array
- Added server management methods to `GlobalLLMSettingsManager`:
  - `getOllamaServers()`, `getEnabledOllamaServers()`
  - `addOllamaServer()`, `updateOllamaServer()`, `removeOllamaServer()`
  - `setOllamaServerEnabled()`
- Added `discoverFromAllOllamaServers()` to LLMManager
- Added `setGlobalSettingsManager()` setter

**Phase 2: Deprecations (Complete)**
- Marked `setLeuteModel()` as deprecated
- Marked `getAppChannelParticipants()` as deprecated
- Marked `getAllLLMsFromStorage()` as deprecated
- Marked `getLLMFromStorage()` as deprecated
- Storage methods gracefully return empty/null when leuteModel unavailable

### What Remains (Phase 3)

1. **Wire up GlobalLLMSettingsManager** in AIModule initialization
2. **Update LLMConfigPlan** to use registry instead of channels
3. **Remove storage fallback** once all code migrated
4. **Update AIInitializationHandler** to use discoverFromAllOllamaServers()
5. **UI for server management** (add/remove/enable Ollama servers)
