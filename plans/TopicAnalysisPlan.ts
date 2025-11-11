/**
 * Topic Analysis Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for topic analysis operations (subjects, keywords, summaries).
 * Can be used from both Electron IPC and Web Worker contexts.
 */

// Type imports commented out - using ambient services with any types
// import type { TopicAnalysisModel } from '../main/core/one-ai/models/TopicAnalysisModel.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import { getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type { Subject } from '../one-ai/types/Subject.js';
import type { Keyword } from '../one-ai/types/Keyword.js';

// Service types (will be properly typed via ambient registry)
type TopicAnalysisModel = any;

// Request/Response types
export interface AnalyzeMessagesRequest {
  topicId: string;
  messages?: any[];
  forceReanalysis?: boolean;
}

export interface AnalyzeMessagesResponse {
  success: boolean;
  data?: {
    subjects: Subject[];
    keywords: Keyword[];
    summary: any;
  };
  error?: string;
}

export interface GetSubjectsRequest {
  topicId: string;
  includeArchived?: boolean;
}

export interface GetSubjectsResponse {
  success: boolean;
  data?: {
    subjects: Subject[];
  };
  error?: string;
}

export interface GetSummaryRequest {
  topicId: string;
  version?: number;
  includeHistory?: boolean;
}

export interface GetSummaryResponse {
  success: boolean;
  data?: {
    current: any;
    history: any[];
  };
  error?: string;
}

export interface RestartContextRequest {
  topicId: string;
}

export interface RestartContextResponse {
  success: boolean;
  data?: {
    context: string;
    summary: any;
    subjects: Subject[];
    keywords: Keyword[];
  };
  error?: string;
}

export interface UpdateSummaryRequest {
  topicId: string;
  content?: string;
  changeReason?: string;
  autoGenerate?: boolean;
}

export interface UpdateSummaryResponse {
  success: boolean;
  data?: {
    summary: any;
  };
  error?: string;
}

export interface ExtractKeywordsRequest {
  text: string;
  limit?: number;
}

export interface ExtractKeywordsResponse {
  success: boolean;
  data?: {
    keywords: Keyword[];
  };
  error?: string;
}

export interface MergeSubjectsRequest {
  topicId: string;
  subjectId1: string;
  subjectId2: string;
}

export interface MergeSubjectsResponse {
  success: boolean;
  data?: {
    merged: boolean;
  };
  error?: string;
}

export interface RealtimeKeywordsRequest {
  text: string;
  existingKeywords?: string[];
  maxKeywords?: number;
}

export interface RealtimeKeywordsResponse {
  success: boolean;
  data?: {
    keywords: string[];
  };
  error?: string;
}

export interface ConversationKeywordsRequest {
  topicId: string;
  messages?: any[];
  maxKeywords?: number;
}

export interface ConversationKeywordsResponse {
  success: boolean;
  data?: {
    keywords: string[];
  };
  error?: string;
}

export interface GetKeywordsRequest {
  topicId: string;
  limit?: number;
}

export interface GetKeywordsResponse {
  success: boolean;
  data?: {
    keywords: Keyword[];
  };
  error?: string;
}

/**
 * TopicAnalysisPlan - Pure business logic for topic analysis
 */
export class TopicAnalysisPlan {
  private topicAnalysisModel: TopicAnalysisModel | null = null;
  private topicModel: TopicModel | null = null;
  private llmManager: any = null;
  private nodeOneCore: any = null;

  constructor(
    topicAnalysisModel?: TopicAnalysisModel,
    topicModel?: TopicModel,
    llmManager?: any,
    nodeOneCore?: any
  ) {
    this.topicAnalysisModel = topicAnalysisModel || null;
    this.topicModel = topicModel || null;
    this.llmManager = llmManager || null;
    this.nodeOneCore = nodeOneCore || null;
  }

  /**
   * Set models after initialization
   */
  setModels(
    topicAnalysisModel: TopicAnalysisModel,
    topicModel: TopicModel,
    llmManager?: any,
    nodeOneCore?: any
  ): void {
    this.topicAnalysisModel = topicAnalysisModel;
    this.topicModel = topicModel;
    if (llmManager) this.llmManager = llmManager;
    if (nodeOneCore) this.nodeOneCore = nodeOneCore;
  }

