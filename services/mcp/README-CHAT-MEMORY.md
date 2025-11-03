## Chat-Memory Integration

Automatic extraction of subjects from chat messages and storage as searchable memories.

### Overview

When enabled for a chat topic:
1. Messages are analyzed for subjects and keywords using TopicAnalyzer
2. Subjects are automatically stored as memory assemblies with styling
3. Memories are updated with new information from ongoing conversations
4. Memories are searchable by keywords for context retrieval
5. UI shows memory status and allows toggle per chat

### Architecture

```
Chat Message → TopicAnalyzer → Extract Subjects → Store as Memory
                     ↓                                    ↓
                 Keywords ←──────────────────────── Memory Assembly
                     ↓
              Search/Retrieval ←─────────────── Related Memories
```

### MCP Tools

#### 1. `enable_chat_memories`

Enable automatic memory extraction for a chat topic.

```json
{
  "topicId": "topic-id-hash",
  "autoExtract": true,
  "keywords": ["ai", "research", "quantum"]
}
```

**Returns:**
```
Memories enabled for topic abc123...
Auto-extract: true
Keywords: ai, research, quantum
```

#### 2. `disable_chat_memories`

Disable memory extraction (existing memories remain).

```json
{
  "topicId": "topic-id-hash"
}
```

#### 3. `toggle_chat_memories`

Toggle memories on/off for a chat.

```json
{
  "topicId": "topic-id-hash"
}
```

**Returns:**
```
Memories enabled for topic abc123...
```

#### 4. `extract_chat_subjects`

Manually extract subjects from chat history.

```json
{
  "topicId": "topic-id-hash",
  "limit": 50
}
```

**Returns:**
```
Extracted 5 subjects from 50 messages
Processing time: 1234ms

Subjects:
- Neural Networks (confidence: 0.92)
- Quantum Computing (confidence: 0.85)
- Machine Learning (confidence: 0.78)
```

#### 5. `find_chat_memories`

Find related memories by keywords.

```json
{
  "topicId": "topic-id-hash",
  "keywords": ["neural", "networks", "deep learning"],
  "limit": 10
}
```

**Returns:**
```json
{
  "totalFound": 3,
  "searchKeywords": ["neural", "networks", "deep learning"],
  "memories": [
    {
      "name": "Neural Networks",
      "keywords": ["neural", "networks", "ai", "deep learning"],
      "relevance": "0.87",
      "lastUpdated": "2025-11-03T04:30:00.000Z"
    }
  ]
}
```

#### 6. `get_chat_memory_status`

Get memory extraction status for a chat.

```json
{
  "topicId": "topic-id-hash"
}
```

**Returns:**
```json
{
  "enabled": true,
  "config": {
    "autoExtract": true,
    "updateInterval": 60000,
    "minConfidence": 0.5,
    "keywords": ["ai", "research"]
  }
}
```

### UI Integration (lama.ui)

#### Chat List Card Context Menu

Add a toggle option to the chat card context menu:

```tsx
// In ChatCard.tsx or similar
import { useChatMemories } from '@/hooks/useChatMemories';

function ChatCard({ topic }) {
  const { isEnabled, toggle, loading } = useChatMemories(topic.id);

  const handleToggleMemories = async () => {
    await toggle();
    // Show toast notification
  };

  return (
    <ContextMenu>
      <ContextMenuItem onClick={handleToggleMemories}>
        <Icon name={isEnabled ? 'brain-check' : 'brain'} />
        {isEnabled ? 'Disable Memories' : 'Enable Memories'}
      </ContextMenuItem>
    </ContextMenu>
  );
}
```

#### Hook Implementation

```tsx
// hooks/useChatMemories.ts
export function useChatMemories(topicId: string) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check initial status
    checkStatus();
  }, [topicId]);

  const checkStatus = async () => {
    const result = await mcpExecutor.execute('get_chat_memory_status', {
      topicId
    });
    setIsEnabled(result.content[0].enabled);
  };

  const toggle = async () => {
    setLoading(true);
    try {
      await mcpExecutor.execute('toggle_chat_memories', { topicId });
      setIsEnabled(!isEnabled);
    } finally {
      setLoading(false);
    }
  };

  return { isEnabled, toggle, loading };
}
```

#### Visual Indicator

Show memory status in chat card:

```tsx
function ChatCard({ topic }) {
  const { isEnabled } = useChatMemories(topic.id);

  return (
    <div className="chat-card">
      {isEnabled && (
        <Badge variant="secondary">
          <BrainIcon /> Memories Active
        </Badge>
      )}
      {/* ... rest of card */}
    </div>
  );
}
```

#### Memory Suggestions Panel

Show related memories while chatting:

