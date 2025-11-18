/**
 * ONE.core Recipes for Proposal Interactions (Plan/Response Pattern)
 *
 * ProposalInteractionPlan: User's intent to interact with a proposal
 * ProposalInteractionResponse: Result of executing the plan
 */

import type { Recipe } from '@refinio/one.core/lib/recipes.js';

export const ProposalInteractionPlanRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'ProposalInteractionPlan',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^ProposalInteractionPlan$/ }
        },
        {
            itemprop: 'userEmail',
            itemtype: { type: 'string' },
            isId: true // Part of composite ID
        },
        {
            itemprop: 'proposalIdHash',
            itemtype: { type: 'string' },
            isId: true // Part of composite ID
        },
        {
            itemprop: 'action',
            itemtype: { type: 'string', regexp: /^(view|dismiss|share)$/ },
            isId: true // Part of composite ID
        },
        {
            itemprop: 'topicId',
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

export const ProposalInteractionResponseRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'ProposalInteractionResponse',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^ProposalInteractionResponse$/ }
        },
        {
            itemprop: 'plan',
            itemtype: { type: 'string' } // Reference to ProposalInteractionPlan hash
        },
        {
            itemprop: 'success',
            itemtype: { type: 'boolean' }
        },
        {
            itemprop: 'executedAt',
            itemtype: { type: 'integer' }
        },
        {
            itemprop: 'sharedToTopicId',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'viewDuration',
            itemtype: { type: 'integer' },
            optional: true
        },
        {
            itemprop: 'error',
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
