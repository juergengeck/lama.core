/**
 * System Prompt Builder
 * Composable system prompt injection following MCP tool pattern
 *
 * This service builds system prompts by combining multiple sections:
 * - Base identity
 * - User preferences
 * - Available context (subjects with message counts)
 * - Current conversation context
 * - MCP tools
 *
 * Each section is independently configurable and generates content on-demand.
 */

export interface SystemPromptSection {
  name: string;
  priority: number; // Lower = earlier in prompt
  enabled: boolean;
  generate: (context?: SystemPromptContext) => Promise<string> | string;
}

export interface SystemPromptContext {
  topicId?: string;
  personId?: string;
  currentSubjects?: string[];
  [key: string]: any;
}

export class SystemPromptBuilder {
  private sections: Map<string, SystemPromptSection> = new Map();

  constructor(
    private mcpManager?: any,
    private userSettingsManager?: any,
    private topicAnalysisModel?: any,
    private channelManager?: any
  ) {
    this.registerDefaultSections();
  }

  /**
   * Register all default prompt sections
   */
  private registerDefaultSections() {
    // Section 1: Base Identity (Priority 0)
    this.register({
      name: 'base-identity',
      priority: 0,
      enabled: true,
      generate: () => `You are a private AI assistant with access to the owner's conversations.`
    });

    // Section 2: User Preferences (Priority 10)
    this.register({
      name: 'user-preferences',
      priority: 10,
      enabled: true,
      generate: async () => {
        if (!this.userSettingsManager) return '';

        try {
          const settings = await this.userSettingsManager.getSettings();
          if (!settings?.ai?.systemPrompt) return '';

          return `\n\n# User Instructions\n\n${settings.ai.systemPrompt}`;
        } catch (e) {
          return '';
        }
      }
    });

    // Section 3: Current Subject Context (Priority 25)
    this.register({
      name: 'current-subject',
      priority: 25,
      enabled: true,
      generate: async (context?: SystemPromptContext) => {
        if (!context?.currentSubjects?.length) return '';

        return `\n\n# Current Conversation\nThis conversation is about: ${context.currentSubjects.join(', ')}`;
      }
    });

    // Section 4: Available Context - REMOVED
    // Subjects are now accessed via MCP tools on-demand (subject:list, subject:get-messages, subject:search)
    // This reduces system prompt size from ~15KB to ~10KB

    // Section 5: MCP Tools (Priority 100)
    this.register({
      name: 'mcp-tools',
      priority: 100,
      enabled: true,
      generate: () => {
        if (!this.mcpManager) {
          console.warn('[SystemPromptBuilder] No mcpManager available');
          return '';
        }

        // Debug logging
        console.log('[SystemPromptBuilder] mcpManager methods:', Object.keys(this.mcpManager));
        console.log('[SystemPromptBuilder] getCompactToolDescriptions exists?', typeof this.mcpManager.getCompactToolDescriptions);

        // Use compact descriptions to reduce prompt size and improve response times
        // AI can call tool:describe for full details when needed
        const compact = this.mcpManager.getCompactToolDescriptions?.();
        const verbose = this.mcpManager.getToolDescriptions?.();

        console.log('[SystemPromptBuilder] Compact type:', typeof compact);
        console.log('[SystemPromptBuilder] Compact result length:', compact?.length || 0);
        console.log('[SystemPromptBuilder] Verbose type:', typeof verbose);
        console.log('[SystemPromptBuilder] Verbose result length:', verbose?.length || 0);

        const result = compact || verbose || '';
        console.log('[SystemPromptBuilder] FINAL CHOICE - Using:', result === compact ? 'COMPACT' : (result === verbose ? 'VERBOSE' : 'EMPTY'));
        console.log('[SystemPromptBuilder] FINAL result length:', result?.length || 0);

        return result;
      }
    });
  }

  /**
   * Get all subjects with message counts across all topics
   */
  private async getAllSubjectsWithCounts(): Promise<Array<{ name: string; messageCount: number }>> {
    if (!this.topicAnalysisModel || !this.channelManager) {
      return [];
    }

    try {
      const allChannels = await this.channelManager.getMatchingChannelInfos();
      const subjectMap = new Map<string, number>();

      for (const channel of allChannels) {
        try {
          const subjects = await this.topicAnalysisModel.getSubjects(channel.id);

          for (const subject of subjects) {
            if (subject.archived) continue;

            const name = subject.name || subject.keywordCombination;
            const count = subject.messageCount || subject.keywords?.length || 0;

            if (name) {
              subjectMap.set(name, (subjectMap.get(name) || 0) + count);
            }
          }
        } catch (e) {
          // Skip topics without subjects
        }
      }

      return Array.from(subjectMap.entries())
        .map(([name, messageCount]) => ({ name, messageCount }))
        .sort((a, b) => b.messageCount - a.messageCount); // Sort by message count descending
    } catch (error) {
      console.error('[SystemPromptBuilder] Failed to get subjects with counts:', error);
      return [];
    }
  }

  /**
   * Register a custom section
   */
  register(section: SystemPromptSection) {
    this.sections.set(section.name, section);
  }

  /**
   * Enable/disable a section
   */
  setEnabled(name: string, enabled: boolean) {
    const section = this.sections.get(name);
    if (section) {
      section.enabled = enabled;
    }
  }

  /**
   * Build the complete system prompt
   */
  async build(context?: SystemPromptContext, overrides?: Partial<Record<string, string>>): Promise<string> {
    const enabledSections = Array.from(this.sections.values())
      .filter(s => s.enabled)
      .sort((a, b) => a.priority - b.priority);

    const parts: string[] = [];

    for (const section of enabledSections) {
      try {
        // Use override if provided, otherwise generate
        const content = overrides?.[section.name] ?? await section.generate(context);
        if (content && content.trim()) {
          parts.push(content);
        }
      } catch (error) {
        console.warn(`[SystemPromptBuilder] Failed to generate section ${section.name}:`, error);
      }
    }

    return parts.join('\n');
  }

  /**
   * Enhance messages with system prompt (same pattern as MCP enhanceMessagesWithTools)
   */
  async enhanceMessages(
    messages: any[],
    context?: SystemPromptContext,
    overrides?: Partial<Record<string, string>>
  ): Promise<any[]> {
    const systemPrompt = await this.build(context, overrides);

    if (!systemPrompt) {
      return messages;
    }

    const enhanced = [...messages];
    const systemIndex = enhanced.findIndex(m => m.role === 'system');

    if (systemIndex >= 0) {
      // Append to existing system message
      enhanced[systemIndex] = {
        ...enhanced[systemIndex],
        content: enhanced[systemIndex].content + '\n\n' + systemPrompt
      };
    } else {
      // Create new system message
      enhanced.unshift({
        role: 'system',
        content: systemPrompt
      });
    }

    return enhanced;
  }

  /**
   * Debug: Get all section names and their enabled status
   */
  getSections(): Array<{ name: string; priority: number; enabled: boolean }> {
    return Array.from(this.sections.values())
      .map(s => ({ name: s.name, priority: s.priority, enabled: s.enabled }))
      .sort((a, b) => a.priority - b.priority);
  }
}
