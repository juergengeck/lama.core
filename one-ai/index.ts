/**
 * one.ai Package - AI-powered Topic Analysis for LAMA Electron
 *
 * This package provides AI-driven topic analysis capabilities including:
 * - Subject identification from conversations
 * - Keyword extraction
 * - Summary generation with versioning
 *
 * All operations run in Node.js main process with ONE.core integration
 */

// Models
import * as Subject from './models/Subject';
import Keyword from './models/Keyword';
import Summary from './models/Summary';

// Services
import TopicAnalyzer from './services/TopicAnalyzer';

// Storage
import SubjectStorage from './storage/subject-storage';
import SummaryStorage from './storage/summary-storage';
import KeywordStorage from './storage/keyword-storage';

export default {
  // Models
  Subject,
  Keyword,
  Summary,

  // Services
  TopicAnalyzer,

  // Storage
  SubjectStorage,
  SummaryStorage,
  KeywordStorage,

  // Version
  version: '1.0.0'
};