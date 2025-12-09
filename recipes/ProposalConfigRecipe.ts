/**
 * ONE.core Recipe for ProposalConfig
 *
 * User configuration for proposal matching and ranking algorithm
 * Versioned object with userEmail as ID property
 */

import type { Recipe } from '@refinio/one.core/lib/recipes.js';

export const ProposalConfigRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'ProposalConfig',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^ProposalConfig$/ }
        },
        {
            itemprop: 'userEmail',
            itemtype: { type: 'string' },
            isId: true // Makes this a versioned object per user
        },
        {
            itemprop: 'matchWeight',
            itemtype: { type: 'number' } // 0.0 to 1.0
        },
        {
            itemprop: 'recencyWeight',
            itemtype: { type: 'number' } // 0.0 to 1.0
        },
        {
            itemprop: 'recencyWindow',
            itemtype: { type: 'integer' } // milliseconds
        },
        {
            itemprop: 'minJaccard',
            itemtype: { type: 'number' } // 0.0 to 1.0, minimum threshold
        },
        {
            itemprop: 'minSimilarity',
            itemtype: { type: 'number' }, // 0.0 to 1.0, semantic similarity threshold
            optional: true
        },
        {
            itemprop: 'maxProposals',
            itemtype: { type: 'integer' } // Maximum proposals to return
        },
        {
            itemprop: 'updatedAt',
            itemtype: { type: 'integer' } // Last update timestamp
        },
        {
            itemprop: '$versionHash$',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};
