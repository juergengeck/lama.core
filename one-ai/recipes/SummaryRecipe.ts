/**
 * ONE.core Recipe for Summary objects
 *
 * Summary of a topic conversation with versioning support
 * Supports version history with previousVersion linking
 */
export const SummaryRecipe = {
    $type$: 'Recipe',
    name: 'Summary',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^Summary$/ }
        },
        {
            itemprop: 'id',
            itemtype: { type: 'string' },
            isId: true // This makes Summary a versioned object
        },
        {
            itemprop: 'topic',
            itemtype: { type: 'string' } // Reference to parent Topic
        },
        {
            itemprop: 'content',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'subjects',
            itemtype: {
                type: 'array',
                item: { type: 'string' } // Subject IDs referenced in this summary
            }
        },
        {
            itemprop: 'keywords',
            itemtype: {
                type: 'array',
                item: { type: 'string' } // All keywords from all subjects
            }
        },
        {
            itemprop: 'version',
            itemtype: { type: 'integer' }
        },
        {
            itemprop: 'previousVersion',
            itemtype: { type: 'string' },
            optional: true // Hash of previous summary version
        },
        {
            itemprop: 'createdAt',
            itemtype: { type: 'integer' }
        },
        {
            itemprop: 'updatedAt',
            itemtype: { type: 'integer' }
        },
        {
            itemprop: 'changeReason',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'hash',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: '$versionHash$',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};