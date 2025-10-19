/**
 * Word Cloud Settings Handler (Pure Business Logic)
 *
 * Transport-agnostic handler for word cloud settings operations.
 * Manages user-specific word cloud visualization settings.
 * Can be used from both Electron IPC and Web Worker contexts.
 */

// Types
interface WordCloudSettings {
  enabled: boolean;
  maxWords: number;
  minFontSize: number;
  maxFontSize: number;
  colorScheme: string;
  layout: string;
  padding: number;
  spiral: string;
  [key: string]: any;
}

// Request/Response interfaces
export interface GetWordCloudSettingsRequest {}

export interface GetWordCloudSettingsResponse {
  success: boolean;
  settings?: WordCloudSettings;
  error?: string;
}

export interface UpdateWordCloudSettingsRequest {
  updates: Partial<WordCloudSettings>;
}

export interface UpdateWordCloudSettingsResponse {
  success: boolean;
  settings?: WordCloudSettings;
  error?: string;
}

export interface ResetWordCloudSettingsRequest {}

export interface ResetWordCloudSettingsResponse {
  success: boolean;
  settings?: WordCloudSettings;
  error?: string;
}

/**
 * WordCloudSettingsHandler - Pure business logic for word cloud settings
 *
 * Dependencies are injected via constructor to support both platforms:
 * - nodeOneCore: Platform-specific ONE.core instance
 * - wordCloudSettingsManager: Settings storage manager
 * - defaultSettings: Default settings object (optional)
 */
export class WordCloudSettingsHandler {
  private nodeOneCore: any;
  private wordCloudSettingsManager: any;
  private defaultSettings: WordCloudSettings | null;

  constructor(
    nodeOneCore: any,
    wordCloudSettingsManager: any,
    defaultSettings?: WordCloudSettings
  ) {
    this.nodeOneCore = nodeOneCore;
    this.wordCloudSettingsManager = wordCloudSettingsManager;
    this.defaultSettings = defaultSettings || null;
  }

  /**
   * Get current user's ID from nodeOneCore
   */
  private async getCurrentUserId(): Promise<string> {
    if (!this.nodeOneCore.leuteModel) {
      throw new Error('User not authenticated - node not provisioned');
    }

    const me = await this.nodeOneCore.leuteModel.me();
    return me.idHash;
  }

  /**
   * Get word cloud settings for the current user
   */
  async getWordCloudSettings(
    request: GetWordCloudSettingsRequest
  ): Promise<GetWordCloudSettingsResponse> {
    try {
      const creatorId = await this.getCurrentUserId();

      const settings = await this.wordCloudSettingsManager.getSettings(creatorId);
      console.log('[WordCloudSettingsHandler] Retrieved settings:', settings);

      return {
        success: true,
        settings
      };
    } catch (error) {
      console.error('[WordCloudSettingsHandler] Error getting settings:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Update word cloud settings for the current user
   */
  async updateWordCloudSettings(
    request: UpdateWordCloudSettingsRequest
  ): Promise<UpdateWordCloudSettingsResponse> {
    try {
      const creatorId = await this.getCurrentUserId();

      const settings = await this.wordCloudSettingsManager.updateSettings(
        creatorId,
        request.updates
      );
      console.log('[WordCloudSettingsHandler] Updated settings:', settings);

      return {
        success: true,
        settings
      };
    } catch (error) {
      console.error('[WordCloudSettingsHandler] Error updating settings:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Reset word cloud settings to defaults for the current user
   */
  async resetWordCloudSettings(
    request: ResetWordCloudSettingsRequest
  ): Promise<ResetWordCloudSettingsResponse> {
    try {
      const creatorId = await this.getCurrentUserId();

      if (!this.defaultSettings) {
        throw new Error('Default settings not available');
      }

      // Reset by updating with all default values
      const settings = await this.wordCloudSettingsManager.updateSettings(
        creatorId,
        this.defaultSettings
      );
      console.log('[WordCloudSettingsHandler] Reset settings to defaults:', settings);

      return {
        success: true,
        settings
      };
    } catch (error) {
      console.error('[WordCloudSettingsHandler] Error resetting settings:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
}
