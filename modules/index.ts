// packages/lama.core/modules/index.ts

/**
 * Shared platform-agnostic modules for LAMA applications
 *
 * All modules follow dependency injection pattern:
 * - NO browser-specific imports (no Electron, no DOM APIs)
 * - Platform-specific dependencies injected via constructor
 * - Module interface from @refinio/api for standardized lifecycle
 */

export { CoreModule } from './CoreModule.js';
export { AIModule, type LLMConfigAdapter } from './AIModule.js';
export { ChatModule } from './ChatModule.js';
export { TrustModule } from './TrustModule.js';
export { ConnectionModule } from './ConnectionModule.js';
export { AnalysisModule } from './AnalysisModule.js';
export { MemoryModule } from './MemoryModule.js';
export { DeviceModule } from './DeviceModule.js';
export { JournalModule } from './JournalModule.js';
export { MCPModule } from './MCPModule.js';
