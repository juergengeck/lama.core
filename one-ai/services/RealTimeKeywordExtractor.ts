/**
 * Real-time Keyword Extractor
 * Extracts meaningful single-word keywords from text for immediate display
 */

class RealTimeKeywordExtractor {
  public stopWords: any;
  public minWordLength: any;
  public maxKeywords: any;

  constructor() {

    // Much more comprehensive stop words list
    this.stopWords = new Set([
      // Articles & determiners
      'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their',

      // Pronouns
      'i', 'me', 'you', 'he', 'him', 'she', 'her', 'it', 'we', 'us', 'they', 'them',

      // Basic verbs (be, have, do, modals)
      'am', 'is', 'are', 'was', 'were', 'been', 'being', 'be',
      'have', 'has', 'had', 'having',
      'do', 'does', 'did', 'doing', 'done',
      'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall',
      'let', 'lets', 'letting',

      // Common action verbs that don't carry meaning
      'get', 'got', 'getting', 'gets',
      'go', 'goes', 'going', 'went', 'gone',
      'come', 'comes', 'coming', 'came',
      'make', 'makes', 'making', 'made',
      'take', 'takes', 'taking', 'took', 'taken',
      'give', 'gives', 'giving', 'gave', 'given',
      'know', 'knows', 'knowing', 'knew', 'known',
      'think', 'thinks', 'thinking', 'thought',
      'see', 'sees', 'seeing', 'saw', 'seen',
      'want', 'wants', 'wanting', 'wanted',
      'need', 'needs', 'needing', 'needed',
      'say', 'says', 'saying', 'said',
      'tell', 'tells', 'telling', 'told',
      'ask', 'asks', 'asking', 'asked',
      'use', 'uses', 'using', 'used',
      'find', 'finds', 'finding', 'found',
      'work', 'works', 'working', 'worked',
      'seem', 'seems', 'seeming', 'seemed',
      'feel', 'feels', 'feeling', 'felt',
      'try', 'tries', 'trying', 'tried',
      'leave', 'leaves', 'leaving', 'left',
      'call', 'calls', 'calling', 'called',

      // Question words
      'what', 'when', 'where', 'why', 'how', 'which', 'who', 'whom', 'whose',

      // Prepositions
      'at', 'on', 'in', 'to', 'from', 'with', 'about', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'under', 'over', 'by', 'for',
      'of', 'off', 'out', 'up', 'down', 'around', 'near', 'upon', 'within', 'without',

      // Conjunctions
      'and', 'or', 'but', 'if', 'because', 'as', 'until', 'while', 'since', 'unless',
      'although', 'though', 'whereas', 'whether', 'either', 'neither', 'nor', 'yet', 'so',

      // Common adjectives that don't add meaning
      'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
      'any', 'no', 'not', 'only', 'own', 'same', 'very', 'just', 'good', 'bad',
      'new', 'old', 'big', 'small', 'large', 'little', 'long', 'short', 'high', 'low',

      // Common adverbs
      'here', 'there', 'now', 'then', 'always', 'never', 'sometimes', 'often',
      'very', 'really', 'quite', 'just', 'too', 'also', 'again', 'already', 'still',
      'even', 'ever', 'away', 'back', 'almost', 'enough', 'though',

      // Common interjections and fillers
      'hello', 'hi', 'hey', 'bye', 'goodbye', 'yes', 'no', 'yeah', 'nah', 'yep', 'nope',
      'okay', 'ok', 'oh', 'ah', 'eh', 'um', 'hmm', 'well', 'like', 'mean', 'actually',
      'basically', 'honestly', 'seriously', 'literally', 'totally', 'definitely',
      'probably', 'maybe', 'perhaps', 'possibly', 'certainly', 'surely', 'obviously',

      // Generic words
      'thing', 'things', 'something', 'anything', 'nothing', 'everything',
      'someone', 'anyone', 'everyone', 'no one', 'nobody', 'somebody', 'everybody',
      'somewhere', 'anywhere', 'everywhere', 'nowhere',
      'time', 'times', 'way', 'ways', 'day', 'days', 'year', 'years',
      'people', 'person', 'man', 'woman', 'child', 'place', 'point', 'case',

      // Common conversation words
      'please', 'thanks', 'thank', 'sorry', 'excuse', 'pardon',
      'sure', 'right', 'wrong', 'true', 'false', 'question', 'answer',
      'talk', 'speak', 'chat', 'help', 'wait', 'stop', 'start', 'look',

      // Contractions and fragments
      'll', 've', 're', 'd', 'm', 's', 't', 'ain',
      'won', 'don', 'didn', 'doesn', 'isn', 'aren', 'wasn', 'weren',
      'hasn', 'haven', 'hadn', 'couldn', 'wouldn', 'shouldn', 'mustn',
      'can', 'cannot', 'gonna', 'wanna', 'gotta'
    ]);

    this.minWordLength = 4;
    this.maxKeywords = 15;
  }

