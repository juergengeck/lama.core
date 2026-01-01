/**
 * AI Recipe for ONE.core
 * Defines the schema for AI assistant identity objects
 *
 * AI objects represent AI assistant identities (e.g., "Claude", "GPT")
 * that delegate to underlying LLM model Persons.
 */

/**
 * AIList Recipe for ONE.core
 * Tracks all AI objects by their ID hashes for easy enumeration
 * Single instance per user (id: 'ai-list')
 */
export const AIListRecipe = {
    $type$: 'Recipe' as const,
    name: 'AIList',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^AIList$/ }
        },
        {
            itemprop: 'id',
            itemtype: { type: 'string' },
            isId: true  // Fixed ID 'ai-list' makes this a singleton per user
        },
        {
            itemprop: 'aiIds',
            itemtype: {
                type: 'set',
                item: {
                    type: 'referenceToId',
                    allowedTypes: new Set(['AI'])
                }
            }
        },
        {
            itemprop: 'modified',
            itemtype: { type: 'number' }
        }
    ]
};

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
            itemprop: 'llmId',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['LLM'])
            },
            optional: true  // LLM reference is optional; undefined = use app default
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
        // AI behavior flags (global defaults, can be overridden per-topic)
        {
            itemprop: 'analyse',
            itemtype: { type: 'boolean' },
            optional: true  // Default: true - run analytics extraction
        },
        {
            itemprop: 'respond',
            itemtype: { type: 'boolean' },
            optional: true  // Default: true - generate AI responses
        },
        {
            itemprop: 'mute',
            itemtype: { type: 'boolean' },
            optional: true  // Default: false - suppress notifications
        },
        {
            itemprop: 'ignore',
            itemtype: { type: 'boolean' },
            optional: true  // Default: false - skip entirely
        },
        {
            itemprop: 'personality',
            itemtype: {
                type: 'object',
                rules: [
                    {
                        itemprop: 'creationContext',
                        itemtype: {
                            type: 'object',
                            rules: [
                                { itemprop: 'device', itemtype: { type: 'string' } },
                                { itemprop: 'locale', itemtype: { type: 'string' } },
                                { itemprop: 'time', itemtype: { type: 'number' } },
                                { itemprop: 'app', itemtype: { type: 'string' } }
                            ]
                        },
                        optional: true
                    },
                    {
                        itemprop: 'traits',
                        itemtype: { type: 'bag', item: { type: 'string' } },
                        optional: true
                    },
                    {
                        itemprop: 'systemPromptAddition',
                        itemtype: { type: 'string' },
                        optional: true
                    }
                ]
            },
            optional: true
        }
    ]
};
