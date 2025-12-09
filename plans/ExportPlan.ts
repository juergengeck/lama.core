/**
 * ExportPlan - Generic ONE Object Export
 *
 * Platform-agnostic plan for exporting any ONE.core objects with microdata.
 * Uses implode() from one.core to recursively embed referenced objects.
 * Works identically on Electron, Browser, and iOS.
 *
 * Responsibilities:
 * - Export single or multiple ONE objects with implode()
 * - Generate HTML documents with embedded microdata
 * - Provide raw microdata or formatted HTML output
 *
 * NOT responsible for:
 * - Saving files (platform-specific: fs in Node, download in browser)
 * - File dialogs (platform-specific)
 */

import { implode } from '@refinio/one.core/lib/microdata-imploder.js';
import type { SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';

// ============================================================================
// Types
// ============================================================================

export type ExportFormat = 'microdata' | 'html' | 'json';
export type ExportTheme = 'light' | 'dark' | 'auto';

export interface ExportOptions {
  format?: ExportFormat;
  theme?: ExportTheme;
  title?: string;
  includeSignatures?: boolean;
  batchSize?: number;
}

export interface ExportObjectRequest {
  hash: string;
  options?: ExportOptions;
}

export interface ExportObjectResponse {
  success: boolean;
  data?: string;
  error?: string;
}

export interface ExportCollectionRequest {
  hashes: string[];
  options?: ExportOptions;
  metadata?: {
    title?: string;
    participants?: Array<{ name: string; email?: string }>;
    dateRange?: { start?: string; end?: string };
  };
}

export interface ExportCollectionResponse {
  success: boolean;
  data?: string;
  metadata?: {
    objectCount: number;
    exportDate: string;
    byteSize: number;
  };
  error?: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface ExportMessageRequest {
  format: string;
  content: string;
  metadata: {
    messageId?: string;
    [key: string]: any;
  };
}

export interface ExportMessageResponse {
  success: boolean;
  filename: string;
  fileContent: string;
  filters: FileFilter[];
  error?: string;
}

// Chat-specific export types (merged from chat.core)
export interface Message {
  hash: string;
  author: {
    name: string;
    email: string;
    personHash?: string;
  };
  timestamp: string;
  content: string;
  signature?: any;
  isOwn?: boolean;
}

export interface ExportHtmlWithMicrodataRequest {
  topicId: string;
  format: string;
  messages?: Message[];  // Pre-fetched messages (caller retrieves)
  options?: ExportHtmlOptions;
}

export interface ExportHtmlOptions {
  includeSignatures?: boolean;
  maxMessages?: number;
  timeout?: number;
  styleTheme?: 'light' | 'dark' | 'auto';
  dateRange?: {
    start?: string;
    end?: string;
  };
  [key: string]: any;
}

export interface ExportHtmlWithMicrodataResponse {
  success: boolean;
  html?: string;
  metadata?: {
    messageCount: number;
    exportDate: string;
    topicId: string;
    fileSize: number;
    participants?: Array<{ name: string; email?: string }>;
    dateRange?: { start?: string; end?: string } | null;
  };
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// ExportPlan
// ============================================================================

export class ExportPlan {
  /**
   * Export a single ONE object with implode
   */
  async exportObject(request: ExportObjectRequest): Promise<ExportObjectResponse> {
    try {
      const { hash, options = {} } = request;
      const { format = 'microdata' } = options;

      // Get imploded microdata
      const microdata = await implode(hash as SHA256Hash);

      // Add hash attribute if not present
      const microdataWithHash = this.addHashAttribute(microdata, hash);

      // Return based on format
      if (format === 'microdata') {
        return { success: true, data: microdataWithHash };
      }

      if (format === 'html') {
        const html = this.wrapInHTML(microdataWithHash, options);
        return { success: true, data: html };
      }

      // JSON format - extract data from microdata
      return { success: true, data: JSON.stringify({ hash, microdata: microdataWithHash }, null, 2) };

    } catch (error) {
      return {
        success: false,
        error: `Export failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * Export multiple ONE objects
   */
  async exportCollection(request: ExportCollectionRequest): Promise<ExportCollectionResponse> {
    try {
      const { hashes, options = {}, metadata = {} } = request;
      const { format = 'html', batchSize = 50 } = options;

      if (!hashes || hashes.length === 0) {
        return {
          success: true,
          data: format === 'html' ? this.generateEmptyHTML(metadata.title) : '[]',
          metadata: { objectCount: 0, exportDate: new Date().toISOString(), byteSize: 0 }
        };
      }

      // Process in batches to avoid memory issues
      const implodedObjects: string[] = [];

      for (let i = 0; i < hashes.length; i += batchSize) {
        const batch = hashes.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(hash => this.implodeWithHash(hash))
        );
        implodedObjects.push(...batchResults);
      }

      // Generate output based on format
      let data: string;

      if (format === 'microdata') {
        data = implodedObjects.join('\n');
      } else if (format === 'json') {
        data = JSON.stringify(implodedObjects.map((m, i) => ({ hash: hashes[i], microdata: m })), null, 2);
      } else {
        // HTML format with full document
        data = this.generateCompleteHTML({
          title: metadata.title || 'LAMA Export',
          participants: metadata.participants || [],
          dateRange: metadata.dateRange,
          objectCount: hashes.length,
          objects: implodedObjects,
          theme: options.theme || 'light'
        });
      }

      const byteSize = new TextEncoder().encode(data).length;

      return {
        success: true,
        data,
        metadata: {
          objectCount: hashes.length,
          exportDate: new Date().toISOString(),
          byteSize
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Collection export failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * Export message content - prepares filename and content based on format
   * This is a simple format conversion helper used by IPC handlers
   */
  async exportMessage(request: ExportMessageRequest): Promise<ExportMessageResponse> {
    try {
      const { format, content, metadata } = request;
      let filename: string;
      let filters: FileFilter[];

      switch (format) {
        case 'markdown':
          filename = `message-${metadata.messageId || Date.now()}.md`;
          filters = [
            { name: 'Markdown Files', extensions: ['md'] },
            { name: 'All Files', extensions: ['*'] }
          ];
          break;

        case 'html':
          filename = `message-${metadata.messageId || Date.now()}.html`;
          filters = [
            { name: 'HTML Files', extensions: ['html', 'htm'] },
            { name: 'All Files', extensions: ['*'] }
          ];
          break;

        case 'json':
          filename = `message-${metadata.messageId || Date.now()}.json`;
          filters = [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
          ];
          break;

        case 'onecore':
          filename = `message-${metadata.messageId || Date.now()}.onecore`;
          filters = [
            { name: 'ONE.core Files', extensions: ['onecore'] },
            { name: 'All Files', extensions: ['*'] }
          ];
          break;

        default:
          filename = `message-${metadata.messageId || Date.now()}.txt`;
          filters = [
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
          ];
      }

      return {
        success: true,
        filename,
        fileContent: content,
        filters
      };
    } catch (error) {
      return {
        success: false,
        filename: '',
        fileContent: '',
        filters: [],
        error: (error as Error).message
      };
    }
  }

  /**
   * Export conversation as HTML with microdata markup
   * Uses ONE.core's implode() to embed referenced objects.
   *
   * Caller should pre-fetch messages and pass them in request.messages.
   * If messages not provided, returns empty conversation HTML.
   */
  async exportHtmlWithMicrodata(
    request: ExportHtmlWithMicrodataRequest
  ): Promise<ExportHtmlWithMicrodataResponse> {
    try {
      const { topicId, format, messages = [], options = {} } = request;

      // Validate input parameters
      const validationResult = this.validateExportRequest({ topicId, format, options });
      if (!validationResult.valid) {
        return {
          success: false,
          error: validationResult.error
        };
      }

      // Handle empty messages
      if (messages.length === 0) {
        return {
          success: true,
          html: this.generateEmptyConversationHTML(topicId, options),
          metadata: {
            messageCount: 0,
            exportDate: new Date().toISOString(),
            topicId,
            fileSize: 0
          }
        };
      }

      // Process messages with implode
      const processedMessages: string[] = [];
      for (const message of messages) {
        try {
          const implodedData = await this.implodeWithHash(message.hash);

          // Add signature if available
          let finalData = implodedData;
          if (options.includeSignatures !== false && message.signature) {
            finalData = this.addSignatureAttribute(finalData, message.signature);
          }

          // Add timestamp
          if (message.timestamp) {
            finalData = this.addTimestampAttribute(finalData, message.timestamp);
          }

          // Format for display with author styling
          const formattedMessage = this.formatMessageHtml(finalData, {
            isOwn: message.isOwn || false,
            author: message.author
          });

          processedMessages.push(formattedMessage);
        } catch (error) {
          // Continue with other messages
          processedMessages.push(
            `<div class="message error">Error processing message: ${(error as Error).message}</div>`
          );
        }
      }

      // Generate metadata
      const metadata = this.generateConversationMetadata(topicId, messages, options);

      // Generate HTML document
      const htmlDocument = this.generateCompleteHTML({
        title: metadata.title,
        participants: metadata.participants,
        dateRange: metadata.dateRange || undefined,
        objectCount: messages.length,
        objects: processedMessages,
        theme: (options.styleTheme as ExportTheme) || 'light'
      });

      const fileSize = new TextEncoder().encode(htmlDocument).length;

      return {
        success: true,
        html: htmlDocument,
        metadata: {
          ...metadata,
          fileSize,
          exportDate: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Export failed: ${(error as Error).message}`
      };
    }
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Validate export request parameters
   */
  private validateExportRequest({
    topicId,
    format,
    options = {}
  }: {
    topicId: string;
    format: string;
    options?: ExportHtmlOptions;
  }): ValidationResult {
    if (!topicId || typeof topicId !== 'string' || topicId.trim() === '') {
      return { valid: false, error: 'topicId is required and must be a non-empty string' };
    }

    if (!format || format !== 'html-microdata') {
      return { valid: false, error: 'format must be "html-microdata"' };
    }

    if (options.maxMessages && (typeof options.maxMessages !== 'number' || options.maxMessages <= 0)) {
      return { valid: false, error: 'maxMessages must be a positive number' };
    }

    if (options.maxMessages && options.maxMessages > 10000) {
      return { valid: false, error: 'maxMessages cannot exceed 10,000' };
    }

    if (options.styleTheme && !['light', 'dark', 'auto'].includes(options.styleTheme)) {
      return { valid: false, error: 'styleTheme must be "light", "dark", or "auto"' };
    }

    if (options.dateRange) {
      const { start, end } = options.dateRange;
      if (start && end && new Date(start) >= new Date(end)) {
        return { valid: false, error: 'date range start must be before end' };
      }
    }

    return { valid: true };
  }

  /**
   * Generate metadata for conversation export
   */
  private generateConversationMetadata(
    topicId: string,
    messages: Message[],
    options: ExportHtmlOptions
  ): {
    title: string;
    topicId: string;
    messageCount: number;
    participants: Array<{ name: string; email?: string }>;
    dateRange: { start: string; end: string } | null;
  } {
    // Extract unique participants
    const participants: Array<{ name: string; email?: string }> = [];
    const seenEmails = new Set<string>();

    for (const message of messages) {
      if (message.author?.email && !seenEmails.has(message.author.email)) {
        participants.push({
          name: message.author.name,
          email: message.author.email
        });
        seenEmails.add(message.author.email);
      }
    }

    // Calculate date range
    const timestamps = messages
      .map(m => new Date(m.timestamp))
      .filter(d => !isNaN(d.getTime()));

    const dateRange = timestamps.length > 0
      ? {
          start: new Date(Math.min(...timestamps.map(d => d.getTime()))).toISOString(),
          end: new Date(Math.max(...timestamps.map(d => d.getTime()))).toISOString()
        }
      : null;

    return {
      title: `Conversation ${topicId}`,
      topicId,
      messageCount: messages.length,
      participants,
      dateRange
    };
  }

  /**
   * Generate HTML for empty conversation
   */
  private generateEmptyConversationHTML(topicId: string, options: ExportHtmlOptions): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Empty Conversation</title>
  <style>
    body { font-family: sans-serif; text-align: center; padding: 50px; }
    .empty-message { color: #666; font-size: 1.2em; }
  </style>
</head>
<body>
  <div class="empty-message">
    <h1>Empty Conversation</h1>
    <p>No messages found for topic: ${this.escapeHTML(topicId)}</p>
  </div>
</body>
</html>`;
  }

  /**
   * Add signature attribute to microdata
   */
  private addSignatureAttribute(microdata: string, signature: any): string {
    const sigStr = typeof signature === 'string' ? signature : JSON.stringify(signature);
    const rootMatch = String(microdata).match(/^(<[^>]+)(>)/);
    if (rootMatch) {
      const [, openTag, closeChar] = rootMatch;
      return microdata.replace(rootMatch[0], `${openTag} data-signature="${this.escapeHTML(sigStr)}"${closeChar}`);
    }
    return microdata;
  }

  /**
   * Add timestamp attribute to microdata
   */
  private addTimestampAttribute(microdata: string, timestamp: string): string {
    const rootMatch = String(microdata).match(/^(<[^>]+)(>)/);
    if (rootMatch) {
      const [, openTag, closeChar] = rootMatch;
      return microdata.replace(rootMatch[0], `${openTag} data-timestamp="${this.escapeHTML(timestamp)}"${closeChar}`);
    }
    return microdata;
  }

  /**
   * Format message HTML with author styling
   */
  private formatMessageHtml(content: string, options: { isOwn: boolean; author?: { name: string; email: string } }): string {
    const { isOwn, author } = options;
    const alignClass = isOwn ? 'message-own' : 'message-other';
    const authorHtml = author
      ? `<div class="message-author">${this.escapeHTML(author.name)}</div>`
      : '';

    return `<div class="message ${alignClass}">
      ${authorHtml}
      <div class="message-content">${content}</div>
    </div>`;
  }

  private async implodeWithHash(hash: string): Promise<string> {
    const microdata = await implode(hash as SHA256Hash);
    return this.addHashAttribute(microdata, hash);
  }

  private addHashAttribute(microdata: string, hash: string): string {
    const rootMatch = String(microdata).match(/^(<[^>]+)(>)/);
    if (rootMatch) {
      const [, openTag, closeChar] = rootMatch;
      if (openTag.includes('data-hash=')) {
        return microdata;
      }
      return microdata.replace(rootMatch[0], `${openTag} data-hash="${hash}"${closeChar}`);
    }
    return `<span data-hash="${hash}">${microdata}</span>`;
  }

  private wrapInHTML(content: string, options: ExportOptions): string {
    const { title = 'ONE Object Export', theme = 'light' } = options;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src data: 'self'; script-src 'none';">
  <title>${this.escapeHTML(title)}</title>
  ${this.getStyles(theme)}
</head>
<body>
  <main class="export-content">
    ${content}
  </main>
</body>
</html>`;
  }

  private generateEmptyHTML(title?: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHTML(title || 'Empty Export')}</title>
  <style>body { font-family: sans-serif; text-align: center; padding: 50px; }</style>
</head>
<body>
  <h1>Empty Export</h1>
  <p>No objects to export.</p>
</body>
</html>`;
  }

  private generateCompleteHTML(data: {
    title: string;
    participants: Array<{ name: string; email?: string }>;
    dateRange?: { start?: string; end?: string };
    objectCount: number;
    objects: string[];
    theme: ExportTheme;
  }): string {
    const { title, participants, dateRange, objectCount, objects, theme } = data;
    const exportDate = new Date().toISOString();

    const participantsList = participants.map(p =>
      `<div class="participant" itemscope itemtype="//refin.io/Person">
        <span itemprop="name">${this.escapeHTML(p.name)}</span>
        ${p.email ? `<span itemprop="email" class="participant-email">${this.escapeHTML(p.email)}</span>` : ''}
      </div>`
    ).join('');

    const dateRangeText = dateRange?.start && dateRange?.end
      ? `${this.formatDate(dateRange.start)} - ${this.formatDate(dateRange.end)}`
      : 'All time';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src data: 'self'; script-src 'none';">
  <title>${this.escapeHTML(title)}</title>
  ${this.getStyles(theme)}
</head>
<body>
  <header class="export-header" itemscope itemtype="//refin.io/Export">
    <h1 class="export-title" itemprop="title">${this.escapeHTML(title)}</h1>
    <div class="export-meta">
      <meta itemprop="objectCount" content="${objectCount}">
      <meta itemprop="exportDate" content="${exportDate}">
      <div class="meta-item">
        <span class="meta-label">Objects:</span>
        <span class="meta-value">${objectCount}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Period:</span>
        <time class="meta-value" itemprop="dateRange">${dateRangeText}</time>
      </div>
      <div class="meta-item">
        <span class="meta-label">Exported:</span>
        <time class="meta-value">${this.formatDate(exportDate)}</time>
      </div>
    </div>
    ${participants.length > 0 ? `
    <div class="participants-section" itemprop="participants">
      <h2 class="participants-title">Participants</h2>
      <div class="participants-list">${participantsList}</div>
    </div>` : ''}
  </header>
  <main class="export-content">
    ${objects.map(obj => `<div class="export-object">${obj}</div>`).join('\n')}
  </main>
  <footer class="export-footer">
    <p class="export-notice">
      Exported from LAMA on ${this.formatDate(exportDate)}.
      All objects include cryptographic hashes for integrity verification.
    </p>
    <details>
      <summary>Verification Information</summary>
      <p><strong>Hashes:</strong> Each object includes a SHA-256 hash in the <code>data-hash</code> attribute.</p>
      <p><strong>Microdata:</strong> All data is embedded using HTML5 microdata format for machine readability.</p>
    </details>
  </footer>
</body>
</html>`;
  }

  private getStyles(theme: ExportTheme): string {
    const baseStyles = `
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
      color: #333;
    }
    .export-header {
      background: white;
      border-bottom: 3px solid #007bff;
      padding: 30px;
      margin-bottom: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .export-title {
      font-size: 2em;
      margin: 0 0 20px 0;
      color: #007bff;
    }
    .export-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 25px;
    }
    .meta-item { display: flex; flex-direction: column; }
    .meta-label {
      font-weight: 600;
      color: #666;
      font-size: 0.9em;
      text-transform: uppercase;
    }
    .meta-value { font-size: 1.1em; margin-top: 5px; }
    .participants-section {
      border-top: 1px solid #eee;
      padding-top: 25px;
    }
    .participants-title {
      font-size: 1.3em;
      margin: 0 0 15px 0;
      color: #666;
    }
    .participants-list { display: flex; flex-wrap: wrap; gap: 10px; }
    .participant {
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 20px;
      padding: 8px 15px;
      font-size: 0.9em;
    }
    .participant-email { color: #666; margin-left: 8px; font-size: 0.85em; }
    .export-content {
      max-width: 800px;
      margin: 0 auto;
      padding: 0 20px;
    }
    .export-object {
      margin-bottom: 25px;
      padding: 20px;
      border-radius: 12px;
      background: white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      border-left: 4px solid #e9ecef;
    }
    code {
      background: rgba(0,0,0,0.05);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: Monaco, Consolas, monospace;
      font-size: 0.9em;
    }
    .export-footer {
      margin-top: 50px;
      background: white;
      border-top: 1px solid #dee2e6;
      padding: 30px;
      text-align: center;
    }
    .export-notice { font-size: 0.9em; color: #666; }
    details { text-align: left; background: #f8f9fa; border-radius: 8px; padding: 15px; margin-top: 20px; }
    summary { font-weight: 600; cursor: pointer; }
    @media (max-width: 768px) {
      .export-header { padding: 20px; }
      .export-title { font-size: 1.5em; }
      .export-meta { grid-template-columns: 1fr; }
    }
    @media print {
      body { background: white; }
      .export-header { box-shadow: none; border-bottom: 2px solid #333; }
      .export-object { box-shadow: none; border: 1px solid #ddd; break-inside: avoid; }
    }`;

    const darkStyles = theme === 'dark' ? `
    body { background-color: #1a1a1a; color: #e0e0e0; }
    .export-header { background: #2d2d2d; }
    .export-title { color: #0d6efd; }
    .meta-label { color: #adb5bd; }
    .participant { background: #343a40; border-color: #495057; color: #fff; }
    .participant-email { color: #adb5bd; }
    .export-object { background: #2d2d2d; border-left-color: #495057; }
    code { background: rgba(255,255,255,0.1); }
    .export-footer { background: #2d2d2d; border-top-color: #495057; }
    .export-notice { color: #adb5bd; }
    details { background: #343a40; }` : '';

    return `<style>${baseStyles}${darkStyles}</style>`;
  }

  private escapeHTML(text: string): string {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private formatDate(isoDate: string): string {
    try {
      return new Date(isoDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoDate;
    }
  }
}
