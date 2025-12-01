/**
 * Summary Model for ONE.core
 *
 * Summary is an unversioned snapshot of a Subject within a Topic.
 * Identity: (subject + topic) - one Summary per Subject per Topic.
 *
 * When subject switch is detected, the Summary for the previous subject
 * is created/replaced, then flows into Memory as a new version.
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';

export interface SummaryData {
  $type$: 'Summary';
  subject: string;  // Subject IdHash being summarized
  topic: string;    // Topic IdHash (scope)
  prose: string;    // LLM-generated summary text
}

class Summary {
  public $type$: 'Summary' = 'Summary';
  public subject: string;
  public topic: string;
  public prose: string;

  constructor(data: Partial<SummaryData> & { subject: string; topic: string }) {
    this.subject = data.subject;
    this.topic = data.topic;
    this.prose = data.prose || '';
  }

  /**
   * Convert to plain object for storage
   */
  toObject(): SummaryData {
    return {
      $type$: this.$type$,
      subject: this.subject,
      topic: this.topic,
      prose: this.prose
    };
  }

  /**
   * Create Summary from plain object
   */
  static fromObject(obj: SummaryData): Summary {
    if (obj.$type$ !== 'Summary') {
      throw new Error('Invalid object type for Summary');
    }
    return new Summary(obj);
  }

  /**
   * Get word count of summary
   */
  getWordCount(): number {
    return this.prose.split(/\s+/).filter((w: string) => w.length > 0).length;
  }

  /**
   * Check if summary has meaningful content
   */
  hasContent(): boolean {
    return this.prose.trim().length > 0;
  }
}

export default Summary;
