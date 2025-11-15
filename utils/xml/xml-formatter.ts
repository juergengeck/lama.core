import { XMLBuilder } from 'fast-xml-parser';

export interface QueryContext {
  topicId: string;
  messageCount: number;
  activeSubjects?: string[];
  recentKeywords?: string[];
}

export function formatQueryAsXML(message: string, context: QueryContext): string {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    indentBy: '  '
  });

  const xmlObj = {
    llmQuery: {
      userMessage: message,
      context: {
        '@_topicId': context.topicId,
        '@_messageCount': context.messageCount,
        activeSubjects: context.activeSubjects?.join(', ') || '',
        recentKeywords: context.recentKeywords?.join(', ') || ''
      }
    }
  };

  return builder.build(xmlObj);
}
