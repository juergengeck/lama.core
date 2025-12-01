/**
 * Abstract Analysis Service
 * Provides reusable analysis across chat, memories, files, and other data
 */

export interface AnalysisContent {
  type: 'chat' | 'memory' | 'file' | 'custom';
  messages?: Array<{ role: string; content: string }>;  // For chat
  subjects?: Subject[];                                  // For memory
  text?: string;                                         // For files/custom
  metadata?: Record<string, any>;                        // Additional context
}

export interface AnalysisContext {
  existingSubjects?: Subject[];     // From memory:subjects MCP tool
  existingKeywords?: string[];      // From memory
  modelId?: string;
  temperature?: number;
  topicId?: string;
  disableTools?: boolean;
}

export interface Subject {
  name: string;
  description?: string;
  isNew?: boolean;
  keywords: Keyword[];
}

export interface Keyword {
  term: string;
  confidence: number;
}

export interface Analysis {
  subjects: Subject[];
  keywords: string[];              // Flattened from subjects
  summary: string;
  confidence: number;
  metadata?: Record<string, any>;
}

/**
 * Abstract analysis service that can be used for chat, memories, files, etc.
 */
export interface AnalysisService {
  /**
   * Analyze content and extract subjects/keywords
   * @param content - Content to analyze (chat, memory, file, etc.)
   * @param context - Analysis context (existing subjects, model, etc.)
   * @returns Analysis with subjects, keywords, summary
   */
  analyze(content: AnalysisContent, context?: AnalysisContext): Promise<Analysis>;
}

/**
 * LLM-based analysis service implementation
 * Uses structured output for reliable subject/keyword extraction
 */
export class LLMAnalysisService implements AnalysisService {
  constructor(
    private llmManager: any,
    private mcpManager?: any,  // Optional MCP for memory context
    private onProgress?: (message: string) => void  // Optional progress callback
  ) {}

