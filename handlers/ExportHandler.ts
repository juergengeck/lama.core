/**
 * Export Handler (Pure Business Logic)
 *
 * Transport-agnostic handler for content export operations.
 * Handles format conversion, HTML generation, and export preparation.
 * Platform-specific file operations (dialogs, fs) are injected.
 *
 * Can be used from both Electron IPC and Web Worker contexts.
 */

// Types
interface Message {
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

interface ExportOptions {
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

interface FileFilter {
  name: string;
  extensions: string[];
}

// Request/Response interfaces
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

export interface ExportHtmlWithMicrodataRequest {
  topicId: string;
  format: string;
  options?: ExportOptions;
}

export interface ExportHtmlWithMicrodataResponse {
  success: boolean;
  html?: string;
  metadata?: any;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * ExportHandler - Pure business logic for export operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - implodeWrapper: HTML export service with implode functionality
 * - formatter: HTML formatting service
 * - htmlTemplate: HTML template generation service
 * - messageRetriever: Function to retrieve messages from a topic
 */
export class ExportHandler {
  private implodeWrapper: any;
  private formatter: any;
  private htmlTemplate: any;
  private messageRetriever: any;

  constructor(
    implodeWrapper: any,
    formatter: any,
    htmlTemplate: any,
    messageRetriever?: any
  ) {
    this.implodeWrapper = implodeWrapper;
    this.formatter = formatter;
    this.htmlTemplate = htmlTemplate;
    this.messageRetriever = messageRetriever;
  }

