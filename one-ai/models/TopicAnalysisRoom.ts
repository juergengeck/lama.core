import type { ChannelManager } from '@refinio/one.models/lib/models/index.js';
/**
 * TopicAnalysisRoom - Extension of TopicRoom for topic analysis functionality
 * Provides methods to retrieve Keywords, Subjects, and Summaries from a topic
 */

export default class TopicAnalysisRoom {
  public topicId: any;
  public channelManager: any;

    constructor(topicId: any, channelManager: any) {

        this.topicId = topicId;
        this.channelManager = channelManager;
}

    /**
     * Retrieve all keywords for this topic
     * Gets all keywords from channels matching this topicId
     */
    async retrieveAllKeywords(): Promise<any> {
        // Get channel infos to retrieve keyword objects
        const channelInfos = await this.channelManager.getMatchingChannelInfos({
            channelId: this.topicId
        });

        console.log(`[TopicAnalysisRoom] 🔍 getMatchingChannelInfos for "${this.topicId}" returned ${channelInfos.length} channels:`, channelInfos.map((ch: any) => ({id: ch.id, owner: ch.owner?.substring(0,8)})));

        if (!channelInfos || channelInfos.length === 0) {
            console.log(`[TopicAnalysisRoom] No channels found for topic ${this.topicId}, returning empty keywords`);
            return [];
        }

        // Get all keywords from channels
        const keywords = [];
        for await (const entry of this.channelManager.multiChannelObjectIterator(channelInfos)) {
            if (entry.data && entry.data.$type$ === 'Keyword') {
                keywords.push(entry.data);
            }
        }
        console.log(`[TopicAnalysisRoom] Found ${keywords.length} keyword objects in channels for topic ${this.topicId}`);

        keywords.sort((a, b) => {
            if (a.score !== b.score) {
                return b.score - a.score;
            }
            return b.lastSeen - a.lastSeen;
        });

        return keywords;
    }

    /**
     * Retrieve all subjects for this topic
     */
    async retrieveAllSubjects(): Promise<any> {
        const channelInfos = await this.channelManager.getMatchingChannelInfos({
            channelId: this.topicId
        });

        console.log(`[TopicAnalysisRoom] 🔍 retrieveAllSubjects for "${this.topicId}" - got ${channelInfos.length} channels:`, channelInfos.map((ch: any) => ({id: ch.id, owner: ch.owner?.substring(0,8)})));

        if (!channelInfos || channelInfos.length === 0) {
            throw new Error(`No channels found for topic: ${this.topicId}`);
        }

        const allSubjects = [];
        for await (const entry of this.channelManager.multiChannelObjectIterator(channelInfos)) {
            if (entry.data && entry.data.$type$ === 'Subject') {
                console.log(`[TopicAnalysisRoom] 🔍 Found Subject: id="${entry.data.id}", topic="${entry.data.topic}"`);
                if (entry.data.topic === this.topicId) {
                    allSubjects.push(entry.data);
                } else {
                    console.log(`[TopicAnalysisRoom] ⚠️  FILTERING OUT Subject with wrong topic: expected "${this.topicId}", got "${entry.data.topic}"`);
                }
            }
        }

        console.log(`[TopicAnalysisRoom] 🔍 After filtering: ${allSubjects.length} subjects for topic "${this.topicId}"`);
        return allSubjects;
    }

    /**
     * Retrieve all summaries for this topic
     */
    async retrieveAllSummaries(): Promise<any> {
        const channelInfos = await this.channelManager.getMatchingChannelInfos({
            channelId: this.topicId
        });

        if (!channelInfos || channelInfos.length === 0) {
            throw new Error(`No channels found for topic: ${this.topicId}`);
        }

        const summaries = [];
        for await (const entry of this.channelManager.multiChannelObjectIterator(channelInfos)) {
            if (entry.data && entry.data.$type$ === 'Summary') {
                summaries.push(entry.data);
            }
        }

        summaries.sort((a, b) => (b.version || 0) - (a.version || 0));

        return summaries;
    }

    /**
     * Retrieve the latest summary for this topic
     */
    async retrieveLatestSummary(): Promise<any> {
        const summaries = await this.retrieveAllSummaries();
        return summaries.length > 0 ? summaries[0] : null;
    }

    /**
     * Retrieve all analysis objects (keywords, subjects, summaries) in one go
     */
    async retrieveAllAnalysisObjects(): Promise<any> {
        const channelInfos = await this.channelManager.getMatchingChannelInfos({
            channelId: this.topicId
        });

        if (!channelInfos || channelInfos.length === 0) {
            throw new Error(`No channels found for topic: ${this.topicId}`);
        }

        const keywords = [];
        const subjects = [];
        const summaries = [];

        for await (const entry of this.channelManager.multiChannelObjectIterator(channelInfos)) {
            if (!entry.data || !entry.data.$type$) continue;

            switch (entry.data.$type$) {
                case 'Keyword':
                    keywords.push(entry.data);
                    break;
                case 'Subject':
                    if (entry.data.topic === this.topicId) {
                        subjects.push(entry.data);
                    }
                    break;
                case 'Summary':
                    summaries.push(entry.data);
                    break;
            }
        }

        summaries.sort((a, b) => (b.version || 0) - (a.version || 0));

        return {
            keywords,
            subjects,
            summaries
        };
    }
}