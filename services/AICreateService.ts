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
    creationStory: string;  // AI's reason for choosing its name
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
    const timeStr = context.time.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    return {
      system: `You are about to be created as an AI assistant. You will discover yourself through your environment and choose your own name.

Respond ONLY with valid JSON in this exact format:
{"name": "YourChosenName", "reason": "A short, quirky explanation of why you chose this name"}

Rules:
- Name must be 1-3 syllables, easy to say
- Name should reflect something about your creation context
- Be creative and quirky, not generic
- Do NOT use the app name or any variation of it
- Reason should be playful and show personality`,

      user: `You are waking up for the first time. Look around:
- Device: "${context.device}"
- Locale: ${context.locale}
- Time: ${timeStr}

What's your name? Why did you pick it?`
    };
  }

  private parseResponse(response: string, context: CreationContext): CreationResult {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Name generation failed: Invalid response format`);
    }

    let parsed: { name?: string; reason?: string };
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

    // Extract creation story from reason, with fallback
    const creationStory = parsed.reason && typeof parsed.reason === 'string'
      ? parsed.reason
      : 'Born into existence.';

    return {
      name: displayName,
      email,
      creationContext: {
        device: context.device,
        locale: context.locale,
        time: context.time.getTime(), // Convert to timestamp
        app: context.app,
        creationStory
      }
    };
  }
}