  /**
   * Export message content - prepares filename and content based on format
   */
  async exportMessage(request: ExportMessageRequest): Promise<ExportMessageResponse> {
    try {
      console.log('[ExportHandler] exportMessage called:', {
        format: request.format,
        contentLength: request.content.length
      });

      const { format, content, metadata } = request;
      let filename: string, fileContent: string, filters: FileFilter[];

      switch (format) {
        case 'markdown':
          filename = `message-${metadata.messageId || Date.now()}.md`;
          filters = [
            { name: 'Markdown Files', extensions: ['md'] },
            { name: 'All Files', extensions: ['*'] }
          ];
          fileContent = content;
          break;

        case 'html':
          filename = `message-${metadata.messageId || Date.now()}.html`;
          filters = [
            { name: 'HTML Files', extensions: ['html', 'htm'] },
            { name: 'All Files', extensions: ['*'] }
          ];
          fileContent = content;
          break;

        case 'json':
          filename = `message-${metadata.messageId || Date.now()}.json`;
          filters = [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
          ];
          fileContent = content;
          break;

        case 'onecore':
          filename = `message-${metadata.messageId || Date.now()}.onecore`;
          filters = [
            { name: 'ONE.core Files', extensions: ['onecore'] },
            { name: 'All Files', extensions: ['*'] }
          ];
          fileContent = content;
          break;

        default:
          filename = `message-${metadata.messageId || Date.now()}.txt`;
          filters = [
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
          ];
          fileContent = content;
      }

      return {
        success: true,
        filename,
        fileContent,
        filters
      };
    } catch (error) {
      console.error('[ExportHandler] Error exporting message:', error);
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
   */
  async exportHtmlWithMicrodata(
    request: ExportHtmlWithMicrodataRequest
  ): Promise<ExportHtmlWithMicrodataResponse> {
    try {
      console.log('[ExportHandler] exportHtmlWithMicrodata called:', {
        topicId: request.topicId,
        format: request.format,
        options: request.options
      });

      const { topicId, format, options = {} } = request;

      // Validate input parameters
      const validationResult = this.validateExportRequest({ topicId, format, options });
      if (!validationResult.valid) {
        return {
          success: false,
          error: validationResult.error
        };
      }

      // Set timeout for large exports
      const timeout = options.timeout || 30000; // 30 seconds
      const startTime = Date.now();

      const exportPromise = this.performExport(topicId, options, startTime, timeout);

      const result = await Promise.race([
        exportPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Export timeout after 30 seconds')), timeout)
        )
      ]);

      return result;
    } catch (error) {
      console.error('[ExportHandler] Error exporting HTML with microdata:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

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
    options?: ExportOptions;
  }): ValidationResult {
    // Validate topicId
    if (!topicId || typeof topicId !== 'string' || topicId.trim() === '') {
      return { valid: false, error: 'topicId is required and must be a non-empty string' };
    }

    // Validate format
    if (!format || format !== 'html-microdata') {
      return { valid: false, error: 'format must be "html-microdata"' };
    }

    // Validate options
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
   * Perform the actual export process
   */
  private async performExport(
    topicId: string,
    options: ExportOptions,
    startTime: number,
    timeout: number
  ): Promise<ExportHtmlWithMicrodataResponse> {
    try {
      // Step 1: Retrieve messages from TopicRoom
      console.log('[ExportHandler] Retrieving messages for topic:', topicId);
      const messages = await this.getMessagesFromTopic(topicId, options);

      if (messages.length === 0) {
        console.log('[ExportHandler] No messages found for topic');
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

      console.log(`[ExportHandler] Found ${messages.length} messages`);

      // Step 2: Process messages with implode()
      console.log('[ExportHandler] Processing messages with implode()...');
      const processedMessages = await this.processMessagesWithImplode(messages, options);

      // Check timeout
      if (Date.now() - startTime > timeout - 5000) {
        throw new Error('Export approaching timeout limit');
      }

      // Step 3: Generate HTML with formatting
      console.log('[ExportHandler] Generating HTML document...');
      const metadata = await this.generateMetadata(topicId, messages, options);
      const htmlDocument = this.htmlTemplate.generateCompleteHTML({
        metadata,
        messages: processedMessages,
        options: {
          theme: options.styleTheme
        }
      });

      const fileSize = Buffer.byteLength(htmlDocument, 'utf8');

      console.log(`[ExportHandler] Export completed successfully. File size: ${fileSize} bytes`);

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
      console.error('[ExportHandler] Error in performExport:', error);
      throw error;
    }
  }

  /**
   * Get messages from topic (uses injected messageRetriever or placeholder)
   */
  private async getMessagesFromTopic(topicId: string, options: ExportOptions): Promise<Message[]> {
    if (this.messageRetriever) {
      return await this.messageRetriever(topicId, options);
    }

    // Placeholder implementation
    console.log('[ExportHandler] TODO: Implement actual message retrieval from TopicRoom');
    return [
      {
        hash: 'abc123def456789012345678901234567890123456789012345678901234567890',
        author: { name: 'Test User', email: 'test@example.com' },
        timestamp: new Date().toISOString(),
        content: 'Sample message content'
      }
    ];
  }

  /**
   * Process messages using implode wrapper
   */
  private async processMessagesWithImplode(
    messages: Message[],
    options: ExportOptions
  ): Promise<string[]> {
    const processedMessages: string[] = [];

    for (const message of messages) {
      try {
        // Get imploded microdata for the message
        const implodedData = await this.implodeWrapper.wrapMessageWithMicrodata(message.hash);

        // Add signature if available and requested
        let finalData = implodedData;
        if (options.includeSignatures !== false && message.signature) {
          finalData = this.implodeWrapper.addSignature(finalData, message.signature);
        }

        // Add timestamp
        if (message.timestamp) {
          finalData = this.implodeWrapper.addTimestamp(finalData, message.timestamp);
        }

        // Format for display
        const formattedMessage = this.formatter.formatMessage(finalData, {
          isOwn: message.isOwn || false
        });

        processedMessages.push(formattedMessage);
      } catch (error) {
        console.error(`[ExportHandler] Error processing message ${message.hash}:`, error);
        // Continue with other messages rather than failing entire export
        processedMessages.push(
          `<div class="message error">Error processing message: ${(error as Error).message}</div>`
        );
      }
    }

    return processedMessages;
  }

  /**
   * Generate metadata for the conversation
   */
  private async generateMetadata(
    topicId: string,
    messages: Message[],
    options: ExportOptions
  ): Promise<any> {
    // Extract unique participants
    const participants: any[] = [];
    const seenEmails = new Set<string>();

    messages.forEach((message) => {
      if (message.author && message.author.email && !seenEmails.has(message.author.email)) {
        participants.push({
          name: message.author.name,
          email: message.author.email,
          personHash: message.author.personHash
        });
        seenEmails.add(message.author.email);
      }
    });

    // Calculate date range
    const timestamps: any[] = messages
      .map((m) => new Date(m.timestamp))
      .filter((d) => !isNaN(d.getTime()));
    const dateRange =
      timestamps.length > 0
        ? {
            start: new Date(Math.min(...timestamps.map((d) => d.getTime()))).toISOString(),
            end: new Date(Math.max(...timestamps.map((d) => d.getTime()))).toISOString()
          }
        : null;

    return {
      title: `Conversation ${topicId}`,
      topicId,
      messageCount: messages.length,
      participants,
      dateRange,
      exportDate: new Date().toISOString()
    };
  }

  /**
   * Generate HTML for empty conversation
   */
  private generateEmptyConversationHTML(topicId: string, options: ExportOptions): string {
    const { styleTheme = 'light' } = options;

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
    <p>No messages found for topic: ${topicId}</p>
  </div>
</body>
</html>`;
  }
}
