/**
 * ONE.core Recipe for Subject objects
 *
 * Subject represents a distinct discussion topic within a conversation
 * Identified by topic + keyword combination
 *
 * Tracks temporal spans when the subject was discussed via timeRanges array
 */
export const SubjectRecipe = {
    $type$: 'Recipe',
    name: 'Subject',
    rule: [
        {
            itemprop: 'id',
            itemtype: { type: 'string' },
            isId: true // This makes Subject a versioned object
        },
        {
            itemprop: 'topic',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'keywords',
            itemtype: {
                type: 'bag',
                item: {
                    type: 'referenceToId',
                    allowedTypes: new Set(['Keyword'])
                }
            }
        },
        {
            itemprop: 'timeRanges',
            itemtype: {
                type: 'array',
                item: {
                    type: 'object',
                    rules: [
                        {
                            itemprop: 'start',
                            itemtype: { type: 'integer' }
                        },
                        {
                            itemprop: 'end',
                            itemtype: { type: 'integer' }
                        }
                    ]
                }
            }
        },
        {
            itemprop: 'messageCount',
            itemtype: { type: 'integer' }
        },
        {
            itemprop: 'createdAt',
            itemtype: { type: 'integer' }
        },
        {
            itemprop: 'lastSeenAt',
            itemtype: { type: 'integer' }
        },
        {
            itemprop: 'description',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'archived',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'likes',
            itemtype: { type: 'integer' },
            optional: true
        },
        {
            itemprop: 'dislikes',
            itemtype: { type: 'integer' },
            optional: true
        },
        {
            itemprop: 'abstractionLevel',
            itemtype: { type: 'integer' },
            optional: true
        },
        {
            itemprop: 'abstractionMetadata',
            itemtype: {
                type: 'object',
                rules: [
                    {
                        itemprop: 'calculatedAt',
                        itemtype: { type: 'integer' }
                    },
                    {
                        itemprop: 'reasoning',
                        itemtype: { type: 'string' },
                        optional: true
                    },
                    {
                        itemprop: 'parentLevels',
                        itemtype: {
                            type: 'array',
                            item: { type: 'integer' }
                        },
                        optional: true
                    },
                    {
                        itemprop: 'childLevels',
                        itemtype: {
                            type: 'array',
                            item: { type: 'integer' }
                        },
                        optional: true
                    }
                ]
            },
            optional: true
        }
    ]
};