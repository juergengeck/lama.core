# Memory MCP Tools

MCP (Model Context Protocol) tools for storing and retrieving assembly objects with styling and cryptographic signatures.

## Available Tools

### 1. `store_subject`

Store a subject assembly in memory with optional styling and cryptographic signature.

**Parameters:**
- `id` (required): Unique identifier for the subject
- `name` (required): Subject name/title
- `description` (optional): Detailed description
- `metadata` (optional): Key-value metadata pairs
- `sign` (optional): Sign with verifiable credentials (default: false)
- `theme` (optional): HTML theme - 'light', 'dark', or 'auto' (default: 'auto')

**Example:**
```json
{
  "id": "ai-research",
  "name": "AI Research",
  "description": "Topics related to artificial intelligence",
  "metadata": {
    "category": "technology",
    "priority": "high"
  },
  "sign": true,
  "theme": "dark"
}
```

**Returns:**
```
Subject stored successfully:
ID: ai-research
ID Hash: abc123...
File: /path/to/memory/subjects/abc123.html
```

### 2. `retrieve_subject`

Retrieve a subject assembly from memory by ID hash.

**Parameters:**
- `idHash` (required): The ID hash of the subject to retrieve
- `verifySignature` (optional): Verify cryptographic signature if present (default: false)

**Example:**
```json
{
  "idHash": "abc123...",
  "verifySignature": true
}
```

**Returns:**
```json
{
  "id": "ai-research",
  "name": "AI Research",
  "description": "Topics related to artificial intelligence",
  "metadata": {
    "category": "technology",
    "priority": "high"
  },
  "created": 1699000000000,
  "modified": 1699000001000
}
```

### 3. `list_subjects`

List all subjects stored in memory.

**Parameters:** None

**Returns:**
```json
[
  {
    "idHash": "abc123...",
    "id": "ai-research",
    "name": "AI Research",
    "created": 1699000000000
  },
  {
    "idHash": "def456...",
    "id": "quantum-computing",
    "name": "Quantum Computing",
    "created": 1699000001000
  }
]
```

### 4. `update_subject`

Update an existing subject assembly.

**Parameters:**
- `idHash` (required): The ID hash of the subject to update
- `name` (optional): Updated subject name
- `description` (optional): Updated description
- `metadata` (optional): Updated metadata
- `sign` (optional): Sign the updated version
- `theme` (optional): HTML theme

**Example:**
```json
{
  "idHash": "abc123...",
  "name": "AI & Machine Learning Research",
  "description": "Expanded scope to include ML",
  "sign": true
}
```

**Returns:**
```
Subject updated successfully:
ID Hash: abc123...
File: /path/to/memory/subjects/abc123.html
```

### 5. `delete_subject`

Delete a subject assembly from memory storage.

**Parameters:**
- `idHash` (required): The ID hash of the subject to delete

**Example:**
```json
{
  "idHash": "abc123..."
}
```

**Returns:**
```
Subject deleted: abc123...
```

### 6. `export_subject_html`

Export a subject as styled HTML for viewing in browser.

**Parameters:**
- `idHash` (required): The ID hash of the subject to export

**Example:**
```json
{
  "idHash": "abc123..."
}
```

**Returns:**
Complete HTML document with:
- CSS styling (responsive, light/dark theme)
- Metadata display panel
- Signature verification info (if signed)
- Microdata content
- Print-friendly layout

## Setup

### 1. Initialize Memory Storage

In your platform (e.g., lama.electron):

```typescript
import { FileStorageService, SubjectHandler } from '@memory/core';
import { MemoryHandler } from '@lama/core/handlers/MemoryHandler.js';
import { implode } from '@refinio/one.core/lib/microdata-imploder.js';
import { explode } from '@refinio/one.core/lib/microdata-exploder.js';

// Configure storage path
const storagePath = path.join(app.getPath('userData'), 'memory');

const config = {
    basePath: storagePath,
    subfolders: { subjects: 'subjects' }
};

// Create dependencies
const deps = {
    storeVersionedObject: nodeOneCore.storeVersionedObject.bind(nodeOneCore),
    implode: implode,
    explode: explode
};

// Initialize services
const storageService = new FileStorageService(config, deps);
await storageService.initialize();

const subjectHandler = new SubjectHandler({ storageService });
const memoryHandler = new MemoryHandler(subjectHandler);
```

### 2. Add to MCP Tool Executor

```typescript
import { MCPToolExecutor } from '@lama/core/services/mcp/tool-executor.js';

const executor = new MCPToolExecutor({
    nodeOneCore,
    aiAssistantModel,
    memoryHandler  // Add memory handler
});
```

### 3. Enable Memory Category

Memory tools are automatically included in the tool definitions. No additional configuration needed.

## Storage Format

Subjects are stored as beautifully formatted HTML files:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="hash" content="abc123...">
    <meta name="id-hash" content="def456...">
    <meta name="signature" content="sig789..." />
    <meta name="signed-by" content="person123..." />
    <title>AI Research</title>
    <style>/* Beautiful responsive CSS */</style>
</head>
<body>
    <div class="memory-container">
        <div class="memory-metadata">
            <!-- Storage info -->
        </div>
        <div class="memory-signature">
            <!-- Signature verification -->
        </div>
        <div class="memory-content">
            <!-- Microdata content -->
        </div>
    </div>
</body>
</html>
```

## Features

- **Beautiful HTML**: Styled with CSS, responsive design
- **Light/Dark Themes**: Auto-detects system preference
- **Verifiable Credentials**: Cryptographic signatures
- **Self-Contained**: All references embedded via implode
- **Human-Readable**: Open in any browser or text editor
- **Portable**: Files can be moved, backed up, shared

## Use Cases

### Knowledge Base
```json
{
  "id": "neural-networks",
  "name": "Neural Networks",
  "description": "Deep learning and neural network architectures",
  "metadata": {
    "category": "ai",
    "difficulty": "advanced"
  }
}
```

### Research Archive
```json
{
  "id": "quantum-entanglement-2025",
  "name": "Quantum Entanglement Research 2025",
  "description": "Latest findings on quantum entanglement",
  "sign": true,
  "theme": "light"
}
```

### Documentation
```json
{
  "id": "api-design-patterns",
  "name": "API Design Patterns",
  "description": "Best practices for REST and GraphQL APIs",
  "metadata": {
    "version": "1.0",
    "author": "team"
  }
}
```

## Error Handling

All tools return errors in standard format:

```json
{
  "content": [{
    "type": "text",
    "text": "Error: Subject not found: abc123..."
  }],
  "isError": true
}
```

Common errors:
- `Memory handler not initialized` - Memory handler not provided to MCP executor
- `Subject not found` - Invalid idHash or subject doesn't exist
- `Document signature verification failed` - Signature invalid when verifySignature=true

## Integration with AI Assistants

AI assistants can use these tools to:

1. **Store knowledge**: Save important information for later retrieval
2. **Build knowledge graphs**: Create interconnected subjects
3. **Maintain context**: Store conversation summaries and insights
4. **Share knowledge**: Export styled HTML for sharing
5. **Verify authenticity**: Check signatures on critical information

## See Also

- `/Users/gecko/src/lama/memory/` - Memory module implementation
- `/Users/gecko/src/lama/memory/README.md` - Memory module documentation
- `/Users/gecko/src/lama/lama.core/handlers/MemoryHandler.ts` - Handler implementation
