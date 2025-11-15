/**
 * Abstraction Level Calculator
 *
 * Calculates abstraction levels (1-42) for subjects based on keywords and context.
 *
 * Abstraction Scale:
 * - 1-10: Technical/Implementation details (code, queries, specific tools)
 * - 11-20: Design patterns and practices (architecture, APIs, methodologies)
 * - 21-30: Concepts and principles (paradigms, theories, models)
 * - 31-40: Philosophy and meaning (ethics, epistemology, purpose)
 * - 41-42: Existential/Ultimate questions (existence, consciousness, reality)
 */

export interface AbstractionAnalysis {
  level: number;               // 1-42
  reasoning: string;           // Why this level
  confidence: number;          // 0-1
  signals: {
    keywordLevel: number;      // From keyword analysis
    contextLevel: number;      // From description/context
    messageCountFactor: number; // Adjustment based on depth
  };
}

/**
 * Keywords mapped to abstraction levels
 * This is a heuristic-based approach - can be enhanced with LLM analysis
 */
const KEYWORD_LEVEL_MAP: Record<string, number> = {
  // Level 1-5: Atomic/Technical
  'query': 3,
  'database': 3,
  'sql': 2,
  'function': 2,
  'variable': 1,
  'parameter': 2,
  'array': 2,
  'string': 1,
  'number': 1,
  'boolean': 1,
  'class': 3,
  'method': 2,
  'property': 2,
  'bug': 4,
  'error': 4,
  'fix': 4,
  'implementation': 5,
  'code': 3,

  // Level 6-10: Technical Patterns
  'typescript': 7,
  'javascript': 7,
  'react': 8,
  'component': 7,
  'hook': 7,
  'state': 8,
  'props': 6,
  'api': 9,
  'endpoint': 8,
  'http': 7,
  'rest': 8,
  'graphql': 9,
  'generic': 9,
  'type': 8,
  'interface': 8,

  // Level 11-15: Design Patterns
  'architecture': 15,
  'pattern': 13,
  'design': 14,
  'structure': 12,
  'module': 11,
  // 'abstraction': 14, // Removed - duplicate, using higher level (29)
  'composition': 13,
  'inheritance': 12,
  'polymorphism': 13,
  'encapsulation': 12,
  'coupling': 13,
  'cohesion': 13,
  'refactoring': 14,

  // Level 16-20: Methodologies
  'system': 18,
  'framework': 17,
  'methodology': 19,
  'practice': 17,
  'principle': 19,
  'strategy': 18,
  'optimization': 17,
  'performance': 16,
  'scalability': 18,
  'maintainability': 17,
  'testing': 16,
  'quality': 17,

  // Level 21-25: Concepts
  'paradigm': 24,
  'model': 22,
  'theory': 23,
  'concept': 22,
  'approach': 21,
  // 'perspective': 23, // Removed - duplicate, using higher level (32)
  'context': 22,
  'domain': 21,
  'knowledge': 24,
  'understanding': 24,
  'learning': 23,
  'cognition': 25,

  // Level 26-30: Abstract Thinking
  'thinking': 28,
  'reasoning': 29,
  'logic': 27,
  'semantics': 28,
  // 'meaning': 30, // Removed - duplicate, using higher level (41)
  'interpretation': 28,
  'representation': 27,
  'abstraction': 29,
  'generalization': 28,
  'formalization': 27,

  // Level 31-35: Philosophy
  'philosophy': 35,
  'ethics': 34,
  'values': 33,
  'principles': 32,
  'beliefs': 33,
  'worldview': 35,
  'perspective': 32,
  'wisdom': 34,
  'truth': 35,
  'reality': 36,

  // Level 36-40: Epistemology/Metaphysics
  'epistemology': 38,
  'metaphysics': 39,
  'ontology': 39,
  'phenomenology': 38,
  'hermeneutics': 37,
  'dialectic': 37,
  'transcendence': 40,
  'immanence': 39,
  'essence': 38,
  'substance': 37,

  // Level 41-42: Existential
  'existence': 42,
  'being': 42,
  'consciousness': 42,
  'awareness': 41,
  'self': 41,
  'identity': 40,
  'purpose': 41,
  'meaning': 41,
  'life': 41,
  'death': 41,
  'infinity': 42,
  'nothingness': 42,
  'void': 42
};

/**
 * Calculate abstraction level from keywords
 */
function calculateKeywordLevel(keywords: string[]): { level: number; confidence: number } {
  if (!keywords || keywords.length === 0) {
    return { level: 20, confidence: 0.3 }; // Default middle level, low confidence
  }

  const normalizedKeywords = keywords.map(k => k.toLowerCase().trim());
  const levels: number[] = [];

  for (const keyword of normalizedKeywords) {
    // Exact match
    if (KEYWORD_LEVEL_MAP[keyword] !== undefined) {
      levels.push(KEYWORD_LEVEL_MAP[keyword]);
      continue;
    }

    // Partial match (keyword contains mapped term)
    let matched = false;
    for (const [term, level] of Object.entries(KEYWORD_LEVEL_MAP)) {
      if (keyword.includes(term) || term.includes(keyword)) {
        levels.push(level);
        matched = true;
        break;
      }
    }

    // No match - use heuristics
    if (!matched) {
      // Short technical terms likely low level
      if (keyword.length <= 4 && /^[a-z]+$/.test(keyword)) {
        levels.push(5);
      }
      // Longer abstract terms likely higher level
      else if (keyword.length > 12) {
        levels.push(25);
      }
      // Default
      else {
        levels.push(15);
      }
    }
  }

  if (levels.length === 0) {
    return { level: 20, confidence: 0.3 };
  }

  // Average the levels
  const avgLevel = Math.round(levels.reduce((sum, l) => sum + l, 0) / levels.length);

  // Confidence based on how many keywords we recognized
  const recognizedCount = normalizedKeywords.filter(k =>
    KEYWORD_LEVEL_MAP[k] !== undefined ||
    Object.keys(KEYWORD_LEVEL_MAP).some(term => k.includes(term) || term.includes(k))
  ).length;
  const confidence = Math.min(1.0, recognizedCount / normalizedKeywords.length);

  return { level: Math.min(42, Math.max(1, avgLevel)), confidence };
}

