/**
 * LLMPlatform Interface
 *
 * Platform abstraction for LLM operations. This interface allows lama.core
 * components to emit events and perform platform-specific operations without
 * depending on Electron, Browser, or React Native APIs.
 *
 * Implementations:
 * - Electron: Uses BrowserWindow.webContents.send() for UI events
 * - Browser: Uses postMessage() or custom event system
 * - React Native: Uses native event emitters
 */

export interface LLMPlatform {
  /**
   * Emit progress update during LLM generation
   * @param topicId - Topic/conversation ID
   * @param progress - Progress value (0.0 to 1.0)
   */
  emitProgress(topicId: string, progress: number): void;

  /**
   * Emit error during LLM operation
   * @param topicId - Topic/conversation ID
   * @param error - Error object with message
   */
  emitError(topicId: string, error: Error): void;

  /**
   * Emit message update (streaming or completion)
   * @param topicId - Topic/conversation ID
   * @param messageId - Message identifier
   * @param text - Message text (partial or complete)
   * @param status - Message status ('pending' | 'streaming' | 'complete' | 'error')
   */
  emitMessageUpdate(
    topicId: string,
    messageId: string,
    text: string,
    status: string
  ): void;

  /**
   * Start MCP (Model Context Protocol) server (optional - only for platforms with child process support)
   * @param modelId - Model identifier
   * @param config - MCP server configuration
   */
  startMCPServer?(modelId: string, config: any): Promise<void>;

  /**
   * Stop MCP server (optional - only for platforms with child process support)
   * @param modelId - Model identifier
   */
  stopMCPServer?(modelId: string): Promise<void>;

  /**
   * Read model file from disk (optional - only for platforms with file system)
   * @param path - File path
   * @returns File contents as Buffer
   */
  readModelFile?(path: string): Promise<Buffer>;
}

/**
 * Null implementation for testing or headless environments
 */
export class NullLLMPlatform implements LLMPlatform {
  emitProgress(_topicId: string, _progress: number): void {
    // No-op
  }

  emitError(_topicId: string, _error: Error): void {
    // No-op
  }

  emitMessageUpdate(
    _topicId: string,
    _messageId: string,
    _text: string,
    _status: string
  ): void {
    // No-op
  }
}
