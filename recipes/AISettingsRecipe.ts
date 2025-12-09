/**
 * AISettings Recipe for ONE.core
 *
 * Stores AI Assistant application settings per instance.
 * Uses instance name as the ID field for direct retrieval.
 *
 * Separate from GlobalLLMSettings:
 * - GlobalLLMSettings: Core LLM parameters (temperature, maxTokens, prompts)
 * - AISettings: AI Assistant app configuration (providers, features, preferences)
 */

export const AISettingsRecipe = {
    $type$: 'Recipe' as const,
    name: 'AISettings',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^AISettings$/ }
        },
        {
            itemprop: 'name',
            itemtype: { type: 'string' },
            isId: true  // Instance name as ID field - NO QUERIES NEEDED
        },
        {
            itemprop: 'defaultProvider',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'autoSelectBestModel',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'preferredModelIds',
            itemtype: {
                type: 'array',
                item: {
                    type: 'string'
                }
            }
        },
        {
            itemprop: 'defaultModelId',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'temperature',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'maxTokens',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'systemPrompt',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'streamResponses',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'autoSummarize',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'enableMCP',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'embeddingModel',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};
