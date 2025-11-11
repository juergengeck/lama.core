import type { ChannelManager } from '@refinio/one.models/lib/models/index.js';
/**
 * TopicAnalysisModel - ONE.core Model for topic analysis functionality
 * Following one.leute patterns for proper Model integration
 */

import { Model } from '@refinio/one.models/lib/models/Model.js';
import { OEvent } from '@refinio/one.models/lib/misc/OEvent.js';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import TopicAnalysisRoom from './TopicAnalysisRoom.js';
import type { Subject } from '../types/Subject.js';
import type { Keyword } from '../types/Keyword.js';

export default class TopicAnalysisModel extends Model {
  public channelManager: any;
  public topicModel: any;
  public disconnect: any;

    // Override base class event
    override onUpdated = new OEvent();

    // Cache for expensive queries (5-second TTL)
    private keywordsCache = new Map<string, { data: any[]; timestamp: number }>();
    private subjectsCache = new Map<string, { data: any[]; timestamp: number }>();
    private readonly CACHE_TTL = 5000; // 5 seconds

    constructor(channelManager: any, topicModel: any) {
        super();
        this.channelManager = channelManager;
        this.topicModel = topicModel;
}

    async init(): Promise<any> {
        this.state.assertCurrentState('Uninitialised');
        // No need to create a separate channel - we'll use existing conversation channels
        this.disconnect = this.channelManager.onUpdated(this.handleOnUpdated.bind(this));
        this.state.triggerEvent('init');
    }

    async shutdown(): Promise<any> {
        this.state.assertCurrentState('Initialised');
        if (this.disconnect) {
            this.disconnect();
        }
        this.state.triggerEvent('shutdown');
    }

    /**
     * Create a Subject object
     * Subjects track temporal ranges when they were discussed
     * @param topicId - Topic ID hash
     * @param keywordTerms - Array of keyword terms (strings)
     * @param keywordCombination - Combination string for subject ID
     * @param description - Subject description
     * @param confidence - Confidence score
     */
    async createSubject(topicId: any, keywordTerms: string[], keywordCombination: any, description: any, confidence: any): Promise<any> {
        this.state.assertCurrentState('Initialised');

        // Calculate Keyword ID hashes from terms
        const keywordIdHashes = [];

        for (const term of keywordTerms) {
            // Create a minimal Keyword ID object to calculate its ID hash
            // Only ID properties are needed for calculateIdHashOfObj
            const keywordIdObj = {
                $type$: 'Keyword' as const,
                term: term.toLowerCase().trim()
            };
            const keywordIdHash = await calculateIdHashOfObj(keywordIdObj as any);
            keywordIdHashes.push(keywordIdHash);
        }

        const now = Date.now();
        const subjectObj = {
            $type$: 'Subject' as const,
            id: keywordCombination, // Use keyword combination as ID
            topic: topicId, // Plain topic ID string (Topic is unversioned, not an ID object)
            keywords: keywordIdHashes, // Array of Keyword ID hashes
            timeRanges: [
                {
                    start: now,
                    end: now // Initially start = end, will be updated when subject is seen again
                }
            ],
            messageCount: 1,
            createdAt: now,
            lastSeenAt: now,
            description: description || undefined, // LLM-generated description
            archived: false
        };

        // STORE the versioned object first - this creates the vheads file for ID hash lookups
        console.log('[TopicAnalysisModel] 🔍 About to store Subject with ID:', keywordCombination);
        console.log('[TopicAnalysisModel] 🔍 Subject object:', JSON.stringify(subjectObj, null, 2));

        const result = await storeVersionedObject(subjectObj);

        console.log('[TopicAnalysisModel] ✅ Stored Subject with idHash:', result.idHash);
        console.log('[TopicAnalysisModel] ✅ Stored Subject with hash:', result.hash);

        // Also post to channel for sync (optional - if you want it to sync across instances)
        await this.channelManager.postToChannel(
            topicId,
            subjectObj
        );

        console.log('[TopicAnalysisModel] ✅ Posted Subject to channel:', topicId);
        return { ...subjectObj, idHash: result.idHash, hash: result.hash };
    }

