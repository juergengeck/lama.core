/**
 * ONE.core Recipe for Feedback objects
 *
 * Feedback is a minimal user rating of content.
 * Identity is determined by target + author (one rating per person per target).
 *
 * Design principles:
 * - NO targetType: the collector (Subject) understands what targets it has
 * - NO timestamp: Story provides it via reverse map lookup
 * - Minimal: just (target, rating, author)
 */
export const FeedbackRecipe = {
    $type$: 'Recipe',
    name: 'Feedback',
    rule: [
        {
            itemprop: 'target',
            itemtype: { type: 'string' },  // IdHash of rated thing (Message, Memory, etc.)
            isId: true
        },
        {
            itemprop: 'author',
            itemtype: { type: 'string' },  // Person IdHash who gave feedback
            isId: true
        },
        {
            itemprop: 'rating',
            itemtype: { type: 'string' }   // 'like' | 'dislike'
        }
    ]
};
