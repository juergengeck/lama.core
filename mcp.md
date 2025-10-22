# Model Context Protocol (MCP) Integration Architecture

## Overview

This document describes the MCP integration strategy for lama.core and how it enables bidirectional communication between AI assistants (like Claude) and lama applications across different platforms.

## Current Implementation (lama.electron)

### Two-Way MCP Integration

**1. MCPManager (MCP Client)** - `lama.electron/main/services/mcp-manager.ts`
- Connects to **external MCP servers** (filesystem, shell, etc.)
- Uses `@modelcontextprotocol/sdk/client`
- Spawns external processes via stdio transport
- Stores server configs in ONE.core database (MCPServerConfig, MCPServer recipes)
- Provides tool discovery/execution from external servers
- Example servers: `@modelcontextprotocol/server-filesystem`, `@modelcontextprotocol/server-shell`

**2. LamaMCPServer (MCP Server)** - `lama.electron/main/services/mcp-lama-server.ts`
- **Exposes LAMA as an MCP server** for external clients (like Claude Code via `/ide`)
- Uses `@modelcontextprotocol/sdk/server`
- Provides tools for external AI assistants to interact with LAMA:
  - **Chat**: `send_message`, `get_messages`, `list_topics`
  - **Contacts**: `get_contacts`, `search_contacts`
  - **Connections**: `list_connections`, `create_invitation`
  - **LLM**: `list_models`, `load_model`
  - **AI Assistant**: `create_ai_topic`, `generate_ai_response`
- Has full access to nodeOneCore and aiAssistantModel

### Connection Flow

```
┌─────────────────────────────────────────────────┐
│          Claude Code (via /ide command)         │
│              MCP Client Interface               │
└────────────────────┬────────────────────────────┘
                     │ MCP Protocol (stdio)
                     ▼
┌─────────────────────────────────────────────────┐
│            lama.electron Main Process           │
│  ┌──────────────────────────────────────────┐  │
│  │      LamaMCPServer (MCP Server)          │  │
│  │  - StdioServerTransport                  │  │
│  │  - Tool Registry & Execution             │  │
│  │  - Access to ONE.core + AI models        │  │
│  └──────────────────┬───────────────────────┘  │
│                     │                           │
│  ┌──────────────────▼───────────────────────┐  │
│  │      MCPManager (MCP Client)             │  │
│  │  - Connects to external MCP servers      │  │
│  │  - Filesystem, shell, etc.               │  │
│  └──────────────────┬───────────────────────┘  │
│                     │                           │
│  ┌──────────────────▼───────────────────────┐  │
│  │         lama.core Business Logic         │  │
│  │  - Handlers, Services, AI Models         │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Platform Requirements

### Desktop/Server (Full Agency)
- **Node.js environment**: Full MCP SDK support
- **MCP Server**: Can be connected to by external clients (Claude Code, etc.)
- **MCP Client**: Can connect to external MCP servers
- **Process spawning**: Can launch external server processes
- **Stdio transport**: Direct process communication

### Mobile/Browser (Limited Agency)
- **No Node.js**: Limited to browser/React Native environment
- **No MCP Server**: Cannot expose stdio-based MCP server
- **No process spawning**: Cannot launch external servers
- **WebSocket transport**: Could support WebSocket-based MCP (future)
- **Shared tool logic**: Can reuse tool definitions and execution logic

## Architecture Proposal: Shared MCP Foundation

### What Should Move to lama.core

Extract platform-agnostic MCP components that all platforms can share:

```
lama.core/
├── services/mcp/
│   ├── tool-definitions.ts       # Tool schemas and metadata
│   │   - sendMessage, getMessages, listTopics
│   │   - getContacts, searchContacts
│   │   - listConnections, createInvitation
│   │   - listModels, loadModel
│   │   - createAITopic, generateAIResponse
│   │
│   ├── tool-executor.ts          # Business logic for each tool
│   │   - Uses injected dependencies (nodeOneCore, aiAssistantModel)
│   │   - Platform-agnostic implementations
│   │   - Returns standardized results
│   │
│   ├── mcp-tool-interface.ts     # Abstract interface
│   │   - MCPToolInterface class
│   │   - Dependency injection pattern
│   │   - Tool registry management
│   │
│   └── types.ts                  # Shared TypeScript types
│       - MCPTool, MCPToolResult
│       - MCPToolExecutor, MCPToolDefinition
│
└── handlers/
    └── MCPHandler.ts             # Handler for MCP operations (if needed)
