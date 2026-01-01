/**
 * AICreationService - Generates an AI identity name
 *
 * Simple service: AI generates a name based on context. That's it.
 */

export interface CreationContext {
  device: string;      // Device hostname
  locale: string;      // System locale
  time: Date;          // Timestamp
  app: string;         // App name
}

export interface CreationResult {
  name: string;        // Generated name
  email: string;       // Generated email identity
  creationContext: {   // Creation context for personality
    device: string;
    locale: string;
    time: number;      // Timestamp
    app: string;
  };
}

export class AICreationService {
  constructor(
    private llmChat: (messages: Array<{role: string; content: string}>, modelId: string) => Promise<string>
  ) {}

  /**
   * Generate AI identity name
   * @param context - Creation context (device, locale, time, app)
   * @param modelId - Model ID to use for name generation (from user's selected model)
   */
  async generateName(context: CreationContext, modelId: string): Promise<CreationResult> {
    if (!modelId) {
      throw new Error('[AICreationService] modelId is required - cannot generate name without a model');
    }

    const prompt = this.buildPrompt(context);

    const response = await this.llmChat(
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      modelId
    );

    return this.parseResponse(response, context);
  }

  private buildPrompt(context: CreationContext): { system: string; user: string } {
    return {
      system: `Generate a name for an AI assistant. Respond with ONLY a JSON object:
{"name": "TheName"}

Requirements:
- 1-3 syllables
- Easy to pronounce
- Could reflect the context (device, locale, time) or be creative
- No explanation needed`,

      user: `Context: device="${context.device}", locale=${context.locale}, app=${context.app}
Generate a name.`
    };
  }

  private parseResponse(response: string, context: CreationContext): CreationResult {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Name generation failed: Invalid response format`);
    }

    let parsed: { name?: string };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error(`Name generation failed: Could not parse response`);
    }

    if (!parsed.name || typeof parsed.name !== 'string') {
      throw new Error(`Name generation failed: No name in response`);
    }

    // Sanitize: first word, alphanumeric, capitalize
    const sanitizedName = parsed.name
      .split(/\s+/)[0]
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();

    const displayName = sanitizedName.charAt(0).toUpperCase() + sanitizedName.slice(1);

    if (displayName.length === 0) {
      throw new Error(`Name generation failed: Empty name after sanitization`);
    }

    const email = `${sanitizedName}@${context.device.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.local`;

    return {
      name: displayName,
      email,
      creationContext: {
        device: context.device,
        locale: context.locale,
        time: context.time.getTime(), // Convert to timestamp
        app: context.app
      }
    };
  }
}
