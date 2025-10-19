/**
 * Keyword Enrichment Service
 *
 * Stateless service for enriching keyword and subject data with runtime metadata.
 * Does NOT store enriched data - all fields are computed on demand.
 *
 * Architecture:
 * - Pure functions only (no side effects)
 * - No storage operations
 * - Fail-fast error handling (no fallbacks)
 * - Uses ChannelManager for topic metadata
 */

/**
 * Enrich keyword with topic references
 * Adds topicReferences array showing where the keyword appears
 *
 * @param {Object} keyword - Base keyword object from storage
 * @param {Array} subjects - Array of subjects containing this keyword
 * @param {Object} channelManager - ChannelManager instance for topic metadata
 * @returns {Promise<Object>} Keyword with topicReferences array
 */
async function enrichKeywordWithTopicReferences(keyword, subjects, channelManager) {
    if (!keyword || !keyword.term) {
        throw new Error('[KeywordEnrichment] keyword with term is required');
    }

    if (!Array.isArray(subjects)) {
        throw new Error('[KeywordEnrichment] subjects must be an array');
    }

    if (!channelManager) {
        throw new Error('[KeywordEnrichment] channelManager is required');
    }

    // Group subjects by topic
    const topicMap = new Map();

    for (const subject of subjects) {
        if (!subject.topic) {
            console.warn('[KeywordEnrichment] Subject missing topic, skipping:', subject);
            continue;
        }

        if (!topicMap.has(subject.topic)) {
            topicMap.set(subject.topic, {
                topicId: subject.topic,
                messageCount: 0,
                lastMessageDate: subject.lastSeen,
                authors: new Set()
            });
        }

        const topicData = topicMap.get(subject.topic);
        topicData.messageCount += subject.messageCount || 0;

        // Update last message date if this subject is more recent
        if (subject.lastSeen && (!topicData.lastMessageDate || subject.lastSeen > topicData.lastMessageDate)) {
            topicData.lastMessageDate = subject.lastSeen;
        }

        // Collect authors (would need to be extracted from messages in real implementation)
        // For now, we'll leave authors empty or use placeholder
    }

    // Build topic references array
    const topicReferences = [];

    for (const [topicId, data] of topicMap) {
        try {
            // Get topic name from ChannelManager
            let topicName = topicId; // Default to ID if name not found

            try {
                const channelInfos = await channelManager.getMatchingChannelInfos({
                    channelId: topicId
                });

                if (channelInfos && channelInfos.length > 0) {
                    // Try to get a readable name from channel info
                    topicName = channelInfos[0].name || topicId;
                }
            } catch (error) {
                console.warn(`[KeywordEnrichment] Could not get topic name for ${topicId}, using ID:`, error.message);
            }

            topicReferences.push({
                topicId,
                topicName,
                messageCount: data.messageCount,
                lastMessageDate: data.lastMessageDate,
                authors: Array.from(data.authors)
            });
        } catch (error) {
            // Skip topics that can't be enriched - don't throw
            console.warn(`[KeywordEnrichment] Skipping topic ${topicId} due to error:`, error.message);
        }
    }

    // Sort by last message date (most recent first)
    topicReferences.sort((a, b) => {
        if (!a.lastMessageDate) return 1;
        if (!b.lastMessageDate) return -1;
        return b.lastMessageDate.localeCompare(a.lastMessageDate);
    });

    console.log(`[KeywordEnrichment] Enriched keyword "${keyword.term}" with ${topicReferences.length} topic references`);

    return {
        ...keyword,
        topicReferences
    };
}

/**
 * Enrich subjects with metadata for sorting and display
 * Adds relevanceScore, placesMentioned, authors, sortTimestamp
 *
 * @param {Array} subjects - Array of subject objects
 * @param {Array} allSubjects - All subjects across topics (for calculating placesMentioned)
 * @returns {Promise<Array>} Array of enriched subjects
 */
async function enrichSubjectsWithMetadata(subjects, allSubjects = null) {
    if (!Array.isArray(subjects)) {
        throw new Error('[KeywordEnrichment] subjects must be an array');
    }

    // If allSubjects not provided, use subjects array (for single-topic queries)
    const subjectsToAnalyze = allSubjects || subjects;

    const enriched = subjects.map(subject => {
        // Calculate places mentioned (number of distinct topics referencing this keyword combination)
        // NOTE: Subject objects from storage use 'id' for keywordCombination and 'topic' for topicId
        const keywordCombo = subject.keywordCombination || subject.id;
        const placesMentioned = new Set(
            subjectsToAnalyze
                .filter(s => (s.keywordCombination || s.id) === keywordCombo)
                .map(s => s.topicId || s.topic)
        ).size;

        // Calculate relevance score
        const relevanceScore = calculateRelevanceScore(subject, placesMentioned);

        // Extract authors (would need message data in real implementation)
        const authors = []; // Placeholder

        // Sort timestamp is the last seen date
        // NOTE: Subject objects from storage use 'lastSeenAt' and 'createdAt' instead of 'lastSeen' and 'firstSeen'
        const sortTimestamp = subject.lastSeen || subject.lastSeenAt || subject.firstSeen || subject.createdAt || new Date().toISOString();

        return {
            ...subject,
            // Normalize field names for UI compatibility
            keywordCombination: keywordCombo,
            topicId: subject.topicId || subject.topic,
            lastSeen: subject.lastSeen || subject.lastSeenAt,
            firstSeen: subject.firstSeen || subject.createdAt,
            relevanceScore,
            placesMentioned,
            authors,
            sortTimestamp
        };
    });

    console.log(`[KeywordEnrichment] Enriched ${enriched.length} subjects with metadata`);

    return enriched;
}