/**
 * Calculate abstraction level from description/context
 */
function calculateContextLevel(description?: string): { level: number; confidence: number } {
  if (!description) {
    return { level: 20, confidence: 0 };
  }

  const text = description.toLowerCase();
  const words = text.split(/\s+/);

  // Extract words that might indicate abstraction level
  const levels: number[] = [];

  for (const word of words) {
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (KEYWORD_LEVEL_MAP[cleanWord] !== undefined) {
      levels.push(KEYWORD_LEVEL_MAP[cleanWord]);
    }
  }

  if (levels.length === 0) {
    // Analyze by heuristics
    // Presence of "why", "how", "what" questions
    if (/\b(why|purpose|reason|meaning)\b/i.test(text)) {
      return { level: 35, confidence: 0.6 };
    }
    if (/\b(how|method|approach|technique)\b/i.test(text)) {
      return { level: 18, confidence: 0.5 };
    }
    if (/\b(what|which|where)\b/i.test(text)) {
      return { level: 12, confidence: 0.4 };
    }

    return { level: 20, confidence: 0.2 };
  }

  const avgLevel = Math.round(levels.reduce((sum, l) => sum + l, 0) / levels.length);
  const confidence = Math.min(1.0, levels.length / (words.length * 0.1));

  return { level: Math.min(42, Math.max(1, avgLevel)), confidence };
}

/**
 * Calculate abstraction level for a subject
 */
export function calculateAbstractionLevel(params: {
  keywords: string[];
  description?: string;
  messageCount?: number;
}): AbstractionAnalysis {
  const { keywords, description, messageCount = 0 } = params;

  // Calculate from keywords
  const keywordAnalysis = calculateKeywordLevel(keywords);

  // Calculate from context
  const contextAnalysis = calculateContextLevel(description);

  // Weight keyword analysis more heavily (70% keywords, 30% context)
  const keywordWeight = 0.7;
  const contextWeight = 0.3;

  const weightedLevel =
    (keywordAnalysis.level * keywordWeight) +
    (contextAnalysis.level * contextWeight);

  // Adjust based on message count (more messages = potentially more depth)
  // Long discussions might evolve to higher abstraction
  let messageCountFactor = 0;
  if (messageCount > 100) {
    messageCountFactor = 3; // Significant discussion, likely more abstract
  } else if (messageCount > 50) {
    messageCountFactor = 2;
  } else if (messageCount > 20) {
    messageCountFactor = 1;
  }

  const finalLevel = Math.min(42, Math.max(1, Math.round(weightedLevel + messageCountFactor)));

  // Overall confidence is average of keyword and context confidence
  const confidence = (keywordAnalysis.confidence * keywordWeight) +
                    (contextAnalysis.confidence * contextWeight);

  // Generate reasoning
  const reasoning = generateReasoning({
    finalLevel,
    keywordLevel: keywordAnalysis.level,
    contextLevel: contextAnalysis.level,
    messageCountFactor,
    confidence
  });

  return {
    level: finalLevel,
    reasoning,
    confidence,
    signals: {
      keywordLevel: keywordAnalysis.level,
      contextLevel: contextAnalysis.level,
      messageCountFactor
    }
  };
}

/**
 * Generate human-readable reasoning for the calculated level
 */
function generateReasoning(params: {
  finalLevel: number;
  keywordLevel: number;
  contextLevel: number;
  messageCountFactor: number;
  confidence: number;
}): string {
  const { finalLevel, keywordLevel, contextLevel, messageCountFactor } = params;

  const levelName = getLevelName(finalLevel);
  const parts: string[] = [
    `Level ${finalLevel} (${levelName})`
  ];

  if (Math.abs(keywordLevel - contextLevel) <= 5) {
    parts.push(`Keywords and context both indicate ${levelName.toLowerCase()} discussion`);
  } else if (keywordLevel > contextLevel) {
    parts.push(`Keywords suggest higher abstraction (${keywordLevel}) than context (${contextLevel})`);
  } else {
    parts.push(`Context suggests higher abstraction (${contextLevel}) than keywords (${keywordLevel})`);
  }

  if (messageCountFactor > 0) {
    parts.push(`+${messageCountFactor} for extensive discussion depth`);
  }

  return parts.join('. ');
}

/**
 * Get human-readable name for abstraction level
 */
export function getLevelName(level: number): string {
  if (level <= 5) return 'Atomic/Technical';
  if (level <= 10) return 'Technical Patterns';
  if (level <= 15) return 'Design Patterns';
  if (level <= 20) return 'Methodologies';
  if (level <= 25) return 'Concepts';
  if (level <= 30) return 'Abstract Thinking';
  if (level <= 35) return 'Philosophy';
  if (level <= 40) return 'Epistemology/Metaphysics';
  return 'Existential';
}

/**
 * Get level range name (for grouping)
 */
export function getLevelRange(level: number): { min: number; max: number; name: string } {
  if (level <= 10) return { min: 1, max: 10, name: 'Technical' };
  if (level <= 20) return { min: 11, max: 20, name: 'Design' };
  if (level <= 30) return { min: 21, max: 30, name: 'Conceptual' };
  if (level <= 40) return { min: 31, max: 40, name: 'Philosophical' };
  return { min: 41, max: 42, name: 'Existential' };
}
