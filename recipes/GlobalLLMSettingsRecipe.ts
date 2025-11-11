/**
 * GlobalLLMSettings Recipe for ONE.core
 *
 * Stores global LLM settings per user using Person ID as the ID field.
 * This creates ONE object per user that versions itself when settings change.
 *
 * IMPORTANT: Uses creator (Person hash) as ID field, NOT email.
 * This allows direct retrieval via getObjectByIdHash() without queries.
 */

export const GlobalLLMSettingsRecipe = {
    $type$: 'Recipe' as const,
    name: 'GlobalLLMSettings',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^GlobalLLMSettings$/ }
        },
        {
            itemprop: 'creator',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Person'])
            },
            isId: true  // Person ID as ID field - NO QUERIES NEEDED
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
            itemprop: 'enableAutoSummary',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'enableAutoResponse',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'defaultPrompt',
            itemtype: { type: 'string' }
        }
    ]
};