    /**
     * Create a Keyword object in the topic's channel
     */
    async createKeyword(topicId: any, term: any, category: any, frequency: any, score: any): Promise<any> {
        this.state.assertCurrentState('Initialised');

        const now = Date.now();
        const keywordObj = {
            $type$: 'Keyword' as const,
            term: term.toLowerCase().trim(),
            frequency: frequency || 1,
            subjects: [],
            score: score || undefined,
            createdAt: now,
            lastSeen: now
        };

        // CRITICAL: Store as versioned object FIRST - creates vheads file for ID hash lookups
        const result = await storeVersionedObject(keywordObj);
        console.log('[TopicAnalysisModel] ✅ Stored Keyword with idHash:', result.idHash, 'term:', keywordObj.term);

        // Post to the conversation's channel for sync
        await this.channelManager.postToChannel(
            topicId,
            keywordObj
        );

        return { ...keywordObj, idHash: result.idHash, hash: result.hash };
    }

    /**
     * Create a Keyword with subject references
     */
    async createKeywordWithSubjects(topicId: any, term: any, subjectIds: string[], frequency: any, score: any): Promise<any> {
        this.state.assertCurrentState('Initialised');

        const now = Date.now();
        const keywordObj = {
            $type$: 'Keyword' as const,
            term: term.toLowerCase().trim(),
            frequency: frequency || 1,
            subjects: subjectIds || [],
            score: score || undefined,
            createdAt: now,
            lastSeen: now
        };

        // CRITICAL: Store as versioned object FIRST - creates vheads file for ID hash lookups
        const result = await storeVersionedObject(keywordObj);
        console.log('[TopicAnalysisModel] ✅ Stored Keyword with subjects, idHash:', result.idHash, 'term:', keywordObj.term);

        // Post to the conversation's channel for sync
        await this.channelManager.postToChannel(
            topicId,
            keywordObj
        );

        return { ...keywordObj, idHash: result.idHash, hash: result.hash };
    }

    /**
     * Add or update a keyword for a topic
     */
    async addKeyword(topicId: any, term: any): Promise<any> {
        this.state.assertCurrentState('Initialised');

        const normalizedTerm = term.toLowerCase().trim();

        // Fetch existing keyword directly by ID hash (term is the ID)
        const { calculateIdHashOfObj } = await import('@refinio/one.core/lib/util/object.js');
        const { getObjectByIdHash } = await import('@refinio/one.core/lib/storage-versioned-objects.js');
        const keywordIdHash = await calculateIdHashOfObj({ $type$: 'Keyword', term: normalizedTerm } as any);

        let existing;
        try {
            existing = await getObjectByIdHash(keywordIdHash);
        } catch (error) {
            // Keyword doesn't exist yet
            existing = null;
        }

        if (existing) {
            // Update frequency
            const now = Date.now();
            const updatedKeyword = {
                ...existing,
                $type$: 'Keyword' as const,
                frequency: (existing.frequency || 0) + 1,
                lastSeen: now,
                // Ensure timestamps are integers (fix migration issues)
                createdAt: typeof existing.createdAt === 'number' ? existing.createdAt : now
            };

            // Store updated version FIRST
            await storeVersionedObject(updatedKeyword);

            await this.channelManager.postToChannel(topicId, updatedKeyword);
            return updatedKeyword;
        }

        // Create new keyword
        return await this.createKeyword(topicId, term, 'general', 1, 1.0);
    }

