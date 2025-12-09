/**
 * ONE.core Recipe for Subject objects
 *
 * Subject represents a distinct theme or topic identified by keyword combination.
 *
 * DATA ARCHITECTURE:
 * - Subject stores data about its SOURCES (messages, memories, documents it describes)
 *   - timeRanges: when messages about this subject occurred (UI uses for scrolling)
 *   - createdAt/lastSeenAt: temporal bounds of source messages
 *   - messageCount: how many messages reference this subject
 *   - topics: which conversations contain this subject
 *   - memories: which memories are linked to this subject
 *
 * - Story/Assembly stores data about the SUBJECT OBJECT ITSELF
 *   - When the Subject was created/modified in the system
 *   - Who authored or modified the Subject
 *   - Version history of the Subject
 *
 * IDENTITY (ONE.core automatic):
 * - ID hash generated from sorted keywords (isId: true)
 * - Subjects with identical keywords get same ID hash (automatic deduplication)
 *
 * APPLICATION LOGIC (see Subject.ts):
 * - Detect semantic collisions (same keywords, different concepts)
 * - Add differentiating keywords when concepts diverge
 * - Compare descriptions to determine if versions align
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
        // Timestamp fields for message navigation
        // timeRanges: Array of time spans when subject was discussed (used by UI to scroll to messages)
        {
            itemprop: 'timeRanges',
            itemtype: {
                type: 'array',
                item: {
                    type: 'object',
                    rules: [
                        {
                            itemprop: 'start',
                            itemtype: { type: 'integer' }  // Unix timestamp of first message in range
                        },
                        {
                            itemprop: 'end',
                            itemtype: { type: 'integer' }  // Unix timestamp of last message in range
                        }
                    ]
                }
            }
        },
        {
            itemprop: 'createdAt',
            itemtype: { type: 'integer' }  // Unix timestamp when subject was first created
        },
        {
            itemprop: 'lastSeenAt',
            itemtype: { type: 'integer' }  // Unix timestamp when subject was last referenced
        },
        {
            itemprop: 'messageCount',
            itemtype: { type: 'integer' }  // Number of messages referencing this subject
        },
        // Content references
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
        },
        {
            itemprop: 'feedbackRefs',
            itemtype: {
                type: 'array',
                item: { type: 'string' }  // Feedback IdHashes
            }
        },
        // LLM-generated summary of this subject within the conversation context
        // Stored directly on Subject for quick access in proposals (avoids Summary lookup)
        {
            itemprop: 'summary',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};