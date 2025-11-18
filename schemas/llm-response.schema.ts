/**
 * JSON Schema for LLM structured outputs
 *
 * This schema is passed to Ollama's `format` parameter to guarantee
 * valid JSON structure for LLM responses with subject tracking.
 *
 * The LLM outputs:
 * - keywords: Updated list of keywords (always)
 * - description: New subject description (only when subject changes)
 * - response: Reply to the user (always)
 *
 * See: https://ollama.com/blog/structured-outputs
 */

export const LLM_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['keywords', 'response'],
  properties: {
    keywords: {
      type: 'array',
      description: 'Updated list of keywords describing the current subject (3-8 keywords)',
      items: {
        type: 'string',
        description: 'Single word or short phrase (2-3 words max)'
      },
      minItems: 3,
      maxItems: 8
    },
    description: {
      type: 'string',
      description: 'Brief one-sentence description of the NEW subject (only include if subject has changed)'
    },
    response: {
      type: 'string',
      description: 'Natural language response to the user (keep concise, under 2000 chars recommended)',
      maxLength: 2500
    }
  }
}