    /**
     * Add or update a keyword linked to a specific subject
     * This enforces the rule: all keywords must belong to a subject
     * @param topicId - Topic ID
     * @param term - Keyword term
     * @param subjectIdHash - SHA256IdHash of the Subject this keyword belongs to
     */
    async addKeywordToSubject(topicId: any, term: any, subjectIdHash: any): Promise<any> {
        this.state.assertCurrentState('Initialised');

        console.log('[TopicAnalysisModel] 🔍 addKeywordToSubject called:', { topicId, term, subjectIdHash });

        if (!subjectIdHash) {
            throw new Error('Subject ID hash is required - keywords must be linked to subjects');
        }

        const normalizedTerm = term.toLowerCase().trim();

        // Fetch existing keyword directly by ID hash (term is the ID)
        const { calculateIdHashOfObj } = await import('@refinio/one.core/lib/util/object.js');
        const { getObjectByIdHash } = await import('@refinio/one.core/lib/storage-versioned-objects.js');
        const keywordIdHash = await calculateIdHashOfObj({ $type$: 'Keyword', term: normalizedTerm } as any);

        let existing;
        try {
            existing = await getObjectByIdHash(keywordIdHash);
        } catch (error) {
            // Keyword doesn't exist yet
            existing = null;
        }

        if (existing) {
            // Update frequency and link to subject if not already linked
            // CRITICAL: Preserve $type$ when updating (can be lost during retrieval)
            const now = Date.now();
            const updatedKeyword = {
                ...existing,
                $type$: 'Keyword' as const,
                frequency: (existing.frequency || 0) + 1,
                lastSeen: now,
                subjects: existing.subjects || [],
                // Ensure timestamps are integers (fix migration issues)
                createdAt: typeof existing.createdAt === 'number' ? existing.createdAt : now
            };
            if (!updatedKeyword.subjects.includes(subjectIdHash)) {
                updatedKeyword.subjects.push(subjectIdHash);
                console.log('[TopicAnalysisModel] ✅ Added subject ID hash to existing keyword:', { term: normalizedTerm, subjectIdHash, subjects: updatedKeyword.subjects });
            } else {
                console.log('[TopicAnalysisModel] ℹ️  Subject ID hash already in keyword:', { term: normalizedTerm, subjectIdHash });
            }

            // Store updated version FIRST
            await storeVersionedObject(updatedKeyword);

            await this.channelManager.postToChannel(topicId, updatedKeyword);
            return updatedKeyword;
        }

        // Create new keyword linked to subject
        // IMPORTANT: subjects field is a bag of SHA256IdHash references
        const now = Date.now();
        const keywordObj = {
            $type$: 'Keyword' as const,
            term: normalizedTerm,
            frequency: 1,
            subjects: [subjectIdHash], // Bag of Subject ID hashes
            score: 1.0,
            createdAt: now,
            lastSeen: now
        };

        // Store FIRST before posting to channel
        const result = await storeVersionedObject(keywordObj);

        console.log('[TopicAnalysisModel] ✅ Created new keyword with subject:', { term: normalizedTerm, topicId, subjectIdHash, subjects: keywordObj.subjects, idHash: result.idHash });
        await this.channelManager.postToChannel(topicId, keywordObj);
        return { ...keywordObj, idHash: result.idHash, hash: result.hash };
    }

    /**
     * Unarchive a subject
     */
    async unarchiveSubject(topicId: any, subjectId: any): Promise<any> {
        this.state.assertCurrentState('Initialised');

        const room = new TopicAnalysisRoom(topicId, this.channelManager);
        const subjects: any = await (room as any).retrieveAllSubjects();
        const subject = subjects.find((s: any) => s.id === subjectId);

        if (subject) {
            subject.archived = false;
            subject.lastSeen = new Date().toISOString();
            await this.channelManager.postToChannel(topicId, subject);
            return subject;
        }

        return null;
    }

    /**
     * Create a Summary object
     */
    async createSummary(topicId: any, version: any, content: any, subjects: any, changeReason: any, previousVersion: any): Promise<any> {
        this.state.assertCurrentState('Initialised');

        const now = Date.now();
        const summaryObj = {
            $type$: 'Summary',
            id: `${topicId}-v${version}`, // ID format: topicId-v1, topicId-v2, etc
            topic: topicId,
            content,
            subjects: subjects || [],
            keywords: [], // Will be populated from subjects
            version,
            previousVersion: previousVersion || undefined,
            createdAt: now,
            updatedAt: now,
            changeReason: changeReason || undefined
        };

        // Post to the conversation's channel
        await this.channelManager.postToChannel(
            topicId,
            summaryObj
        );

        return summaryObj;
    }

    /**
     * Get all subjects for a topic
     */
    async getSubjects(topicId: any, queryOptions = {}): Promise<Subject[]> {
        this.state.assertCurrentState('Initialised');

        // Check cache
        const cached = this.subjectsCache.get(topicId);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.data;
        }

