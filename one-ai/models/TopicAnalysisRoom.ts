import type { ChannelManager } from '@refinio/one.models/lib/models/index.js';
import type { Subject } from '../types/Subject.js';
import type { Keyword } from '../types/Keyword.js';

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
    async retrieveAllKeywords(): Promise<Keyword[]> {
        // Get channel infos to retrieve keyword objects
        const channelInfos = await this.channelManager.getMatchingChannelInfos({
            channelId: this.topicId
        });

        if (!channelInfos || channelInfos.length === 0) {
            return [];
        }

        // Get all keywords from channels
        const keywords = [];
        for await (const entry of this.channelManager.multiChannelObjectIterator(channelInfos)) {
            if (entry.data && entry.data.$type$ === 'Keyword') {
                keywords.push(entry.data);
            }
        }

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
    async retrieveAllSubjects(): Promise<Subject[]> {
        const channelInfos = await this.channelManager.getMatchingChannelInfos({
            channelId: this.topicId
        });

        if (!channelInfos || channelInfos.length === 0) {
            return [];
        }

        const allSubjects = [];
        for await (const entry of this.channelManager.multiChannelObjectIterator(channelInfos)) {
            if (entry.data && entry.data.$type$ === 'Subject') {
                if (entry.data.topic === this.topicId) {
                    allSubjects.push(entry.data);
                }
            }
        }

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
            return [];
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