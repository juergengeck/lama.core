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

export const AppSettingsRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'AppSettings',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^AppSettings$/ }
        },
        {
            itemprop: 'owner',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Instance'])
            },
            isId: true  // ID field - owner (Instance) makes settings unique per instance
        },

        // App Settings (UI and preferences)
        {
            itemprop: 'theme',
            itemtype: { type: 'string' },  // 'light' | 'dark' | 'auto'
            optional: true
        },
        {
            itemprop: 'language',
            itemtype: { type: 'string' },  // 'en' | 'de' | 'es' | 'fr'
            optional: true
        },
        {
            itemprop: 'notifications',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'soundEnabled',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'vibrationEnabled',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'compactMode',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'showTimestamps',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'dateFormat',
            itemtype: { type: 'string' },  // '12h' | '24h'
            optional: true
        },

        // Device Settings (discovery and pairing)
        {
            itemprop: 'discoveryEnabled',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'discoveryPort',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'autoConnect',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'addOnlyConnectedDevices',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'showOfflineDevices',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'discoveryTimeout',
            itemtype: { type: 'number' },  // milliseconds
            optional: true
        },

        // Network Settings (connection and transport)
        {
            itemprop: 'commServerUrl',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'autoReconnect',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'connectionTimeout',
            itemtype: { type: 'number' },  // milliseconds
            optional: true
        },
        {
            itemprop: 'enableWebSocket',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'enableQUIC',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'enableBluetooth',
            itemtype: { type: 'boolean' },
            optional: true
        },

        // AI Settings (LLM and assistant configuration)
        {
            itemprop: 'aiEnabled',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'aiProvider',
            itemtype: { type: 'string' },  // 'ollama' | 'lmstudio' | 'claude' | 'openai'
            optional: true
        },
        {
            itemprop: 'aiModel',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'aiTemperature',
            itemtype: { type: 'number' },  // 0-2
            optional: true
        },
        {
            itemprop: 'aiMaxTokens',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'aiStreamResponses',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'aiAutoSummarize',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'aiKeywordExtraction',
            itemtype: { type: 'boolean' },
            optional: true
        },

        // Privacy Settings (security and privacy controls)
        {
            itemprop: 'encryptStorage',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'requirePINOnStartup',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'autoLockTimeout',
            itemtype: { type: 'number' },  // minutes, 0 = never
            optional: true
        },
        {
            itemprop: 'sendAnalytics',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'sendCrashReports',
            itemtype: { type: 'boolean' },
            optional: true
        },

        // Chat Settings (messaging preferences)
        {
            itemprop: 'enterToSend',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'showReadReceipts',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'groupMessagesBy',
            itemtype: { type: 'string' },  // 'none' | 'hour' | 'day'
            optional: true
        },
        {
            itemprop: 'maxHistoryDays',
            itemtype: { type: 'number' },  // 0 = unlimited
            optional: true
        },
        {
            itemprop: 'autoDownloadMedia',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'maxMediaSize',
            itemtype: { type: 'number' },  // MB
            optional: true
        },
        {
            itemprop: '$versionHash$',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};
