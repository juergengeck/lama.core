/**
 * XML Schema Validation
 * Validates parsed XML against schema contracts
 */

export function validateQueryStructure(parsed: any): void {
  if (!parsed.llmQuery) {
    throw new Error('Missing root element: llmQuery');
  }

  const query = parsed.llmQuery;

  if (!query.userMessage || typeof query.userMessage !== 'string' || query.userMessage.trim() === '') {
    throw new Error('Missing required element: userMessage');
  }

  if (!query.context) {
    throw new Error('Missing required element: context');
  }

  if (!query.context.topicId || typeof query.context.topicId !== 'string') {
    throw new Error('Missing required attribute: context.topicId');
  }

  if (typeof query.context.messageCount !== 'number') {
    throw new Error('Missing required attribute: context.messageCount');
  }
}

export function validateResponseStructure(parsed: any): void {
  if (!parsed.llmResponse) {
    throw new Error('Missing root element: llmResponse');
  }

  const response = parsed.llmResponse;

  if (!response.response || typeof response.response !== 'string' || response.response.trim() === '') {
    throw new Error('Missing required element: response');
  }

  if (!response.analysis) {
    throw new Error('Missing required element: analysis');
  }

  // Validate subjects
  if (response.analysis.subject) {
    const subjects = Array.isArray(response.analysis.subject)
      ? response.analysis.subject
      : [response.analysis.subject];

    for (const subject of subjects) {
      if (!subject.name || typeof subject.name !== 'string') {
        throw new Error('Missing required attribute: subject.name');
      }

      if (!subject.description || typeof subject.description !== 'string') {
        throw new Error('Missing required attribute: subject.description');
      }

      if (subject.isNew !== 'true' && subject.isNew !== 'false') {
        throw new Error('Invalid attribute value: subject.isNew must be "true" or "false"');
      }

      // Validate keywords
      if (subject.keyword) {
        const keywords = Array.isArray(subject.keyword)
          ? subject.keyword
          : [subject.keyword];

        for (const kw of keywords) {
          if (!kw.term || typeof kw.term !== 'string') {
            throw new Error('Missing required attribute: keyword.term');
          }

          const confidence = parseFloat(kw.confidence);
          if (isNaN(confidence) || confidence < 0.0 || confidence > 1.0) {
            throw new Error('Confidence must be between 0.0 and 1.0');
          }
        }
      }
    }
  }

  if (!response.analysis.summaryUpdate) {
    throw new Error('Missing required element: summaryUpdate');
  }
}
