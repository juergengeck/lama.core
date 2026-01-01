/**
 * Model Registry
 *
 * Centralized configuration for all supported LLM models.
 * This is the single source of truth for model metadata.
 */

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'google' | 'ollama' | 'lmstudio' | 'meta' | 'deepseek' | 'qwen';
  type: 'local' | 'remote';
  description: string;
  contextWindow?: number;
  defaultTemperature?: number;
  requiresApiKey: boolean;
  baseUrl?: string; // For local models with known endpoints
  capabilities?: Array<'chat' | 'inference' | 'streaming' | 'function-calling'>;
}

/**
 * Registry of all supported models
 */
export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  // Anthropic Claude Models
  'claude-opus-4-5-20251101': {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    provider: 'anthropic',
    type: 'remote',
    description: 'Most capable model. Best for complex reasoning, coding, and agentic tasks.',
    contextWindow: 200000,
    defaultTemperature: 1.0,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming', 'function-calling'],
  },
  'claude-sonnet-4-5-20250929': {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    type: 'remote',
    description: 'Balanced performance and cost',
    contextWindow: 200000,
    defaultTemperature: 1.0,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming', 'function-calling'],
  },
  'claude-3-5-haiku-20241022': {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    type: 'remote',
    description: 'Fast and efficient for simple tasks',
    contextWindow: 200000,
    defaultTemperature: 1.0,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming'],
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    type: 'remote',
    description: 'Fast and affordable, similar coding to Sonnet 4 at 1/3 cost',
    contextWindow: 200000,
    defaultTemperature: 1.0,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming'],
  },

  // OpenAI Models
  'gpt-5': {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: 'openai',
    type: 'remote',
    description: 'Most powerful reasoning model, best for complex tasks',
    contextWindow: 1000000,
    defaultTemperature: 0.7,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming', 'function-calling'],
  },
  'gpt-4.1': {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    type: 'remote',
    description: 'Latest GPT-4 series, excellent coding with 1M token context',
    contextWindow: 1000000,
    defaultTemperature: 0.7,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming', 'function-calling'],
  },
  'gpt-4.1-mini': {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    provider: 'openai',
    type: 'remote',
    description: 'Fast and affordable, outperforms GPT-4o mini',
    contextWindow: 128000,
    defaultTemperature: 0.7,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming', 'function-calling'],
  },
  'o3-mini': {
    id: 'o3-mini',
    name: 'o3-mini',
    provider: 'openai',
    type: 'remote',
    description: 'Latest reasoning model, enhanced reasoning at lower cost',
    contextWindow: 128000,
    defaultTemperature: 1.0,
    requiresApiKey: true,
    capabilities: ['chat', 'inference'],
  },
  'gpt-4-turbo': {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    type: 'remote',
    description: 'Latest GPT-4 with improved performance',
    contextWindow: 128000,
    defaultTemperature: 0.7,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming', 'function-calling'],
  },
  'gpt-4': {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    type: 'remote',
    description: 'Advanced reasoning and instruction following',
    contextWindow: 8192,
    defaultTemperature: 0.7,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming', 'function-calling'],
  },
  'gpt-3.5-turbo': {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'openai',
    type: 'remote',
    description: 'Fast and cost-effective',
    contextWindow: 16385,
    defaultTemperature: 0.7,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming', 'function-calling'],
  },
  'o1-preview': {
    id: 'o1-preview',
    name: 'O1 Preview',
    provider: 'openai',
    type: 'remote',
    description: 'Advanced reasoning model',
    contextWindow: 128000,
    defaultTemperature: 1.0,
    requiresApiKey: true,
    capabilities: ['chat', 'inference'],
  },

  // Google Gemini Models
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    type: 'remote',
    description: 'Most capable Gemini. 1M token context, strong reasoning and coding.',
    contextWindow: 1000000,
    defaultTemperature: 1.0,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming', 'function-calling'],
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    type: 'remote',
    description: 'Fast and efficient. Great balance of speed and capability.',
    contextWindow: 1000000,
    defaultTemperature: 1.0,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming'],
  },

  // DeepSeek Models
  'deepseek-chat': {
    id: 'deepseek-chat',
    name: 'DeepSeek V3.2',
    provider: 'deepseek',
    type: 'remote',
    description: 'Latest DeepSeek model, 50% cheaper with sparse attention',
    contextWindow: 128000,
    defaultTemperature: 0.7,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming'],
  },
  'deepseek-reasoner': {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    provider: 'deepseek',
    type: 'remote',
    description: 'Advanced reasoning, excellent for math and complex problems',
    contextWindow: 128000,
    defaultTemperature: 1.0,
    requiresApiKey: true,
    capabilities: ['chat', 'inference'],
  },

  // Qwen Models
  'qwen-max': {
    id: 'qwen-max',
    name: 'Qwen3 Max',
    provider: 'qwen',
    type: 'remote',
    description: 'Latest Qwen flagship, most capable multilingual model',
    contextWindow: 128000,
    defaultTemperature: 0.7,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming'],
  },
  'qwen-plus': {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'qwen',
    type: 'remote',
    description: 'Fast and affordable, good for general tasks',
    contextWindow: 32768,
    defaultTemperature: 0.7,
    requiresApiKey: true,
    capabilities: ['chat', 'inference', 'streaming'],
  },

  // Ollama models (detected dynamically, but common ones listed for reference)
  'llama3.3:latest': {
    id: 'llama3.3:latest',
    name: 'Llama 3.3',
    provider: 'meta',
    type: 'local',
    description: 'Meta\'s latest open model',
    contextWindow: 128000,
    defaultTemperature: 0.7,
    requiresApiKey: false,
    baseUrl: 'http://localhost:11434',
    capabilities: ['chat', 'inference', 'streaming'],
  },
  'qwen2.5:latest': {
    id: 'qwen2.5:latest',
    name: 'Qwen 2.5',
    provider: 'ollama',
    type: 'local',
    description: 'Alibaba\'s multilingual model',
    contextWindow: 32768,
    defaultTemperature: 0.7,
    requiresApiKey: false,
    baseUrl: 'http://localhost:11434',
    capabilities: ['chat', 'inference', 'streaming'],
  },

  // LM Studio (uses OpenAI-compatible API)
  'lmstudio': {
    id: 'lmstudio',
    name: 'LM Studio',
    provider: 'lmstudio',
    type: 'local',
    description: 'Local model via LM Studio',
    requiresApiKey: false,
    baseUrl: 'http://localhost:1234',
    capabilities: ['chat', 'inference', 'streaming'],
  },
};