  /**
   * Analyze content using LLM with structured output
   */
  async analyze(content: AnalysisContent, context?: AnalysisContext): Promise<Analysis> {
    const startTime = Date.now();
    const MAX_RETRIES = 2; // Only try 2 models before giving up

    let lastError: Error | undefined;
    let attempts = 0;
    const failedModels: string[] = []; // Track failed models

    while (attempts < MAX_RETRIES) {
      try {
        attempts++;

        // Fetch existing subjects from memory if available
        const existingSubjects = await this.getExistingSubjects(context);

        // Build analysis prompt based on content type
        const prompt = this.buildPrompt(content, existingSubjects, context);

        // Call LLM with structured output - get a DIFFERENT model on each retry
        const modelId = context?.modelId || this.getDefaultAnalysisModel(failedModels);
        const LLM_RESPONSE_SCHEMA = await this.getResponseSchema();

        console.log(`[AnalysisService] Attempt ${attempts}/${MAX_RETRIES} with model: ${modelId}`);

        // Notify user we're analyzing (if this is taking a while)
        if (attempts > 1) {
          this.onProgress?.(`⏳ Analyzing conversation (attempt ${attempts})...`);
        }

        const analysisJson = await this.llmManager.chat(prompt, modelId, {
          format: LLM_RESPONSE_SCHEMA,
          temperature: context?.temperature ?? 0,
          disableTools: context?.disableTools ?? true
        }) as string;

        // Parse structured response
        let cleanJson = analysisJson.trim();
        if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        const parsed = JSON.parse(cleanJson);

        // DEBUG: Log what the LLM actually returned
        console.log('[AnalysisService] 🔍 LLM returned:', JSON.stringify(parsed).substring(0, 500));
        console.log('[AnalysisService] 🔍 parsed.analysis exists?', !!parsed.analysis);
        console.log('[AnalysisService] 🔍 parsed.subjects exists?', !!parsed.subjects);
        if (parsed.analysis) {
          console.log('[AnalysisService] 🔍 parsed.analysis.subjects length:', parsed.analysis.subjects?.length || 0);
        }

        // Convert to standard Analysis format
        const analysis = this.parseAnalysisResponse(parsed);

        console.log(`[AnalysisService] Analysis complete in ${Date.now() - startTime}ms`);
        console.log(`[AnalysisService] - Found ${analysis.subjects.length} subjects`);
        console.log(`[AnalysisService] - Total keywords: ${analysis.keywords.length}`);

        return analysis;
      } catch (error: any) {
        lastError = error;
        const modelId = context?.modelId || this.getDefaultAnalysisModel(failedModels);
        failedModels.push(modelId); // Track this failed model
        console.warn(`[AnalysisService] Attempt ${attempts} failed with ${modelId}:`, error?.message || error);

        // If we've exhausted retries, throw
        if (attempts >= MAX_RETRIES) {
          break;
        }
        // Otherwise loop and try next model
      }
    }

    console.error(`[AnalysisService] All ${attempts} attempts failed, giving up`);
    throw new Error(`Analysis failed after ${attempts} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Get existing subjects from memory via MCP
   */
  private async getExistingSubjects(context?: AnalysisContext): Promise<Subject[]> {
    // Return provided subjects if available
    if (context?.existingSubjects) {
      return context.existingSubjects;
    }

    // Try to fetch from MCP memory:subjects tool
    if (!this.mcpManager?.memoryTools) {
      return [];
    }

    try {
      console.log('[AnalysisService] Fetching existing subjects from memory');
      const result = await this.mcpManager.memoryTools.getSubjects(context?.topicId);

      // Parse MCP response
      if (result.content && Array.isArray(result.content)) {
        const textContent = result.content.find((c: any) => c.type === 'text');
        if (textContent && textContent.text) {
          // Parse the formatted subject list
          return this.parseSubjectsFromMCP(textContent.text);
        }
      }

      return [];
    } catch (error) {
      console.warn('[AnalysisService] Failed to fetch existing subjects:', error);
      return [];
    }
  }

  /**
   * Parse subjects from MCP formatted text
   */
  private parseSubjectsFromMCP(text: string): Subject[] {
    // MCP format: "[1] subject-name\n   Keywords: kw1, kw2\n   description"
    const subjects: Subject[] = [];
    const lines = text.split('\n');

    let currentSubject: Partial<Subject> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Subject line: "[1] subject-name"
      if (trimmed.match(/^\[\d+\]/)) {
        if (currentSubject?.name) {
          subjects.push(currentSubject as Subject);
        }
        const name = trimmed.replace(/^\[\d+\]\s*/, '');
        currentSubject = { name, keywords: [], isNew: false };
      }
      // Keywords line: "Keywords: kw1, kw2, kw3"
      else if (trimmed.startsWith('Keywords:')) {
        if (currentSubject) {
          const keywordsStr = trimmed.replace(/^Keywords:\s*/, '');
          currentSubject.keywords = keywordsStr.split(',').map(kw => ({
            term: kw.trim(),
            confidence: 0.8
          }));
        }
      }
      // Description line
      else if (trimmed && currentSubject && !currentSubject.description) {
        currentSubject.description = trimmed;
      }
    }

    // Add last subject
    if (currentSubject?.name) {
      subjects.push(currentSubject as Subject);
    }

    console.log(`[AnalysisService] Parsed ${subjects.length} existing subjects from memory`);
    return subjects;
  }

  /**
   * Build analysis prompt based on content type
   */
  private buildPrompt(
    content: AnalysisContent,
    existingSubjects: Subject[],
    _context?: AnalysisContext
  ): Array<{ role: string; content: string }> {
    const systemPrompt = this.buildSystemPrompt(existingSubjects);

    switch (content.type) {
      case 'chat':
        return [
          { role: 'system', content: systemPrompt },
          ...(content.messages || []),
          {
            role: 'user',
            content: 'Extract subjects, keywords, and summary from this conversation.'
          }
        ];

      case 'memory':
        return [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Analyze these memory subjects and extract themes:\n\n${JSON.stringify(content.subjects, null, 2)}`
          }
        ];

