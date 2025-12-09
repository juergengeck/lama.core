/**
 * ONE.core Recipe for Proposal
 *
 * Immutable recommendation to share knowledge from a past subject
 * Deterministic ID: topicId + pastSubject + currentSubject
 */

import type { Recipe } from '@refinio/one.core/lib/recipes.js';

export const ProposalRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Proposal',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^Proposal$/ }
        },
        {
            itemprop: 'topicId',
            itemtype: { type: 'string' },
            isId: true // Part of deterministic ID
        },
        {
            itemprop: 'pastSubject',
            itemtype: { type: 'string' },
            isId: true // Part of deterministic ID
        },
        {
            itemprop: 'currentSubject',
            itemtype: { type: 'string' },
            isId: true, // Part of deterministic ID
            optional: true // May be null for topic-level proposals
        },
        {
            itemprop: 'matchedKeywords',
            itemtype: { type: 'array', item: { type: 'string' } }
        },
        {
            itemprop: 'relevanceScore',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'sourceTopicId',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'pastSubjectName',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'createdAt',
            itemtype: { type: 'integer' }
        },
        {
            itemprop: '$versionHash$',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};
