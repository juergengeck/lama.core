# LLMManager Migration Status

**File**: `lama.core/services/llm-manager.ts`
**Original**: `lama.electron/main/services/llm-manager.ts` (1155 lines)
**Status**: Partially refactored

## Completed Changes

✅ **Removed Electron imports**
- Removed `import electron from 'electron'`
- Removed `BrowserWindow` and `ipcMain` destructuring
- Removed `forwardLog()` function (used BrowserWindow.send())

✅ **Added platform abstraction**
- Added `import type { LLMPlatform } from './llm-platform.js'`
- Updated constructor to accept optional `LLMPlatform` parameter
- Added `platform?: LLMPlatform` property

✅ **Refactored config loading**
- Changed `loadOllamaConfig()` to accept config as parameter
- Removed dynamic import of `../ipc/handlers/llm-config.js` (lama.electron specific)
- Config loading now delegated to platform-specific code

## Remaining Work

🔲 **Remove child_process usage**
- Lines with `spawn()` and Node.js process management
- MCP server startup operations (lines 388-450)
- Delegate to `platform?.startMCPServer()` when available

🔲 **Remove mcpManager references**
- Line 379: `await mcpManager.init()`
- Line 382: `mcpManager.getAvailableTools()`
- Line 487: `mcpManager.getToolDescriptions()`
- Line 576: `mcpManager.executeTool()`
- Make all MCP operations optional (only work when platform provides them)

🔲 **Remove file system operations**
- Path operations for MCP server (line 393: `path.join(__dirname, ...)`)
- Delegate to `platform?.readModelFile()` when needed

🔲 **Update service imports**
- Change `import('./ollama.js')` to `import('./ollama.js')` (already correct - no changes needed)
- Change `import('./lmstudio.js')` to correct path (already correct)
- Change `import('./claude.js')` to correct path (already correct)

## Strategy for Completion

The llm-manager.ts file is large (1155 lines) and complex. Recommended approach:

1. **Make MCP operations fully optional**
   - Wrap all MCP calls in `if (this.platform?.startMCPServer) { ... }`
   - Allow LLMManager to work without MCP (browser compatibility)

2. **Create platform-specific MCP adapter**
   - In lama.electron, implement `startMCPServer()` in ElectronLLMPlatform
   - Keep MCP integration in lama.electron, not lama.core

3. **Test in isolation**
   - Verify LLMManager can be instantiated without platform
   - Verify it works with ElectronLLMPlatform
   - Ensure browser compatibility

## Notes

- The current partial refactoring is committed to document progress
- Full migration is substantial enough to be its own feature/task
- Core AI assistant components (AIContactManager, AITopicManager, etc.) are complete and don't depend on this
- LLMManager can be used as-is from lama.electron until full migration is complete