        // Use TopicAnalysisRoom to retrieve subjects
        const analysisRoom = new TopicAnalysisRoom(topicId, this.channelManager);
        const subjects: Subject[] = await analysisRoom.retrieveAllSubjects();

        // Cache the result
        this.subjectsCache.set(topicId, {
            data: subjects,
            timestamp: Date.now()
        });

        return subjects;
    }

    /**
     * Get all keywords for a topic
     */
    async getKeywords(topicId: any, queryOptions = {}): Promise<Keyword[]> {
        this.state.assertCurrentState('Initialised');

        console.log(`[TopicAnalysisModel] getKeywords called for topic: ${topicId}`);

        // Check cache
        const cached = this.keywordsCache.get(topicId);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            console.log(`[TopicAnalysisModel] Returning ${cached.data.length} cached keywords`);
            return cached.data;
        }

        // WORKAROUND: Extract keywords from subjects instead of direct channel query
        // retrieveAllKeywords() hangs on multiChannelObjectIterator - likely malformed Keyword object
        const analysisRoom = new TopicAnalysisRoom(topicId, this.channelManager);
        const subjects = await analysisRoom.retrieveAllSubjects();
        console.log(`[TopicAnalysisModel] Found ${subjects.length} subjects for topic: ${topicId}`);

        // Collect unique keyword ID hashes from all subjects
        const keywordIdSet = new Set<string>();
        for (const subject of subjects) {
            if (subject.keywords && Array.isArray(subject.keywords)) {
                for (const keywordId of subject.keywords) {
                    keywordIdSet.add(keywordId);
                }
            }
        }

        // Fetch actual keyword objects by ID hash
        const { getObjectByIdHash } = await import('@refinio/one.core/lib/storage-versioned-objects.js');
        const keywords: Keyword[] = [];
        let missingKeywordCount = 0;
        for (const keywordId of keywordIdSet) {
            try {
                const keyword = await getObjectByIdHash(keywordId as any) as any;
                if (keyword && keyword.$type$ === 'Keyword') {
                    keywords.push(keyword as Keyword);
                }
            } catch (error: any) {
                // Skip missing keywords (can happen after storage clear or migration)
                if (error?.code === 'SB-READ2' && error?.type === 'vheads') {
                    missingKeywordCount++;
                    console.log(`[TopicAnalysisModel] Skipping missing keyword ${keywordId.substring(0, 8)}...`);
                } else {
                    console.error(`[TopicAnalysisModel] Failed to fetch keyword ${keywordId}:`, error);
                }
            }
        }

        if (missingKeywordCount > 0) {
            console.log(`[TopicAnalysisModel] ⚠️  Skipped ${missingKeywordCount} missing keywords (likely from old subjects)`);
        }

        // Cache the result
        this.keywordsCache.set(topicId, {
            data: keywords,
            timestamp: Date.now()
        });

        return keywords;
    }

    /**
     * Get all topic IDs
     * Used for cross-topic analysis and proposal generation
     */
    async getAllTopics(): Promise<string[]> {
        this.state.assertCurrentState('Initialised');

        console.log('[TopicAnalysisModel] getAllTopics called');

        // Get all topics from TopicModel
        const allTopics = await this.topicModel.getTopics();

        console.log('[TopicAnalysisModel] Found topics:', {
            topicCount: allTopics?.length || 0
        });

        // Return just the topic IDs
        return (allTopics || []).map((topic: any) => topic.id);
    }

    /**
     * Get all subjects across all topics
     * Used for global keyword aggregation and cross-topic analysis
     */
    async getAllSubjects(): Promise<any[]> {
        this.state.assertCurrentState('Initialised');

        console.log('[TopicAnalysisModel] getAllSubjects called');

        // Get all topics from TopicModel
        const allTopics = await this.topicModel.getTopics();

        console.log('[TopicAnalysisModel] Found topics:', {
            topicCount: allTopics?.length || 0
        });

        // Aggregate subjects from all topics
        const allSubjects: any[] = [];

        for (const topic of allTopics || []) {
            try {
                const topicSubjects: any = await this.getSubjects(topic.id);
                if (Array.isArray(topicSubjects)) {
                    // Add topic context to each subject for reference
                    const subjectsWithTopic = topicSubjects.map(s => ({
                        ...s,
                        topicId: topic.id,
                        topicName: topic.name || topic.id
                    }));
                    allSubjects.push(...subjectsWithTopic);
                }
            } catch (err) {
                console.error('[TopicAnalysisModel] Error getting subjects for topic:', topic.id, err);
            }
        }

        console.log('[TopicAnalysisModel] Retrieved all subjects:', {
            topicCount: allTopics?.length || 0,
            totalSubjects: allSubjects.length
        });

        return allSubjects;
    }

    /**
     * Get all keywords across all topics
     * Used for global keyword aggregation and statistics
     */
    async getAllKeywords(): Promise<any[]> {
        this.state.assertCurrentState('Initialised');

        console.log('[TopicAnalysisModel] getAllKeywords called');

        // Get all topics from TopicModel
        const allTopics = await this.topicModel.getTopics();

        console.log('[TopicAnalysisModel] Found topics:', {
            topicCount: allTopics?.length || 0
        });

        // Aggregate keywords from all topics
        const allKeywords: any[] = [];

        for (const topic of allTopics || []) {
            try {
                const topicKeywords: any = await this.getKeywords(topic.id);
                if (Array.isArray(topicKeywords)) {
                    // Add topic context to each keyword for reference
                    const keywordsWithTopic = topicKeywords.map(k => ({
                        ...k,
                        topicId: topic.id,
                        topicName: topic.name || topic.id
                    }));
                    allKeywords.push(...keywordsWithTopic);
                }
            } catch (err) {
                console.error('[TopicAnalysisModel] Error getting keywords for topic:', topic.id, err);
            }
        }

        console.log('[TopicAnalysisModel] Retrieved all keywords:', {
            topicCount: allTopics?.length || 0,
            totalKeywords: allKeywords.length
        });

        return allKeywords;
    }

    /**
     * Get a single keyword by term
     * Uses proper ONE.core channel retrieval instead of direct storage access
     */
    async getKeywordByTerm(topicId: any, term: string): Promise<any | null> {
        this.state.assertCurrentState('Initialised');

        const normalizedTerm = term.toLowerCase().trim();

        // Use ONE.core's channel-based retrieval - same path as storage
        const room = new TopicAnalysisRoom(topicId, this.channelManager);
        const allKeywords: any = await (room as any).retrieveAllKeywords();

        // Find the keyword by term
        const keyword = allKeywords.find((k: any) => k.term === normalizedTerm);

        console.log('[TopicAnalysisModel] Keyword lookup via channel:', {
            term: normalizedTerm,
            totalKeywords: allKeywords.length,
            sampleKeywords: allKeywords.slice(0, 3).map((k: any) => k.term),
            found: !!keyword
        });

        return keyword || null;
    }

    /**
     * Find subjects that contain a specific keyword
     * This enables subject lookup from keywords
     */
    async findSubjectsByKeyword(topicId: any, keyword: any): Promise<any[]> {
        this.state.assertCurrentState('Initialised');

        const normalizedKeyword = keyword.toLowerCase().trim();
        const subjects: any = await this.getSubjects(topicId);

        // Find all subjects that have this keyword
        const matchingSubjects = subjects.filter((subject: any) =>
            subject.keywords?.some((k: any) => k.toLowerCase() === normalizedKeyword)
        );

        console.log('[TopicAnalysisModel] Found subjects by keyword:', {
            topicId,
            keyword: normalizedKeyword,
            matchCount: matchingSubjects.length
        });

        return matchingSubjects;
    }

    /**
     * Get the keyword object and its associated subjects
     */
    async getKeywordWithSubjects(topicId: any, term: any): Promise<any> {
        this.state.assertCurrentState('Initialised');

        const normalizedTerm = term.toLowerCase().trim();
        const keywords: any = await this.getKeywords(topicId);
        const keyword = keywords.find((k: any) => k.term === normalizedTerm);

        if (!keyword) {
            return null;
        }

        // Get subjects associated with this keyword
        const subjectKeywordCombinations = keyword.subjects || [];
        const allSubjects: any = await this.getSubjects(topicId);
        const associatedSubjects = allSubjects.filter((s: any) =>
            subjectKeywordCombinations.includes(s.keywordCombination)
        );

        return {
            ...keyword,
            associatedSubjects
        };
    }

    /**
     * Get summaries for a topic
     */
    async getSummaries(topicId: any, queryOptions = {}): Promise<unknown> {
        this.state.assertCurrentState('Initialised');

        // Use TopicAnalysisRoom to retrieve summaries
        const analysisRoom = new TopicAnalysisRoom(topicId, this.channelManager);
        const summaries: any = await (analysisRoom as any).retrieveAllSummaries();

        console.log('[TopicAnalysisModel] Retrieved summaries:', {
            topicId,
            summaryCount: summaries.length,
            latestVersion: summaries.length > 0 ? summaries[0].version : null
        });

        return summaries;
    }

    /**
     * Get current summary for a topic (highest version)
     */
    async getCurrentSummary(topicId: any): Promise<any> {
        this.state.assertCurrentState('Initialised');

        // Use TopicAnalysisRoom to retrieve the latest summary directly
        const analysisRoom = new TopicAnalysisRoom(topicId, this.channelManager);
        const summary: any = await (analysisRoom as any).retrieveLatestSummary();

        console.log('[TopicAnalysisModel] Retrieved current summary:', {
            topicId,
            found: !!summary,
            version: summary?.version,
            contentLength: summary?.content?.length
        });

        return summary;
    }

    /**
     * Iterator for subjects
     */
    async *subjectsIterator(topicId: any, queryOptions = {}) {
        this.state.assertCurrentState('Initialised');

        const subjects: any = await this.getSubjects(topicId, queryOptions);
        for (const subject of subjects) {
            yield subject;
        }
    }

    /**
     * Iterator for keywords
     */
    async *keywordsIterator(topicId: any, queryOptions = {}) {
        this.state.assertCurrentState('Initialised');

        const keywords: any = await this.getKeywords(topicId, queryOptions);
        for (const keyword of keywords) {
            yield keyword;
        }
    }

    /**
     * Find keyword by term in a topic
     */
    async findKeywordByTerm(topicId: any, term: any): Promise<any> {
        this.state.assertCurrentState('Initialised');
        const normalizedTerm = term.toLowerCase().trim();

        for await (const keyword of this.keywordsIterator(topicId)) {
            if (keyword.term === normalizedTerm) {
                return keyword;
            }
        }

        return null;
    }

    /**
     * Get or create keyword
     */
    async getOrCreateKeyword(topicId: any, term: any, category = null, frequency = 1, score = 0): Promise<unknown> {
        const existingKeyword: any = await this.findKeywordByTerm(topicId, term);

        if (existingKeyword) {
            return existingKeyword;
        }

        return await this.createKeyword(topicId, term, category, frequency, score);
    }

    /**
     * Handle channel updates
     */
    async handleOnUpdated(_channelInfoIdHash: any, channelId: any, _channelOwner: any, timeOfEarliestChange: any): Promise<any> {
        // Emit update for any channel that might contain our analysis objects
        this.onUpdated.emit(timeOfEarliestChange);
    }

    /**
     * Update topic summary with incremental changes
     * @param {string} topicId - The topic ID
     * @param {string} updateContent - The incremental update content
     * @param {number} confidence - Confidence score for the update
     * @returns {Promise<Object>} The updated summary object
     */
    async updateSummary(topicId: any, updateContent: any, confidence = 0.8): Promise<unknown> {
        // Get current summary
        const currentSummary: any = await this.getCurrentSummary(topicId);

        if (!currentSummary) {
            // Create first summary if none exists
            const subjects: any = await this.getSubjects(topicId);
            return await this.createSummary(
                topicId,
                1,
                updateContent,
                subjects.map((s: any) => s.id),
                'Initial summary from message analysis',
                null
            );
        }

        // Create new version with incremental update
        const newVersion = currentSummary.version + 1;
        const subjects: any = await this.getSubjects(topicId);

        // Combine existing content with update
        const updatedContent = currentSummary.content + '\n\nUpdate: ' + updateContent;

        return await this.createSummary(
            topicId,
            newVersion,
            updatedContent,
            subjects.map((s: any) => s.id),
            'Incremental update from message analysis',
            currentSummary.id
        );
    }
}