      case 'file':
        return [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Analyze this text and extract subjects/keywords:\n\n${content.text}`
          }
        ];

      case 'custom':
        return [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: content.text || 'No content provided'
          }
        ];

      default:
        throw new Error(`Unknown content type: ${content.type}`);
    }
  }

  /**
   * Build system prompt with existing subjects context
   */
  private buildSystemPrompt(existingSubjects: Subject[]): string {
    let prompt = `Extract subjects and keywords from this conversation. Return JSON matching this structure:
{
  "response": "Brief acknowledgment of what you analyzed (Keep under 2000 characters)",
  "analysis": {
    "subjects": [{
      "name": "subject-name",
      "description": "3-8 word specific summary",
      "isNew": true,
      "keywords": [{"term": "keyword", "confidence": 0.8}]
    }],
    "summaryUpdate": "Brief summary of the conversation"
  }
}

CRITICAL for descriptions:
- Maximum 8 words, ideally 3-5
- Be SPECIFIC, not generic (e.g., "React hook for state sync" not "Discussion about programming concepts")
- No filler words like "related to", "discussion about", "involves"
- State the concrete thing, action, or concept

Keep your "response" field under 2000 characters for reliability.`;

    // Include existing subjects for consistency
    if (existingSubjects.length > 0) {
      prompt += `\n\nEXISTING SUBJECTS (reuse these names when appropriate):\n`;
      existingSubjects.forEach(s => {
        const keywords = s.keywords.map(k => k.term).join(', ');
        prompt += `- ${s.name}: ${keywords}\n`;
      });
      prompt += `\nIf the content relates to existing subjects, use the same subject names and set "isNew": false.`;
    }

    return prompt;
  }

  /**
   * Parse LLM response into Analysis format
   */
  private parseAnalysisResponse(parsed: any): Analysis {
    // Handle nested structure: {analysis: {subjects: [...], summaryUpdate: "..."}}
    const analysisData = parsed.analysis || parsed;
    const subjects: Subject[] = (analysisData.subjects || []).map((subject: any) => {
      // Support both 'keywords' array (new schema) and 'concepts' array (fallback)
      const keywordsArray = subject.keywords || subject.key_concepts || subject.keyConcepts || subject.concepts || [];

      const keywords = keywordsArray.map((item: any) => {
        if (typeof item === 'object' && item !== null) {
          const term = item.term || item.keyword || item.concept;
          if (term) {
            return {
              term: String(term),
              confidence: item.confidence || 0.8
            };
          }
        }
        return {
          term: String(item),
          confidence: 0.8
        };
      });

      return {
        name: subject.name,
        description: subject.description || `Subject: ${subject.name}`,
        isNew: subject.isNew !== undefined ? subject.isNew : true,
        keywords
      };
    });

    // Flatten keywords
    const allKeywords = subjects.flatMap(s => s.keywords.map(k => k.term));

    return {
      subjects,
      keywords: [...new Set(allKeywords)],  // Deduplicate
      summary: analysisData.summaryUpdate || analysisData.summary || '',
      confidence: parsed.confidence || 0.8
    };
  }

  /**
   * Get default model for analysis
   * Try models and let them fail/cache if structured output isn't supported
   * @param excludeModels - Model IDs to exclude (already failed)
   */
  private getDefaultAnalysisModel(excludeModels: string[] = []): string {
    const availableModels = this.llmManager.getAllModels();

    if (availableModels.length === 0) {
      throw new Error('No models available for analysis');
    }

    // Filter out:
    // 1. Models already tested and known to fail structured output
    // 2. Vision models (they typically don't support structured output)
    // 3. Models that have already failed in this attempt
    const untested = availableModels.filter((m: any) => {
      // Skip excluded models (already failed this attempt)
      if (excludeModels.includes(m.id)) {
        console.log(`[AnalysisService] Skipping previously failed model: ${m.id}`);
        return false;
      }

      // Skip models that failed structured output test
      if (m.structuredOutputTested === false) {
        return false;
      }

      // Skip vision models (they don't support structured output)
      const isVisionModel = m.id.includes('-vl') ||
                           m.id.includes('vision') ||
                           m.name?.toLowerCase().includes('vision');
      if (isVisionModel) {
        console.log(`[AnalysisService] Skipping vision model for analysis: ${m.id}`);
        return false;
      }

      return true;
    });

    if (untested.length === 0) {
      throw new Error(
        'All available models have been tested and do not support structured output. ' +
        'Analysis features require JSON schema support. ' +
        'Available models (all incompatible): ' + availableModels.map((m: any) => m.id).join(', ')
      );
    }

    // Return first untested model (LLMManager will test and cache the result)
    return untested[0].id;
  }

  /**
   * Get LLM response schema
   */
  private async getResponseSchema(): Promise<any> {
    try {
      const { LLM_RESPONSE_SCHEMA } = await import('../schemas/llm-response.schema.js');
      return LLM_RESPONSE_SCHEMA;
    } catch (error) {
      console.warn('[AnalysisService] Schema not found, using inline schema');
      return {
        type: 'object',
        properties: {
          subjects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                concepts: { type: 'array', items: { type: 'string' } }
              }
            }
          },
          summary: { type: 'string' }
        }
      };
    }
  }
}

export default LLMAnalysisService;
