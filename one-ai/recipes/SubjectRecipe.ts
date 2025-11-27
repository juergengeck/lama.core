/**
 * ONE.core Recipe for Subject objects
 *
 * Subject represents a distinct theme or topic
 * Identified by keyword combination (keywords are the ID property)
 *
 * WHAT ONE.CORE DOES (automatic):
 * - Generates deterministic SHA256IdHash<Subject> from sorted keywords (isId: true)
 * - Subjects with identical keywords get same ID hash (automatic deduplication)
 *
 * WHAT APPLICATION LOGIC MUST DO (see Subject.ts):
 * - Detect semantic collisions (same keywords, different concepts)
 * - Add differentiating keywords when concepts diverge
 * - Compare descriptions to determine if versions align
 *
 * Subject references content (topics, memories) that discuss this theme.
 * Metadata (timeRanges, messageCount, etc.) lives in Story/Assembly, not in Subject.
 */
export const SubjectRecipe = {
    $type$: 'Recipe',
    name: 'Subject',
    rule: [
        {
            itemprop: 'keywords',
            itemtype: {
                type: 'bag',
                item: {
                    type: 'referenceToId',
                    allowedTypes: new Set(['Keyword'])
                }
            },
            isId: true, // Keywords determine identity - ONE.core auto-generates ID hash
            optional: true // Allow Subjects without keywords (for migration/legacy data)
        },
        {
            itemprop: 'description',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'abstractionLevel',
            itemtype: { type: 'integer' },
            optional: true
        },
        {
            itemprop: 'topics',
            itemtype: {
                type: 'array',
                item: { type: 'string' }
            }
        },
        {
            itemprop: 'memories',
            itemtype: {
                type: 'array',
                item: { type: 'string' }
            }
        }
    ]
};