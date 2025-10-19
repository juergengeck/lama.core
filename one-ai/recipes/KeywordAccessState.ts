/**
 * ONE.core Recipe for KeywordAccessState objects
 *
 * Represents access control state for a user or group regarding a specific keyword.
 * Follows ONE.core recipe pattern for versioned objects.
 */
export const KeywordAccessStateRecipe = {
    $type$: 'Recipe',
    name: 'KeywordAccessState',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^KeywordAccessState$/ }
        },
        {
            itemprop: 'keywordTerm',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'principalId',
            itemtype: { type: 'string' } // SHA256Hash
        },
        {
            itemprop: 'principalType',
            itemtype: { type: 'string', regexp: /^(user|group)$/ }
        },
        {
            itemprop: 'state',
            itemtype: { type: 'string', regexp: /^(allow|deny|none)$/ }
        },
        {
            itemprop: 'updatedAt',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'updatedBy',
            itemtype: { type: 'string' } // SHA256Hash
        }
    ]
};

/**
 * TypeScript interface for KeywordAccessState
 */
export interface KeywordAccessState {
    $type$: 'KeywordAccessState';
    keywordTerm: string;
    principalId: string; // SHA256Hash
    principalType: 'user' | 'group';
    state: 'allow' | 'deny' | 'none';
    updatedAt: string;
    updatedBy: string; // SHA256Hash
}

export type AccessStateValue = 'allow' | 'deny' | 'none';
export type PrincipalType = 'user' | 'group';
