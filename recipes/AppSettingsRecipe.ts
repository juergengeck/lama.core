/**
 * AppSettings Recipe for ONE.core
 *
 * Stores all application settings as a single versioned object.
 * Uses instance owner as the ID field for direct retrieval.
 *
 * This replaces platform-specific storage (SecureStore, IndexedDB, etc.)
 * with ONE.core versioned objects for:
 * - Unified cross-platform storage
 * - Automatic versioning and history
 * - Type safety through recipes
 */

import type { Recipe } from '@refinio/one.core/lib/recipes.js';

export const AppSettingsRecipe = {
    $type$: 'Recipe',
    name: 'AppSettings',

    // ID field - owner (Instance) makes settings unique per instance
    owner: {
        type: 'IdHashRef',
        idHash: 'instance',
        required: true,
        isId: true
    },

    // App Settings (UI and preferences)
    theme: { type: 'string' },  // 'light' | 'dark' | 'auto'
    language: { type: 'string' },  // 'en' | 'de' | 'es' | 'fr'
    notifications: { type: 'boolean' },
    soundEnabled: { type: 'boolean' },
    vibrationEnabled: { type: 'boolean' },
    compactMode: { type: 'boolean' },
    showTimestamps: { type: 'boolean' },
    dateFormat: { type: 'string' },  // '12h' | '24h'

    // Device Settings (discovery and pairing)
    discoveryEnabled: { type: 'boolean' },
    discoveryPort: { type: 'number' },
    autoConnect: { type: 'boolean' },
    addOnlyConnectedDevices: { type: 'boolean' },
    showOfflineDevices: { type: 'boolean' },
    discoveryTimeout: { type: 'number' },  // milliseconds

    // Network Settings (connection and transport)
    commServerUrl: { type: 'string' },
    autoReconnect: { type: 'boolean' },
    connectionTimeout: { type: 'number' },  // milliseconds
    enableWebSocket: { type: 'boolean' },
    enableQUIC: { type: 'boolean' },
    enableBluetooth: { type: 'boolean' },

    // AI Settings (LLM and assistant configuration)
    aiEnabled: { type: 'boolean' },
    aiProvider: { type: 'string' },  // 'ollama' | 'lmstudio' | 'claude' | 'openai'
    aiModel: { type: 'string' },
    aiTemperature: { type: 'number' },  // 0-2
    aiMaxTokens: { type: 'number' },
    aiStreamResponses: { type: 'boolean' },
    aiAutoSummarize: { type: 'boolean' },
    aiKeywordExtraction: { type: 'boolean' },

    // Privacy Settings (security and privacy controls)
    encryptStorage: { type: 'boolean' },
    requirePINOnStartup: { type: 'boolean' },
    autoLockTimeout: { type: 'number' },  // minutes, 0 = never
    sendAnalytics: { type: 'boolean' },
    sendCrashReports: { type: 'boolean' },

    // Chat Settings (messaging preferences)
    enterToSend: { type: 'boolean' },
    showReadReceipts: { type: 'boolean' },
    groupMessagesBy: { type: 'string' },  // 'none' | 'hour' | 'day'
    maxHistoryDays: { type: 'number' },  // 0 = unlimited
    autoDownloadMedia: { type: 'boolean' },
    maxMediaSize: { type: 'number' }  // MB
};
