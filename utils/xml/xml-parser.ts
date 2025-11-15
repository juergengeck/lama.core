import { XMLParser } from 'fast-xml-parser';
import { validateResponseStructure } from './xml-validator.js';

export interface ParsedKeyword {
  term: string;
  confidence: number;
}

export interface ParsedSubject {
  name: string;
  description: string;
  isNew: boolean;
  keywords: ParsedKeyword[];
}

export interface ParsedResponse {
  text: string;
  analysis: {
    subjects: ParsedSubject[];
    summaryUpdate: string;
  };
}

export function parseXMLResponse(xmlString: string): ParsedResponse {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
    trimValues: true,
    removeNSPrefix: true
  });

  let parsed;
  try {
    parsed = parser.parse(xmlString);
  } catch (error: any) {
    throw new Error(`Invalid XML: ${error.message}`);
  }

  // Validate structure
  validateResponseStructure(parsed);

  const response = parsed.llmResponse;

  // Normalize subjects to array
  const subjects = response.analysis.subject
    ? (Array.isArray(response.analysis.subject)
        ? response.analysis.subject
        : [response.analysis.subject])
    : [];

  // Parse subjects and keywords
  const parsedSubjects: ParsedSubject[] = subjects.map((subject: any) => {
    const keywords = subject.keyword
      ? (Array.isArray(subject.keyword)
          ? subject.keyword
          : [subject.keyword])
      : [];

    return {
      name: subject.name,
      description: subject.description,
      isNew: subject.isNew === 'true',
      keywords: keywords.map((kw: any) => ({
        term: kw.term,
        confidence: parseFloat(kw.confidence)
      }))
    };
  });

  return {
    text: response.response,
    analysis: {
      subjects: parsedSubjects,
      summaryUpdate: response.analysis.summaryUpdate || ''
    }
  };
}
