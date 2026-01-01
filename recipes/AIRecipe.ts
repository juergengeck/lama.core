/**
 * AI Recipe for ONE.core
 * Defines the schema for AI assistant identity objects
 *
 * AI objects represent AI assistant identities (e.g., "Claude", "GPT")
 * that delegate to underlying LLM model Persons.
 */

export const AIRecipe = {
    $type$: 'Recipe' as const,
    name: 'AI',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^AI$/ }
        },
        {
            itemprop: 'aiId',
            itemtype: { type: 'string' },
            isId: true  // Makes this a versioned object, keyed by aiId
        },
        {
            itemprop: 'displayName',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'personId',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Person'])
            }
        },
        {
            itemprop: 'llmProfileId',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Profile'])
            }
        },
        {
            itemprop: 'modelId',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'owner',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Person', 'Instance'])
            }
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
            itemprop: 'active',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'deleted',
            itemtype: { type: 'boolean' }
        },
        // AI behavior flags
        {
            itemprop: 'analyse',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'respond',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'mute',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'ignore',
            itemtype: { type: 'boolean' },
            optional: true
        },
        // AI-specific character data
        {
            itemprop: 'creationContext',
            itemtype: {
                type: 'object',
                properties: {
                    device: { type: 'string' },
                    locale: { type: 'string' },
                    time: { type: 'number' },
                    app: { type: 'string' }
                }
            },
            optional: true
        },
        {
            itemprop: 'systemPromptAddition',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};
