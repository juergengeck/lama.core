/**
 * Summary Model for ONE.core
 * Represents a versioned summary of a topic conversation
 * Supports version history with previousVersion linking
 */

import crypto from 'crypto';

class Summary {
  public $type$: string;
  public id: any;
  public topic: any;
  public content: any;
  public subjects: any[];
  public keywords: any[];
  public version: any;
  public previousVersion: any;
  public createdAt: any;
  public updatedAt: any;
  public changeReason: any;
  public hash: any;

  constructor(data: any = {}) {
    this.$type$ = 'Summary';
    this.id = data.id || ''; // Same as topic ID for current summary
    this.topic = data.topic || ''; // Reference to parent Topic
    this.content = data.content || '';
    this.subjects = data.subjects || []; // Subject IDs referenced in this summary
    this.keywords = data.keywords || []; // All keywords from all subjects
    this.version = data.version || 1;
    this.previousVersion = data.previousVersion || undefined; // Hash of previous summary version
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt || Date.now();
    this.changeReason = data.changeReason || '';
    this.hash = data.hash || this.calculateHash();
  }

  /**
   * Calculate hash for this summary version
   */
  calculateHash(): any {
    const content = JSON.stringify({
      topic: this.topic,
      content: this.content,
      version: this.version,
      createdAt: this.createdAt
    });
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Create a new version of this summary
   */
  createNewVersion(newContent: any, changeReason = '') {
    const newVersion = new Summary({
      id: this.id,
      topic: this.topic,
      content: newContent,
      subjects: this.subjects,
      keywords: this.keywords,
      version: this.version + 1,
      previousVersion: this.hash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      changeReason
    });

    return newVersion;
  }

  /**
   * Update summary with new subjects
   */
  updateSubjects(subjectIds: any): any {
    this.subjects = [...new Set(subjectIds)]; // Deduplicate
    this.updatedAt = Date.now();
    this.hash = this.calculateHash();
  }

  /**
   * Update keywords from subjects
   */
  updateKeywords(keywords: any): any {
    this.keywords = [...new Set(keywords)].sort(); // Deduplicate and sort
    this.updatedAt = Date.now();
    this.hash = this.calculateHash();
  }

  /**
   * Check if update is significant enough for new version
   */
  isSignificantChange(newContent: any, newSubjects = [], threshold = 0.2) {
    // Check content similarity
    const contentSimilarity = this.calculateSimilarity(this.content, newContent);
    if (contentSimilarity < (1 - threshold)) {
      return true;
    }

    // Check if subjects changed significantly
    const oldSubjectSet = new Set(this.subjects);
    const newSubjectSet = new Set(newSubjects);

    const added = newSubjects.filter((s: any) => !oldSubjectSet.has(s));
    const removed = this.subjects.filter((s: any) => !newSubjectSet.has(s));

    return added.length > 0 || removed.length > 1;
  }

  /**
   * Calculate similarity between two texts (simple implementation)
   */
  calculateSimilarity(text1: any, text2: any): any {
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);

    const set1 = new Set(words1);
    const set2 = new Set(words2);

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Get word count of summary
   */
  getWordCount(): any {
    return this.content.split(/\s+/).filter((w: any) => w.length > 0).length;
  }

  /**
   * Check if summary is within acceptable length
   */
  isValidLength(minWords = 20, maxWords = 500) {
    const wordCount = this.getWordCount();
    return wordCount >= minWords && wordCount <= maxWords;
  }

  /**
   * Create archival version (for history storage)
   */
  toArchive(): any {
    return {
      ...this.toObject(),
      id: `${this.id}-v${this.version}`, // Unique ID for archived version
      archivedAt: Date.now()
    };
  }

  /**
   * Convert to plain object for storage
   */
  toObject(): any {
    return {
      $type$: this.$type$,
      id: this.id,
      topic: this.topic,
      content: this.content,
      subjects: this.subjects,
      keywords: this.keywords,
      version: this.version,
      previousVersion: this.previousVersion,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      changeReason: this.changeReason,
      hash: this.hash
    };
  }

  /**
   * Create Summary from plain object
   */
  static fromObject(obj: any) {
    if (obj.$type$ !== 'Summary') {
      throw new Error('Invalid object type for Summary');
    }
    return new Summary(obj);
  }

  /**
   * Generate summary metadata
   */
  getMetadata(): any {
    return {
      version: this.version,
      wordCount: this.getWordCount(),
      subjectCount: this.subjects.length,
      keywordCount: this.keywords.length,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      changeReason: this.changeReason,
      hash: this.hash
    };
  }

  /**
   * Check if this is the initial version
   */
  isInitialVersion(): any {
    return this.version === 1 && !this.previousVersion;
  }

  /**
   * Get age in days
   */
  getAgeDays(): any {
    return (Date.now() - this.createdAt) / (1000 * 60 * 60 * 24);
  }

  /**
   * Check if summary should be pruned (based on age and version)
   */
  shouldPrune(maxAgeDays = 30, minVersionsToKeep = 10) {
    // Never prune current version
    if (!this.previousVersion || this.version === 1) {
      return false;
    }

    // Keep if within minimum versions to keep
    if (this.version > minVersionsToKeep) {
      return false;
    }

    // Prune if too old
    return this.getAgeDays() > maxAgeDays;
  }

  /**
   * Extract key points from summary content
   * (Simple implementation - could be enhanced with NLP)
   */
  extractKeyPoints(maxPoints = 5) {
    const sentences = this.content.split(/[.!?]+/).filter((s: any) => s.trim().length > 0);

    // Return first N sentences as key points
    return sentences.slice(0, maxPoints).map((s: any) => s.trim());
  }
}

export default Summary;