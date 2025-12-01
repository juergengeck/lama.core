/**
 * ONE.core Recipe for Summary objects
 *
 * Summary is an unversioned snapshot of a Subject within a Topic.
 * Identity: (subject + topic) - one Summary per Subject per Topic.
 *
 * When subject switch is detected, the Summary for the previous subject
 * is created/replaced, then flows into Memory as a new version.
 *
 * Design principles:
 * - Unversioned (replacement, not append)
 * - Identity scoped to Subject + Topic
 * - prose content from analytics summaryUpdate
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
            itemprop: 'subject',
            itemtype: { type: 'string' },  // Subject IdHash being summarized
            isId: true
        },
        {
            itemprop: 'topic',
            itemtype: { type: 'string' },  // Topic IdHash (scope)
            isId: true
        },
        {
            itemprop: 'prose',
            itemtype: { type: 'string' }   // LLM-generated summary text
        }
    ]
};