  /**
   * Extract single-word keywords from text
   * Returns array of meaningful single words only
   */
  extractSingleWords(text: any): any {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // Convert to lowercase and extract words
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')  // Remove punctuation
      .split(/\s+/)              // Split on whitespace
      .filter(word =>
        word.length >= this.minWordLength &&
        !this.stopWords.has(word) &&
        !this.isNumeric(word) &&
        this.isMeaningfulWord(word)
      );

    // Count word frequency
    const wordFreq: Record<string, number> = {};
    for (const word of words) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }

    // Sort by frequency and filter for quality
    return Object.entries(wordFreq)
      .sort((a, b) => (b[1] as any) - (a[1] as any))
      .map(([word]) => word)
      .filter(word => this.isQualityKeyword(word))
      .slice(0, this.maxKeywords);
  }

  /**
   * Check if a word is meaningful (not just random letters)
   */
  isMeaningfulWord(word: any): any {
    // Must have at least one vowel
    if (!/[aeiou]/i.test(word)) return false;

    // Avoid repeated characters (like "hmmm", "ohhh")
    if (/(.)\1{2,}/.test(word)) return false;

    // Avoid words that are all consonants except for common acronyms
    const consonantRatio = (String(word).match(/[^aeiou]/gi) || []).length / word.length;
    if (consonantRatio > 0.75 && word.length > 5) return false;

    return true;
  }

  /**
   * Additional quality check for keywords
   */
  isQualityKeyword(word: any): any {
    // Filter out words that are too generic even if they passed initial filters
    const genericPatterns = [
      /^(talk|speak|chat|conversation)$/,
      /^(question|answer|response|reply)$/,
      /^(example|sample|test|demo)$/,
      /^(stuff|kind|sort|type)$/,
      /^(fact|idea|thought|opinion)$/,
      /^(begin|start|end|stop|finish)$/,
      /^(nice|cool|great|fine|okay)$/
    ];

    for (const pattern of genericPatterns) {
      if (pattern.test(word)) return false;
    }

    return true;
  }

  /**
   * Extract keywords from multiple messages
   * Aggregates and ranks keywords across all messages
   */
  extractFromMessages(messages: any, maxKeywords = 15) {
    if (!messages || messages.length === 0) {
      return [];
    }

    const aggregatedFreq = {};
    const messageCount = {};

    for (const message of messages) {
      const text = message.text || message.content || message;
      const keywords = this.extractSingleWords(text);

      // Track unique keywords per message to calculate document frequency
      const uniqueInMessage = new Set(keywords);

      for (const keyword of uniqueInMessage) {
        aggregatedFreq[keyword as string] = (aggregatedFreq[keyword as string] || 0) + 1;
        messageCount[keyword as string] = (messageCount[keyword as string] || 0) + 1;
      }
    }

    // Calculate TF-IDF-like score (term frequency * inverse document frequency)
    const scoredKeywords: any[] = Object.entries(aggregatedFreq).map(([word, freq]) => {
      const tf = freq as number;
      const df = messageCount[word as string];
      const idf = Math.log(messages.length / df);
      return {
        word,
        score: tf * idf,
        frequency: freq as number
      };
    });

    // Return sorted by score
    return scoredKeywords
      .sort((a, b) => b.score - a.score)
      .slice(0, maxKeywords)
      .map(item => item.word);
  }

  /**
   * Extract keywords incrementally (for real-time updates)
   * Merges new keywords with existing ones
   */
  mergeKeywords(existingKeywords: any, newText: any, maxKeywords = 15) {
    const newKeywords = this.extractSingleWords(newText);

    // Create frequency map for existing keywords (higher weight for existing)
    const keywordScore: Record<string, number> = {};
    existingKeywords.forEach((keyword: any, index: any) => {
      keywordScore[keyword] = existingKeywords.length - index + 10; // Bonus for existing
    });

    // Add new keywords with their scores
    newKeywords.forEach((keyword: any) => {
      keywordScore[keyword] = (keywordScore[keyword] || 0) + 5;
    });

    // Sort by score and return top keywords
    return Object.entries(keywordScore)
      .sort((a, b) => (b[1] as any) - (a[1] as any))
      .slice(0, maxKeywords)
      .map(([word]) => word);
  }

  /**
   * Check if a string is numeric
   */
  isNumeric(str: any): any {
    return /^\d+$/.test(str);
  }
}

export default RealTimeKeywordExtractor;