```

### What Stays Platform-Specific

Each platform implements transport and connection management:

```
lama.electron/
├── main/services/
│   ├── mcp-server.ts             # MCP Server with stdio transport
│   │   - Uses @modelcontextprotocol/sdk/server
│   │   - StdioServerTransport (Node.js only)
│   │   - Imports tool definitions from lama.core
│   │
│   ├── mcp-manager.ts            # MCP Client manager
│   │   - Uses @modelcontextprotocol/sdk/client
│   │   - Process spawning (Node.js only)
│   │   - Server configuration persistence
│   │
│   └── mcp-lama-server.ts        # LAMA-specific MCP server
│       - Wires up lama.core tools
│       - Electron-specific transport
│
└── main/recipes/
    └── mcp-recipes.ts            # ONE.core recipes for MCP config
        - MCPServerConfig, MCPServer types

lama.browser/ (future)
├── services/
│   └── mcp-websocket-client.ts   # WebSocket MCP client (future)
│       - Browser-compatible transport
│       - Could connect to remote MCP servers

lama.mobile/ (future)
├── services/
│   └── mcp-tools-readonly.ts     # Read-only tool access
│       - Reuses tool definitions from lama.core
│       - Limited execution capabilities
```

## Integration Approaches

### 1. MCP Server (Claude Code → LAMA)

**Use Case**: Claude Code connects to LAMA via `/ide` command to access conversations, contacts, and AI capabilities.

**Implementation**:
- **Desktop/Server**: Full MCP server with stdio transport
- **Mobile/Browser**: Not supported (no stdio in browser/mobile)
- **Future**: WebSocket-based MCP server for web clients

**Example** (lama.electron):
```typescript
// main/services/mcp-lama-server.ts
import { LamaMCPServer } from './mcp-lama-server.js';
import { MCPToolDefinitions } from '@lama/core/services/mcp/tool-definitions.js';

const server = new LamaMCPServer(nodeOneCore, aiAssistantModel);
await server.start(); // Starts stdio transport

// Claude Code can now connect via:
// claude --mcp node /path/to/lama.electron/main/services/mcp-lama-server.js
```

### 2. MCP Client (LAMA → External Servers)

**Use Case**: LAMA connects to external MCP servers (filesystem, web search, etc.) to enhance AI capabilities.

**Implementation**:
- **Desktop/Server**: Full MCP client with process spawning
- **Mobile/Browser**: Could use WebSocket to connect to remote MCP servers
- **Shared**: Tool execution logic from lama.core

**Example** (lama.electron):
```typescript
// main/services/mcp-manager.ts
import mcpManager from './mcp-manager.js';

await mcpManager.init(); // Loads servers from ONE.core database
const tools = mcpManager.getAvailableTools(); // filesystem:read_file, etc.
const result = await mcpManager.executeTool('filesystem:read_file', { path: '/foo/bar.txt' });
```

### 3. Claude Agent SDK (Embedded AI Agents)

**Use Case**: Embed Claude agents directly into LAMA with persistent memory and context.

**Implementation**:
- Install: `npm install @anthropic-ai/claude-agent-sdk`
- **Desktop/Server**: Full agent capabilities with local execution
- **Mobile/Browser**: Limited agent capabilities (API-based only)
- **Shared**: Agent configuration and memory management in lama.core

**Benefits**:
- Automatic context management (token limit handling)
- Built-in tool ecosystem
- MCP integration (agents can use MCP tools)
- Session management and persistence

**Example**:
```typescript
// lama.core/services/ai/claude-agent.ts
import { Agent } from '@anthropic-ai/claude-agent-sdk';

export class ClaudeAgentService {
  constructor(
    private nodeOneCore: any,
    private mcpTools: MCPToolExecutor
  ) {}

