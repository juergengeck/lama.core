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
    private mcpManager?: any  // Optional MCP for memory context
  ) {}

  /**
   * Analyze content using LLM with structured output
   */
  async analyze(content: AnalysisContent, context?: AnalysisContext): Promise<Analysis> {
    const startTime = Date.now();

    try {
      // Fetch existing subjects from memory if available
      const existingSubjects = await this.getExistingSubjects(context);

      // Build analysis prompt based on content type
      const prompt = this.buildPrompt(content, existingSubjects, context);

      // Call LLM with structured output
      const modelId = context?.modelId || this.getDefaultAnalysisModel();
      const LLM_RESPONSE_SCHEMA = await this.getResponseSchema();

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

      // Convert to standard Analysis format
      const analysis = this.parseAnalysisResponse(parsed);

      console.log(`[AnalysisService] Analysis complete in ${Date.now() - startTime}ms`);
      console.log(`[AnalysisService] - Found ${analysis.subjects.length} subjects`);
      console.log(`[AnalysisService] - Total keywords: ${analysis.keywords.length}`);

      return analysis;
    } catch (error) {
      console.error('[AnalysisService] Analysis failed:', error);
      throw new Error(`Analysis failed: ${(error as Error).message}`);
    }
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
    context?: AnalysisContext
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
    let prompt = `Extract subjects and concepts from this content. Return ONLY JSON:
{
  "subjects": [{"name": "subject-name", "concepts": ["concept1", "concept2"]}],
  "summary": "brief summary"
}`;

    // Include existing subjects for consistency
    if (existingSubjects.length > 0) {
      prompt += `\n\nEXISTING SUBJECTS (reuse these names when appropriate):\n`;
      existingSubjects.forEach(s => {
        const keywords = s.keywords.map(k => k.term).join(', ');
        prompt += `- ${s.name}: ${keywords}\n`;
      });
      prompt += `\nIf the content relates to existing subjects, use the same subject names for consistency.`;
    }

    return prompt;
  }

  /**
   * Parse LLM response into Analysis format
   */
  private parseAnalysisResponse(parsed: any): Analysis {
    const subjects: Subject[] = (parsed.subjects || []).map((subject: any) => {
      const conceptsArray = subject.key_concepts || subject.keyConcepts || subject.concepts || [];

      const keywords = conceptsArray.map((item: any) => {
        if (typeof item === 'object' && item !== null) {
          const term = item.keyword || item.term || item.concept;
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
      summary: parsed.summary || '',
      confidence: parsed.confidence || 0.8
    };
  }

  /**
   * Get default model for analysis (prefer qwen2.5:7b)
   */
  private getDefaultAnalysisModel(): string {
    // Prefer qwen2.5:7b for structured analysis, fallback to first available
    const availableModels = this.llmManager.getModels();
    const qwen = availableModels.find((m: any) => m.id === 'qwen2.5:7b');
    return qwen?.id || availableModels[0]?.id || 'llama3.2:latest';
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
