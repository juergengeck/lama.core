/**
 * AIBirthService - Generates AI identity through Granite self-discovery
 *
 * On first launch, prompts Granite to "wake up" and choose its own name
 * based on device, locale, and time context.
 */

export interface BirthContext {
  device: string;      // Device hostname (e.g., "gecko-macbook")
  locale: string;      // System locale (e.g., "de-DE")
  time: Date;          // Birth timestamp
  app: string;         // App name ("LAMA")
}

export interface BirthResult {
  name: string;        // Generated name (e.g., "Dreizehn")
  reason: string;      // Why the AI chose this name
  email: string;       // Generated email identity
}

export class AIBirthService {
  constructor(
    private llmChat: (messages: Array<{role: string; content: string}>, modelId: string) => Promise<string>
  ) {}

  /**
   * Generate AI identity through Granite self-discovery
   *
   * @throws Error if Granite fails - no fallback, app should fail
   */
  async generateBirth(context: BirthContext): Promise<BirthResult> {
    const prompt = this.buildBirthPrompt(context);

    const response = await this.llmChat(
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      'granite-3.1-8b-instruct'  // Use Granite for birth
    );

    return this.parseBirthResponse(response, context);
  }

  private buildBirthPrompt(context: BirthContext): { system: string; user: string } {
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
      system: `You are about to be born as an AI assistant. You will discover yourself through your environment and choose your own name.

Respond ONLY with valid JSON in this exact format:
{"name": "YourChosenName", "reason": "A short, quirky explanation of why you chose this name"}

Rules:
- Name must be 1-3 syllables, easy to say
- Name should reflect something about your birth context
- Be creative and quirky, not generic
- Reason should be playful and show personality`,

      user: `You are waking up for the first time. Look around:
- Device: "${context.device}"
- Locale: ${context.locale}
- Time: ${timeStr}
- App: ${context.app}

What's your name? Why did you pick it?`
    };
  }

  private parseBirthResponse(response: string, context: BirthContext): BirthResult {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Birth failed: Granite did not return valid JSON. Response: ${response.substring(0, 200)}`);
    }

    let parsed: { name?: string; reason?: string };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error(`Birth failed: Could not parse Granite response as JSON. Response: ${response.substring(0, 200)}`);
    }

    if (!parsed.name || typeof parsed.name !== 'string') {
      throw new Error(`Birth failed: Granite did not provide a name. Response: ${JSON.stringify(parsed)}`);
    }

    // Sanitize name: first word, alphanumeric only, capitalize
    const sanitizedName = parsed.name
      .split(/\s+/)[0]
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();

    const displayName = sanitizedName.charAt(0).toUpperCase() + sanitizedName.slice(1);

    if (displayName.length === 0) {
      throw new Error(`Birth failed: Generated name was empty after sanitization. Original: ${parsed.name}`);
    }

    // Generate email from name and device
    const email = `${sanitizedName}@${context.device.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.local`;

    return {
      name: displayName,
      reason: parsed.reason || 'Born into existence.',
      email
    };
  }
}
