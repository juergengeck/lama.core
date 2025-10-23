/**
 * JSON Schema for Ollama structured outputs
 *
 * This schema is passed to Ollama's `format` parameter to guarantee
 * valid JSON structure for LLM responses with built-in analysis.
 *
 * See: https://ollama.com/blog/structured-outputs
 */

export const LLM_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['response', 'analysis'],
  properties: {
    response: {
      type: 'string',
      description: 'Natural language response to the user'
    },
    analysis: {
      type: 'object',
      required: ['subjects', 'summaryUpdate'],
      properties: {
        subjects: {
          type: 'array',
          description: 'Subjects identified in the conversation',
          items: {
            type: 'object',
            required: ['name', 'description', 'isNew', 'keywords'],
            properties: {
              name: {
                type: 'string',
                description: 'Subject name (kebab-case)'
              },
              description: {
                type: 'string',
                description: 'Brief explanation of the subject'
              },
              isNew: {
                type: 'boolean',
                description: 'Whether this is a new subject or existing'
              },
              keywords: {
                type: 'array',
                description: 'Keywords associated with this subject',
                items: {
                  type: 'object',
                  required: ['term', 'confidence'],
                  properties: {
                    term: {
                      type: 'string',
                      description: 'The keyword term'
                    },
                    confidence: {
                      type: 'number',
                      minimum: 0,
                      maximum: 1,
                      description: 'Confidence score (0.0-1.0)'
                    }
                  }
                }
              }
            }
          }
        },
        summaryUpdate: {
          type: 'string',
          description: 'Brief summary of this exchange'
        }
      }
    }
  }
}
