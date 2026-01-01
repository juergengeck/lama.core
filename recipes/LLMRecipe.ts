/**
 * LLM Recipe for ONE.core
 * Defines the schema for LLM configuration objects
 */

export const LLMRecipe = {
    $type$: 'Recipe' as const,
    name: 'LLM',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^LLM$/ }
        },
        {
            itemprop: 'name',
            itemtype: { type: 'string' }
        },
        // LLM server address (e.g., http://localhost:11434 for Ollama)
        {
            itemprop: 'server',
            itemtype: { type: 'string' },
            isId: true
        },
        // Model identifier (e.g., "claude-3-5-haiku-20241022", "llama3:latest")
        {
            itemprop: 'modelId',
            itemtype: { type: 'string' },
            isId: true
        },
        {
            itemprop: 'filename',
            itemtype: { type: 'string' },
            optional: true  // API-based models (Claude, OpenAI) don't have local files
        },
        {
            itemprop: 'modelType',
            itemtype: {
                type: 'string',
                regexp: /^(local|remote)$/
            },
            optional: true  // Can be inferred from provider
        },
        // Inference locality: where the model actually runs
        // - 'ondevice': transformers.js, runs directly in app (no server)
        // - 'server': Ollama/LM Studio/vLLM (local or remote server)
        // - 'cloud': Claude/OpenAI/etc (remote API)
        {
            itemprop: 'inferenceType',
            itemtype: {
                type: 'string',
                regexp: /^(ondevice|server|cloud)$/
            },
            optional: true  // Defaults to 'server' for backwards compatibility
        },
        {
            itemprop: 'active',
            itemtype: { type: 'boolean' },
            optional: true  // Defaults to true
        },
        {
            itemprop: 'deleted',
            itemtype: { type: 'boolean' },
            optional: true  // Defaults to false
        },
        {
            itemprop: 'creator',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'created',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'modified',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'createdAt',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'lastUsed',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'lastInitialized',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'usageCount',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'size',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'personId',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Person'])
            },
            optional: true
        },
        {
            itemprop: 'owner',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Person', 'Instance'])
            },
            optional: true
        },
        {
            itemprop: 'capabilities',
            itemtype: {
                type: 'array',
                item: {
                    type: 'string',
                    regexp: /^(chat|completion|inference|extended-thinking)$/
                }
            },
            optional: true
        },
        // Model parameters
        {
            itemprop: 'temperature',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'maxTokens',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'contextSize',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'batchSize',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'threads',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'mirostat',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'topK',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'topP',
            itemtype: { type: 'number' },
            optional: true
        },
        // Optional properties
        {
            itemprop: 'architecture',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'contextLength',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'quantization',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'checksum',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'provider',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'description',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'downloadUrl',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'systemPrompt',
            itemtype: { type: 'string' },
            optional: true
        },
        // Local model weights storage path (NOT the server address - use 'server' for that)
        {
            itemprop: 'baseUrl',
            itemtype: { type: 'string' },
            optional: true
        },
        // Authentication fields
        {
            itemprop: 'authType',
            itemtype: {
                type: 'string',
                regexp: /^(none|bearer)$/
            },
            optional: true
        },
        {
            itemprop: 'encryptedAuthToken',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'encryptedApiKey',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};