```tsx
function MemorySuggestionsPanel({ topicId, recentKeywords }) {
  const [memories, setMemories] = useState([]);

  useEffect(() => {
    loadMemories();
  }, [recentKeywords]);

  const loadMemories = async () => {
    const result = await mcpExecutor.execute('find_chat_memories', {
      topicId,
      keywords: recentKeywords,
      limit: 5
    });
    setMemories(result.memories);
  };

  return (
    <aside className="memory-suggestions">
      <h3>Related Memories</h3>
      {memories.map(memory => (
        <MemoryCard key={memory.subjectIdHash} memory={memory} />
      ))}
    </aside>
  );
}
```

### Setup

#### 1. Initialize Services

```typescript
// In platform initialization (lama.electron, lama.cube, etc.)
import { ChatMemoryService } from '@lama/core/services/ChatMemoryService.js';
import { ChatMemoryHandler } from '@lama/core/handlers/ChatMemoryHandler.js';

// Create chat memory service
const chatMemoryService = new ChatMemoryService({
  nodeOneCore,
  topicAnalyzer,          // From one-ai
  memoryHandler,          // MemoryHandler instance
  storeVersionedObject,
  getObjectByIdHash
});

// Create handler
const chatMemoryHandler = new ChatMemoryHandler({
  chatMemoryService
});

// Add to MCP executor
const executor = new MCPToolExecutor({
  nodeOneCore,
  chatMemoryHandler
});
```

#### 2. Auto-Extract on Message

```typescript
// In message handler
async function onNewMessage(topicId, message) {
  // Normal message processing...

  // Check if memories enabled
  if (chatMemoryService.isEnabled(topicId)) {
    const config = chatMemoryService.getConfig(topicId);

    if (config?.autoExtract) {
      // Extract subjects from this message
      await chatMemoryService.extractAndStoreSubjects({
        topicId,
        messageIds: [message.id],
        limit: 1
      });
    }
  }
}
```

#### 3. Periodic Updates

```typescript
// Update memories periodically for active chats
setInterval(async () => {
  for (const [topicId, config] of chatMemoryService.configs) {
    if (config.enabled && config.autoExtract) {
      await chatMemoryService.extractAndStoreSubjects({
        topicId,
        limit: 10  // Last 10 messages
      });
    }
  }
}, 60000);  // Every minute
```

### Features

#### Default Behavior

- **Auto-Extract**: Subjects become memories by default when enabled
- **Update**: Memories get updated with new versions from conversations
- **Keyword Search**: Available as memories for subjects by keywords
- **Per-Chat Toggle**: Enable/disable via chat card context menu

#### Customization

```typescript
// Custom extraction settings
await chatMemoryHandler.enableMemories(topicId, true, [
  'machine-learning',
  'neural-networks',
  'deep-learning'
]);

// Manual extraction
await chatMemoryHandler.extractSubjects({
  topicId,
  limit: 100,  // Last 100 messages
  includeContext: true
});

// Find related with high relevance
const memories = await chatMemoryHandler.findRelatedMemories(
  topicId,
  ['quantum', 'entanglement'],
  5  // Top 5 results
);
```

### Storage

Memories are stored as styled HTML files:

```
memory/subjects/
  ├── chat-topic-123-neural-networks.html
  ├── chat-topic-123-quantum-computing.html
  └── chat-topic-456-machine-learning.html
```

Each file contains:
- Subject name and description
- Keywords from chat
- Metadata (confidence, extractedFrom, timestamp)
- Excerpt from relevant messages
- Beautiful CSS styling
- Optional cryptographic signature

### Benefits

1. **Automatic Knowledge Capture**: No manual note-taking
2. **Contextual Retrieval**: Find relevant past discussions
3. **Version Tracking**: Memories evolve with conversations
4. **Keyword Discovery**: Learn topic keywords organically
5. **Beautiful Output**: Styled HTML for sharing/archiving
6. **Privacy Control**: Per-chat enable/disable

### Performance

- Extraction runs async, doesn't block chat
- Uses confidence thresholds to reduce noise
- Deduplicates subjects automatically
- Caches associations for fast lookup
- Periodic updates configurable per chat

### Error Handling

```typescript
try {
  await chatMemoryHandler.extractSubjects({ topicId });
} catch (error) {
  if (error.message.includes('not enabled')) {
    // Memories not enabled for this chat
  } else if (error.message.includes('analyzer not available')) {
    // TopicAnalyzer not initialized
  }
}
```

### See Also

- `ChatMemoryService.ts` - Core service implementation
- `ChatMemoryHandler.ts` - Handler for MCP integration
- `chat-memory-types.ts` - Type definitions
- `README-MEMORY.md` - Memory module documentation