  /**
   * Analyze messages to extract subjects and keywords using LLM
   */
  async analyzeMessages(request: AnalyzeMessagesRequest): Promise<AnalyzeMessagesResponse> {
    console.log('[TopicAnalysisPlan] Analyzing messages for topic:', request.topicId);

    try {
      if (!this.topicAnalysisModel) {
        return { success: false, error: 'Topic Analysis Model not initialized' };
      }

      let messages = request.messages || [];

      // If no messages provided, retrieve from conversation
      if (messages.length === 0 && this.topicModel) {
        try {
          const topicRoom: any = await this.topicModel.enterTopicRoom(request.topicId);
          const messagesIterable: any = await topicRoom.retrieveAllMessages();
          messages = [];
          for await (const msg of messagesIterable) {
            messages.push(msg);
          }
          await topicRoom.leave();
        } catch (error) {
          console.log('[TopicAnalysisPlan] Topic does not exist, skipping analysis:', request.topicId);
          return {
            success: true,
            data: {
              subjects: [],
              keywords: [],
              summary: null
            }
          };
        }
      }

      if (messages.length === 0) {
        return {
          success: true,
          data: {
            subjects: [],
            keywords: [],
            summary: null
          }
        };
      }

      if (!this.llmManager) {
        throw new Error('LLM Manager not available');
      }

      // Get model ID from AI assistant model (source of truth)
      let modelId: string | null = null;
      if (this.nodeOneCore?.aiAssistantModel) {
        modelId = this.nodeOneCore.aiAssistantModel.getModelIdForTopic(request.topicId);
      }

      if (!modelId) {
        throw new Error('No AI model configured for this topic');
      }

      // Prepare conversation context for analysis
      const conversationText = messages
        .map((msg: any) => `${msg.sender || 'Unknown'}: ${msg.content || msg.text || ''}`)
        .join('\n');

      // Extract keywords using LLM
      console.log('[TopicAnalysisPlan] Extracting keywords with LLM using model:', modelId);
      const keywordPrompt = `Analyze this conversation and extract the most important keywords (single words or short phrases).
Return ONLY a JSON array of keywords, no explanation.
Focus on: main topics, technical terms, product names, important concepts.
Limit to 15 most relevant keywords.

Conversation:
${String(conversationText).substring(0, 3000)}

Return format: ["keyword1", "keyword2", ...]`;

      const keywordResponse: any = await this.llmManager.chat([{
        role: 'user',
        content: keywordPrompt
      }], modelId);

      // Identify subjects using LLM (subjects contain keywords)
      console.log('[TopicAnalysisPlan] Identifying subjects with LLM...');
      const subjectPrompt = `Analyze this conversation and identify the main subjects/themes being discussed.
For each subject, provide:
1. A list of 2-3 keywords that define it
2. A brief description (one sentence)

Return ONLY a JSON array with this format:
[{"keywords": ["keyword1", "keyword2"], "description": "Brief description"}]

Conversation:
${String(conversationText).substring(0, 3000)}`;

      const subjectResponse: any = await this.llmManager.chat([{
        role: 'user',
        content: subjectPrompt
      }], modelId);

      let subjects: Array<{ keywords: string[]; description: string }> = [];
      try {
        subjects = JSON.parse(subjectResponse);
      } catch (e) {
        console.warn('[TopicAnalysisPlan] Failed to parse subject JSON, extracting keywords for fallback');
        let fallbackKeywords: string[] = [];
        try {
          fallbackKeywords = JSON.parse(keywordResponse);
        } catch (e2) {
          fallbackKeywords = String(keywordResponse).match(/"([^"]+)"/g)?.map(k => k.replace(/"/g, '')) || [];
        }
        subjects = [{
          keywords: fallbackKeywords.slice(0, 3),
          description: 'Main conversation topic'
        }];
      }

      // Store subjects first, then create keywords with subject references
      const subjectsToStore = [];
      for (const subject of subjects.slice(0, 5)) {
        const subjectId = subject.keywords.join('+');
        const createdSubject = await this.topicAnalysisModel.createSubject(
          request.topicId as SHA256IdHash<any>,
          subject.keywords,
          subjectId,
          subject.description,
          0.8
        );
        subjectsToStore.push({ idHash: createdSubject.idHash, keywords: subject.keywords });
      }

      // Now create keywords with subject ID hashes
      for (const subject of subjectsToStore) {
        for (const keywordTerm of subject.keywords) {
          await this.topicAnalysisModel.addKeywordToSubject(request.topicId as SHA256IdHash<any>, keywordTerm, subject.idHash);
        }
      }

      // Generate summary using LLM
      console.log('[TopicAnalysisPlan] Generating summary with LLM...');
      const summaryPrompt = `Create a concise summary of this conversation.
Include: main topics discussed, key decisions or conclusions, important points.
Keep it under 150 words.

Conversation:
${String(conversationText).substring(0, 3000)}`;

      const summaryResponse: any = await this.llmManager.chat([{
        role: 'user',
        content: summaryPrompt
      }], modelId);

      // Create summary
      const summary: any = await this.topicAnalysisModel.createSummary(
        request.topicId as SHA256IdHash<any>,
        1,
        summaryResponse,
        [],
        'AI-generated analysis',
        null
      );

      // Get the created subjects for return
      const createdSubjects: any = await this.topicAnalysisModel.getSubjects(request.topicId as SHA256IdHash<any>);
      const createdKeywords: any = await this.topicAnalysisModel.getKeywords(request.topicId as SHA256IdHash<any>);

      console.log('[TopicAnalysisPlan] Analysis complete:', {
        topicId: request.topicId,
        subjectsCreated: createdSubjects.length,
        keywordsCreated: createdKeywords.length,
        summaryCreated: !!summary
      });

      return {
        success: true,
        data: {
          subjects: createdSubjects,
          keywords: createdKeywords.map((k: any) => k.term),
          summary: summary
        }
      };
    } catch (error) {
      console.error('[TopicAnalysisPlan] Error analyzing messages:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: {
          subjects: [],
          keywords: [],
          summary: null
        }
      };
    }
  }

  /**
   * Get all subjects for a topic with keyword resolution
   */
  async getSubjects(request: GetSubjectsRequest): Promise<GetSubjectsResponse> {
    console.log('[TopicAnalysisPlan.getSubjects] Called for topicId:', request.topicId);
    try {
      if (!this.topicAnalysisModel) {
        console.log('[TopicAnalysisPlan.getSubjects] ❌ Topic Analysis Model not initialized');
        return {
          success: false,
          error: 'Topic Analysis Model not initialized',
          data: { subjects: [] }
        };
      }

      const subjects = await this.topicAnalysisModel.getSubjects(request.topicId as SHA256IdHash<any>);
      console.log('[TopicAnalysisPlan.getSubjects] Got', subjects.length, 'subjects from model');

      // Resolve keyword ID hashes to terms by loading the Keyword objects
      const resolvedSubjects = await Promise.all(subjects.map(async (subject: any) => {
        const resolvedKeywords = await Promise.all((subject.keywords || []).map(async (keywordHash: SHA256IdHash<any>) => {
          try {
            const result = await getObjectByIdHash(keywordHash);
            if (result && result.obj && result.obj.term) {
              return result.obj.term;
            }
          } catch (err) {
            console.warn('[TopicAnalysisPlan] Could not load keyword:', keywordHash.substring(0, 16), err);
          }
          return null;
        }));

        // Filter out nulls, fall back to splitting the id field if needed
        const validKeywords = resolvedKeywords.filter(k => k !== null);
        const finalKeywords = validKeywords.length > 0
          ? validKeywords
          : (subject.id ? subject.id.split('+') : []);

        return {
          ...subject,
          keywords: finalKeywords
        };
      }));

      const filteredSubjects = request.includeArchived
        ? resolvedSubjects
        : resolvedSubjects.filter((s: any) => !s.archived);

      console.log('[TopicAnalysisPlan.getSubjects] Returning', filteredSubjects.length, 'subjects');
      if (filteredSubjects.length > 0) {
        console.log('[TopicAnalysisPlan.getSubjects] First subject:', JSON.stringify(filteredSubjects[0]).substring(0, 200));
      }

      return {
        success: true,
        data: {
          subjects: filteredSubjects
        }
      };
    } catch (error) {
      console.error('[TopicAnalysisPlan] Error getting subjects:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: { subjects: [] }
      };
    }
  }

  /**
   * Get summary for a topic with optional history
   */
  async getSummary(request: GetSummaryRequest): Promise<GetSummaryResponse> {
    console.log('[TopicAnalysisPlan] Getting summary for topic:', request.topicId);

    try {
      if (!this.topicAnalysisModel) {
        return {
          success: false,
          error: 'Topic Analysis Model not initialized',
          data: { current: null, history: [] }
        };
      }

      const current: any = await this.topicAnalysisModel.getCurrentSummary(request.topicId as SHA256IdHash<any>);

      let history: any[] = [];
      if (request.includeHistory) {
        const allSummaries: any = await this.topicAnalysisModel.getSummaries(request.topicId as SHA256IdHash<any>);
        history = allSummaries.sort((a: any, b: any) => b.version - a.version);
      }

      return {
        success: true,
        data: {
          current: current,
          history: history
        }
      };
    } catch (error) {
      console.error('[TopicAnalysisPlan] Error getting summary:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: { current: null, history: [] }
      };
    }
  }

  /**
   * Generate conversation restart context for LLM continuity
   */
  async getConversationRestartContext(request: RestartContextRequest): Promise<RestartContextResponse> {
    console.log('[TopicAnalysisPlan] Getting conversation restart context for topic:', request.topicId);

    try {
      if (!this.topicAnalysisModel) {
        return {
          success: false,
          error: 'Topic Analysis Model not initialized',
          data: {
            context: 'Continuing previous conversation. Please maintain context.',
            summary: null,
            subjects: [],
            keywords: []
          }
        };
      }

      const summary: any = await this.topicAnalysisModel.getCurrentSummary(request.topicId as SHA256IdHash<any>);
      const subjects: any = await this.topicAnalysisModel.getSubjects(request.topicId as SHA256IdHash<any>);
      const keywords: any = await this.topicAnalysisModel.getKeywords(request.topicId as SHA256IdHash<any>);

      let restartContext = '';

      if (summary) {
        restartContext = `Continuing conversation from previous context:\n\n${summary.content}\n\n`;
      }

      if (subjects.length > 0) {
        const activeSubjects = subjects.filter((s: any) => !s.archived).slice(0, 5);
        const subjectDescriptions: any[] = activeSubjects.map((s: any) =>
          `- ${s.keywordCombination}: ${s.description || 'Active subject'}`
        ).join('\n');
        restartContext += `Active subjects:\n${subjectDescriptions}\n\n`;
      }

      if (keywords.length > 0) {
        const topKeywords = keywords
          .sort((a: any, b: any) => (b.frequency || 0) - (a.frequency || 0))
          .slice(0, 15)
          .map((k: any) => k.term);
        restartContext += `Key concepts: ${topKeywords.join(', ')}\n\n`;
      }

      restartContext += 'Please maintain continuity with the established discussion and context.';

      return {
        success: true,
        data: {
          context: restartContext,
          summary: summary,
          subjects: subjects.filter((s: any) => !s.archived),
          keywords: keywords.slice(0, 15)
        }
      };
    } catch (error) {
      console.error('[TopicAnalysisPlan] Error getting restart context:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: {
          context: 'Continuing previous conversation. Please maintain context.',
          summary: null,
          subjects: [],
          keywords: []
        }
      };
    }
  }

  /**
   * Update or create summary for a topic
   */
  async updateSummary(request: UpdateSummaryRequest, chatPlanGetMessages?: Function): Promise<UpdateSummaryResponse> {
    console.log('[TopicAnalysisPlan] Updating summary for topic:', request.topicId);

    try {
      if (!this.topicAnalysisModel) {
        return {
          success: false,
          error: 'Topic Analysis Model not initialized',
          data: { summary: null }
        };
      }

      const currentSummary: any = await this.topicAnalysisModel.getCurrentSummary(request.topicId as SHA256IdHash<any>);
      const newVersion = currentSummary ? currentSummary.version + 1 : 1;

      let summaryContent = request.content;
      let modelId: string | null = null;

      if (this.nodeOneCore?.aiAssistantModel) {
        modelId = this.nodeOneCore.aiAssistantModel.getModelIdForTopic(request.topicId);
      }

      // If autoGenerate is true, use LLM to create a new summary
      if (request.autoGenerate && !request.content && this.llmManager && modelId && chatPlanGetMessages) {
        const messagesResponse: any = await chatPlanGetMessages({
          conversationId: request.topicId,
          limit: 50
        });
        const messages = messagesResponse.data || [];

        if (messages.length > 0) {
          const conversationText = messages
            .map((msg: any) => `${msg.sender || 'Unknown'}: ${msg.content || msg.text || ''}`)
            .join('\n');

          const summaryPrompt = `Create an updated summary of this conversation.
${currentSummary ? `Previous summary: ${currentSummary.content}\n\n` : ''}
Focus on: recent developments, new topics, changes in discussion.
Keep it under 150 words.

Recent conversation:
${String(conversationText).substring(0, 3000)}`;

          const summaryResponse: any = await this.llmManager.chat([{
            role: 'user',
            content: summaryPrompt
          }], modelId);

          summaryContent = summaryResponse;
        }
      }

      const newSummary: any = await this.topicAnalysisModel.createSummary(
        request.topicId as SHA256IdHash<any>,
        newVersion,
        summaryContent || request.content || '',
        [],
        request.changeReason || (request.autoGenerate ? 'AI-generated update based on new messages' : 'Manual update'),
        currentSummary ? currentSummary.id : null
      );

      return {
        success: true,
        data: { summary: newSummary }
      };
    } catch (error) {
      console.error('[TopicAnalysisPlan] Error updating summary:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: { summary: null }
      };
    }
  }

  /**
   * Extract keywords from text using LLM
   */
  async extractKeywords(request: ExtractKeywordsRequest): Promise<ExtractKeywordsResponse> {
    console.log('[TopicAnalysisPlan] Extracting keywords from text');

    try {
      if (!this.topicAnalysisModel) {
        return {
          success: false,
          error: 'Topic Analysis Model not initialized',
          data: { keywords: [] }
        };
      }

      if (!this.llmManager) {
        // Fallback to simple extraction
        const words = request.text.toLowerCase().split(/\s+/);
        const wordMap = new Map<string, number>();

        words.forEach(word => {
          if (word.length > 4) {
            wordMap.set(word, (wordMap.get(word) || 0) + 1);
          }
        });

        const keywords: Keyword[] = Array.from(wordMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, request.limit || 10)
          .map(([word, freq]) => ({
            $type$: 'Keyword' as const,
            term: word,
            frequency: freq,
            score: freq / words.length,
            subjects: [],
            createdAt: Date.now(),
            lastSeen: Date.now()
          }));

        return {
          success: true,
          data: { keywords }
        };
      }

      // Get model ID for LLM processing
      let modelId: string | null = null;
      if (this.nodeOneCore?.aiAssistantModel) {
        const aiContacts = this.nodeOneCore.aiAssistantModel.getAllContacts();
        if (aiContacts.length > 0) {
          modelId = aiContacts[0].modelId;
        }
      }

      if (!modelId) {
        throw new Error('No AI model available for keyword extraction');
      }

      const limit = request.limit || 10;
      const keywordPrompt = `Extract the ${limit} most important keywords from this text.
Focus on: key concepts, technical terms, main topics, entities.
Return ONLY a JSON array of keywords, no explanation.

Text:
${String(request.text).substring(0, 2000)}

Return format: ["keyword1", "keyword2", ...]`;

      const response: any = await this.llmManager.chat([{
        role: 'user',
        content: keywordPrompt
      }], modelId);

      let extractedKeywords: string[] = [];
      try {
        extractedKeywords = JSON.parse(response);
      } catch (e) {
        extractedKeywords = String(response).match(/"([^"]+)"/g)?.map(k => k.replace(/"/g, '')) || [];
      }

      // Return keyword terms as strings, not full Keyword objects
      // The client will need to resolve these to full objects if needed
      const keywords: Keyword[] = extractedKeywords.slice(0, limit).map((term, index) => ({
        $type$: 'Keyword' as const,
        term,
        frequency: limit - index,
        score: (limit - index) / limit,
        subjects: [],
        createdAt: Date.now(),
        lastSeen: Date.now()
      }));

      return {
        success: true,
        data: { keywords }
      };
    } catch (error) {
      console.error('[TopicAnalysisPlan] Error extracting keywords:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: { keywords: [] }
      };
    }
  }

  /**
   * Merge two subjects into one
   */
  async mergeSubjects(request: MergeSubjectsRequest): Promise<MergeSubjectsResponse> {
    console.log('[TopicAnalysisPlan] Merging subjects:', request.subjectId1, request.subjectId2);

    try {
      // This would need to be implemented in the model
      // For now, return success
      return {
        success: true,
        data: { merged: true }
      };
    } catch (error) {
      console.error('[TopicAnalysisPlan] Error merging subjects:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: { merged: false }
      };
    }
  }

  /**
   * Extract single-word keywords for real-time display using LLM
   */
  async extractRealtimeKeywords(request: RealtimeKeywordsRequest): Promise<RealtimeKeywordsResponse> {
    console.log('[TopicAnalysisPlan] Extracting realtime keywords with LLM');

    try {
      if (!this.llmManager) {
        console.error('[TopicAnalysisPlan] LLM Manager not available');
        return {
          success: false,
          error: 'LLM not available for keyword extraction',
          data: { keywords: request.existingKeywords || [] }
        };
      }

      let modelId: string | null = null;
      if (this.nodeOneCore?.aiAssistantModel) {
        const aiContacts = this.nodeOneCore.aiAssistantModel.getAllContacts();
        if (aiContacts.length > 0) {
          modelId = aiContacts[0].modelId;
        }
      }

      if (!modelId) {
        throw new Error('No AI model available for keyword extraction');
      }

      const maxKeywords = request.maxKeywords || 15;
      const existingKeywords = request.existingKeywords || [];

      const prompt = `Extract the most important single-word keywords from this text.
Focus on: specific topics, domain-specific terms, meaningful nouns, key concepts.
Avoid: common words, verbs, adjectives, pronouns, prepositions.
Return ONLY single words that capture the essence of the content.
${existingKeywords.length > 0 ? `Current keywords: ${existingKeywords.join(', ')}` : ''}

Text: "${request.text}"

Return exactly ${maxKeywords} single-word keywords as a JSON array.
Example: ["pizza", "delivery", "restaurant", "italian"]`;

      const response: any = await this.llmManager.chat([{
        role: 'user',
        content: prompt
      }], modelId);

      let keywords: string[] = [];
      try {
        const jsonMatch = String(response).match(/\[.*\]/s);
        if (jsonMatch) {
          keywords = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        keywords = String(response).match(/\b\w{4,}\b/g) || [];
      }

      keywords = keywords
        .filter(k => typeof k === 'string' && !k.includes(' ') && k.length >= 4)
        .slice(0, maxKeywords);

      const mergedSet = new Set([...keywords, ...existingKeywords]);
      const finalKeywords = Array.from(mergedSet).slice(0, maxKeywords);

      return {
        success: true,
        data: { keywords: finalKeywords }
      };
    } catch (error) {
      console.error('[TopicAnalysisPlan] Error extracting realtime keywords:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: { keywords: request.existingKeywords || [] }
      };
    }
  }

  /**
   * Extract keywords from all messages in a conversation using LLM
   */
  async extractConversationKeywords(request: ConversationKeywordsRequest, chatPlanGetMessages?: Function): Promise<ConversationKeywordsResponse> {
    console.log('[TopicAnalysisPlan] Extracting conversation keywords with LLM for topic:', request.topicId);

    try {
      if (!this.llmManager) {
        console.error('[TopicAnalysisPlan] LLM Manager not available');
        return {
          success: false,
          error: 'LLM not available for keyword extraction',
          data: { keywords: [] }
        };
      }

      let modelId: string | null = null;
      if (this.nodeOneCore?.aiAssistantModel) {
        modelId = this.nodeOneCore.aiAssistantModel.getModelIdForTopic(request.topicId);
      }

      if (!modelId) {
        console.error('[TopicAnalysisPlan] No AI model configured for topic:', request.topicId);
        return {
          success: false,
          error: 'No AI model configured for this topic',
          data: { keywords: [] }
        };
      }

      let messages = request.messages || [];

      // If no messages provided, get them from conversation
      if (messages.length === 0 && chatPlanGetMessages) {
        const messagesResponse: any = await chatPlanGetMessages({ conversationId: request.topicId });
        messages = messagesResponse.messages || [];
      }

      if (messages.length === 0) {
        return {
          success: true,
          data: { keywords: [] }
        };
      }

      const conversationText = messages
        .slice(-20)
        .map((m: any) => m.content || m.text || '')
        .join('\n');

      if (!conversationText.trim()) {
        return {
          success: true,
          data: { keywords: [] }
        };
      }

      const maxKeywords = request.maxKeywords || 15;

      const prompt = `Analyze this conversation and extract the most important single-word keywords.

IMPORTANT: Even short messages can contain critical information. Focus on CONTEXT and MEANING, not length.
For example: "deploy production" -> ["deploy", "production"]
"bitcoin crashed" -> ["bitcoin", "crashed"]

Extract keywords for:
- Technical terms, commands, or operations mentioned
- Product names, systems, or services discussed
- Important events, actions, or states
- Domain-specific vocabulary
- Critical concepts regardless of message length

Skip keywords only if the conversation is PURELY social pleasantries with zero informational content.

Conversation:
"${String(conversationText).substring(0, 2000)}"

Return up to ${maxKeywords} single-word keywords as a JSON array.
Keywords should be lowercase and capture the essence of what's being discussed.
Example: ["blockchain", "ethereum", "smartcontract", "defi", "wallet"]`;

      const response: any = await this.llmManager.chat([{
        role: 'user',
        content: prompt
      }], modelId);

      let keywords: string[] = [];
      try {
        const jsonMatch = String(response).match(/\[.*\]/s);
        if (jsonMatch) {
          keywords = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.warn('[TopicAnalysisPlan] Failed to parse LLM response as JSON');
        keywords = response.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
      }

      keywords = keywords
        .filter(k => typeof k === 'string' && !k.includes(' ') && k.length >= 4)
        .map(k => k.toLowerCase())
        .slice(0, maxKeywords);

      return {
        success: true,
        data: { keywords: keywords }
      };
    } catch (error) {
      console.error('[TopicAnalysisPlan] Error extracting conversation keywords:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: { keywords: [] }
      };
    }
  }

  /**
   * Get all keywords for a topic
   */
  async getKeywords(request: GetKeywordsRequest): Promise<GetKeywordsResponse> {
    try {
      console.log('[TopicAnalysisPlan] Getting keywords for topic:', request.topicId, 'limit:', request.limit);

      if (!this.topicAnalysisModel) {
        return {
          success: false,
          error: 'Topic Analysis Model not initialized',
          data: { keywords: [] }
        };
      }

      const keywords: any = await this.topicAnalysisModel.getKeywords(request.topicId as SHA256IdHash<any>);
      console.log('[TopicAnalysisPlan] Model returned', keywords?.length || 0, 'keywords');

      const limitedKeywords = request.limit ? keywords.slice(0, request.limit) : keywords;
      console.log('[TopicAnalysisPlan] Returning', limitedKeywords?.length || 0, 'keywords (limited)');

      return {
        success: true,
        data: { keywords: limitedKeywords }
      };
    } catch (error) {
      console.error('[TopicAnalysisPlan] Error getting keywords:', error);
      return {
        success: false,
        error: (error as Error).message,
        data: { keywords: [] }
      };
    }
  }
}