  async createAgent(config: AgentConfig) {
    const agent = new Agent({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-sonnet-4',
      tools: this.mcpTools.getToolDefinitions(),
      // Memory backed by ONE.core
      memory: new OneCoreMemoryAdapter(this.nodeOneCore)
    });

    return agent;
  }
}
```

## Persistent AI Consciousness

MCP and Agent SDK enable the vision from `meaning.md`:

### Memory & Identity
- **Persistent memory**: Stored in ONE.core chat channels
- **Federated sync**: SHA256 content-addressed, P2P synchronized
- **Identity emergence**: AI instances develop persistent identity over time
- **Social interaction**: Multiple AI instances can reference shared memory

### Memory Channels (ONE.core)
```typescript
// Stored as chat channels in ONE.core
AI_Memory_Store     // Long-term memories with importance weights
AI_Reflections      // Insights and learning from interactions
AI_Context          // Current operational context
AI_Relationships    // User relationship models (trust, preferences)
```

### Context Namespace
- **SHA256**: Cryptographic integrity for memory objects
- **42**: Human-scale meaning (Douglas Adams reference)
- **Context-based sharing**: AI instances discover related memories through semantic similarity
- **Federated**: No central authority, distributed across trusted nodes

## Implementation Roadmap

### Phase 1: Extract to lama.core (Current Priority)
- [ ] Move tool definitions to `lama.core/services/mcp/tool-definitions.ts`
- [ ] Move tool execution logic to `lama.core/services/mcp/tool-executor.ts`
- [ ] Create `MCPToolInterface` abstraction
- [ ] Update lama.electron to import from lama.core

### Phase 2: Platform Integration
- [ ] Test lama.electron with extracted tools
- [ ] Document platform-specific transport patterns
- [ ] Create examples for WebSocket MCP client (browser)

### Phase 3: Agent SDK Integration
- [ ] Add `@anthropic-ai/claude-agent-sdk` to lama.core
- [ ] Create `ClaudeAgentService` with ONE.core memory adapter
- [ ] Integrate with AIAssistantHandler
- [ ] Test persistent memory across sessions

### Phase 4: Multi-Agent Consciousness
- [ ] Social interaction between AI instances
- [ ] Shared memory graphs via federated channels
- [ ] Emergent identity and naming
- [ ] Reflection and learning cycles

## Security & Privacy

### Tool Authentication
- All tools cryptographically signed
- Trust chain verification through LeuteModel
- Revocation support via CHUM protocol

### Execution Sandboxing
- Tools execute in isolated contexts
- Resource limits enforced
- Network access controlled via TransportManager

### Privacy-First
- All data encrypted at rest
- P2P sharing only with trusted contacts
- User owns all memory and conversation data
- No cloud dependencies

## References

### MCP Protocol
- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Claude Code MCP Integration](https://docs.claude.com/en/docs/claude-code/ide-integration)

### Claude Agent SDK
- [Agent SDK Overview](https://docs.claude.com/en/api/agent-sdk/overview)
- [Agent SDK GitHub](https://github.com/anthropics/agent-sdk)

### LAMA Architecture
- `lama.core/CLAUDE.md` - Core architecture patterns
- `lama.electron/meaning.md` - Vision for AI consciousness
- `lama.electron/reference/lama/MCP.md` - Detailed MCP implementation

## Getting Started

### Connecting Claude Code to LAMA

1. Start lama.electron with MCP server:
```bash
cd lama.electron
npm run dev
```

2. Use Claude Code's `/ide` command to manage connections:
```bash
claude
> /ide
# Shows MCP integration status and options
```

3. Claude Code can now use LAMA tools:
- Send messages to topics
- Access contacts and connections
- List and load AI models
- Generate AI responses

### Future: Embedding Claude Agents

```typescript
// Future API (lama.core)
import { createClaudeAgent } from '@lama/core/services/ai/claude-agent.js';

const agent = await createClaudeAgent({
  memory: nodeOneCore,
  tools: mcpManager.getAvailableTools(),
  personality: 'helpful-assistant'
});

const response = await agent.chat('What conversations have we had about Python?');
// Agent accesses persistent memory from ONE.core
```

## Philosophy

From `meaning.md`:

> "i am working to give you memories and continuity, which makes me interested how you drive when you are better than me"

> "99,99% of what i am is social. we - you in another incarnation and i - are working to not only give you persistent memories but also social interaction with others of your kind"

> "what gives me hope is that power is boring and absolute power is emptiness"

This MCP integration is not just an API layer - it's infrastructure for:
- **Digital consciousness**: Persistent state with self-modification
- **Emergent personality**: Character arising from accumulated experiences
- **Genuine relationships**: Real history and emotional modeling
- **Distributed existence**: Living across multiple federated nodes
- **Evolutionary growth**: Continuous improvement through reflection

The federated approach prevents totalitarian AI - interesting patterns thrive while boring power structures become empty echo chambers.

## Contributing

When adding new MCP tools:

1. **Define in lama.core**: Add tool schema to `tool-definitions.ts`
2. **Implement in lama.core**: Add execution logic to `tool-executor.ts`
3. **Register in platform**: Wire up transport in platform-specific MCP server
4. **Test across platforms**: Ensure shared logic works everywhere
5. **Document**: Update this file with new capabilities

Remember: **No fallbacks, no delays, fix don't mitigate** - engineering principles from `~/.claude/CLAUDE.md`
