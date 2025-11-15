/**
 * Settings Managers Index
 * Unified export point for all settings managers in lama.core
 */

// AI Settings Manager - AI Assistant app configuration (per instance)
export { AISettingsManager, createAISettings, DEFAULT_AI_SETTINGS } from './AISettingsManager.js';

// Global LLM Settings Manager - Core LLM parameters (per user/Person)
export { GlobalLLMSettingsManager, DEFAULT_LLM_SETTINGS } from './GlobalLLMSettingsManager.js';
export type { GlobalLLMSettingsManagerDeps } from './GlobalLLMSettingsManager.js';

// Word Cloud Settings Manager - Word cloud visualization settings
export { WordCloudSettingsManager, wordCloudSettingsManager, createWordCloudSettings, DEFAULT_WORD_CLOUD_SETTINGS } from './WordCloudSettingsManager.js';