/**
 * Get model configuration by ID
 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return MODEL_REGISTRY[modelId];
}

/**
 * Local browser models (transformers.js)
 * These run on-device via Web Worker, not through Ollama
 */
const LOCAL_BROWSER_MODELS = [
  'granite-4.0-350m',
  'granite-3.3-2b-instruct',
  'phi-3.5-mini-instruct'
];

/**
 * Get model provider from model ID
 */
export function getModelProvider(modelId: string): string {
  const config = getModelConfig(modelId);
  if (config) {
    return config.provider;
  }

  // Check for local browser models (transformers.js) FIRST
  // These models run on-device, not through Ollama
  if (LOCAL_BROWSER_MODELS.includes(modelId)) {
    return 'transformers';
  }

  // Fallback: Detect from model ID pattern
  // Check for Ollama models first (format: model:tag)
  if (modelId.includes(':')) return 'ollama';

  if (modelId.includes('claude')) return 'anthropic';
  if (modelId.includes('gemini')) return 'google';
  // Only match real OpenAI models, not OSS models like "gpt-oss"
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1-') || modelId.startsWith('o3-')) {
    // Exclude OSS/local variants
    if (modelId.includes('oss')) return 'ollama';
    return 'openai';
  }
  if (modelId.includes('deepseek')) return 'deepseek';
  if (modelId.includes('qwen')) return 'qwen';
  if (modelId.includes('llama')) return 'meta';
  if (modelId.includes('lmstudio')) return 'lmstudio';

  return 'ollama'; // Default for unknown local models
}

/**
 * Check if model requires API key
 */
export function modelRequiresApiKey(modelId: string): boolean {
  const config = getModelConfig(modelId);
  return config?.requiresApiKey ?? false;
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProvider(provider: string): ModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter(m => m.provider === provider);
}

/**
 * Get all cloud API models (require API keys)
 */
export function getCloudModels(): ModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter(m => m.requiresApiKey);
}

/**
 * Get all local models (Ollama, LM Studio)
 */
export function getLocalModels(): ModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter(m => !m.requiresApiKey);
}