/**
 * Calculate relevance score for a subject
 * Formula: (placesMentioned * 10) + (recencyFactor * 5) + (frequency * 2)
 *
 * @param {Object} subject - Subject object with lastSeen and messageCount
 * @param {number} placesMentioned - Number of distinct topics with this keyword
 * @returns {number} Relevance score
 */
function calculateRelevanceScore(subject, placesMentioned) {
    if (!subject) {
        throw new Error('[KeywordEnrichment] subject is required');
    }

    // Recency factor: 1 / (days since last seen + 1)
    let recencyFactor = 0;
    if (subject.lastSeen) {
        try {
            const lastSeenDate = new Date(subject.lastSeen);
            const now = new Date();
            const daysSinceLastSeen = (now.getTime() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24);
            recencyFactor = 1 / (daysSinceLastSeen + 1);
        } catch (error) {
            console.warn('[KeywordEnrichment] Invalid lastSeen date:', subject.lastSeen);
            recencyFactor = 0;
        }
    }

    // Frequency is message count
    const frequency = subject.messageCount || 0;

    // Calculate relevance score
    const relevanceScore = (placesMentioned * 10) + (recencyFactor * 5) + (frequency * 2);

    return Math.round(relevanceScore * 100) / 100; // Round to 2 decimal places
}

/**
 * Sort subjects by relevance score (descending)
 *
 * @param {Array} enrichedSubjects - Array of enriched subjects
 * @returns {Array} Sorted array
 */
function sortByRelevance(enrichedSubjects) {
    if (!Array.isArray(enrichedSubjects)) {
        throw new Error('[KeywordEnrichment] enrichedSubjects must be an array');
    }

    return enrichedSubjects.slice().sort((a, b) => {
        // Primary: relevance score (desc)
        if (a.relevanceScore !== b.relevanceScore) {
            return b.relevanceScore - a.relevanceScore;
        }

        // Secondary: message count (desc)
        if (a.messageCount !== b.messageCount) {
            return (b.messageCount || 0) - (a.messageCount || 0);
        }

        // Tertiary: last seen (desc)
        if (a.lastSeen && b.lastSeen) {
            return b.lastSeen.localeCompare(a.lastSeen);
        }

        return 0;
    });
}

/**
 * Sort subjects by time (most recent first)
 *
 * @param {Array} enrichedSubjects - Array of enriched subjects
 * @returns {Array} Sorted array
 */
function sortByTime(enrichedSubjects) {
    if (!Array.isArray(enrichedSubjects)) {
        throw new Error('[KeywordEnrichment] enrichedSubjects must be an array');
    }

    return enrichedSubjects.slice().sort((a, b) => {
        const aTime = a.sortTimestamp || a.lastSeen || a.firstSeen || '';
        const bTime = b.sortTimestamp || b.lastSeen || b.firstSeen || '';

        return bTime.localeCompare(aTime);
    });
}

/**
 * Sort subjects by author (alphabetically, then by time)
 * Note: This is a placeholder until we have proper author extraction
 *
 * @param {Array} enrichedSubjects - Array of enriched subjects
 * @returns {Array} Sorted array
 */
function sortByAuthor(enrichedSubjects) {
    if (!Array.isArray(enrichedSubjects)) {
        throw new Error('[KeywordEnrichment] enrichedSubjects must be an array');
    }

    return enrichedSubjects.slice().sort((a, b) => {
        // For now, sort by time since we don't have author data
        // In the future, this would sort by primary author name
        const aTime = a.sortTimestamp || a.lastSeen || a.firstSeen || '';
        const bTime = b.sortTimestamp || b.lastSeen || b.firstSeen || '';

        return bTime.localeCompare(aTime);
    });
}

export {
    enrichKeywordWithTopicReferences,
    enrichSubjectsWithMetadata,
    calculateRelevanceScore,
    sortByRelevance,
    sortByTime,
    sortByAuthor
};
