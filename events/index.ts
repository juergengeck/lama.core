/**
 * Centralized Event Registry for LAMA
 *
 * Single source of truth for all IPC/bridge events.
 * Import from here to get compile-time validation of event names.
 *
 * Naming conventions:
 * - ai:*     = AI assistant orchestration (high-level behavior)
 * - llm:*    = Language model events (text generation)
 * - tts:*    = Text-to-speech model events
 * - stt:*    = Speech-to-text model events (future)
 * - chat:*   = Chat/messaging events
 * - contact:* = Contact management events
 * - nav:*    = Navigation events
 */

// =============================================================================
// Event Name Constants
// =============================================================================

export const Events = {
  // -------------------------------------------------------------------------
  // AI Assistant Events (high-level orchestration)
  // -------------------------------------------------------------------------
  /** AI is working on a response */
  AI_RESPONDING: 'ai:responding',
  /** AI encountered an error */
  AI_ERROR: 'ai:error',

  // -------------------------------------------------------------------------
  // LLM Model Events (text generation)
  // -------------------------------------------------------------------------
  /** LLM is streaming text chunks */
  LLM_STREAM: 'llm:stream',
  /** LLM finished generating response */
  LLM_COMPLETE: 'llm:complete',
  /** LLM reasoning/thinking stream (for reasoning models) */
  LLM_THINKING: 'llm:thinking',
  /** LLM processing status update */
  LLM_STATUS: 'llm:status',

  // -------------------------------------------------------------------------
  // TTS Model Events (text-to-speech)
  // -------------------------------------------------------------------------
  /** TTS synthesis progress */
  TTS_PROGRESS: 'tts:progress',
  /** TTS synthesis complete */
  TTS_COMPLETE: 'tts:complete',
  /** TTS error */
  TTS_ERROR: 'tts:error',

  // -------------------------------------------------------------------------
  // Analysis Events (data extraction)
  // -------------------------------------------------------------------------
  /** Subjects extracted/updated for a topic */
  SUBJECTS_UPDATED: 'subjects:updated',
  /** Keywords extracted/updated for a topic */
  KEYWORDS_UPDATED: 'keywords:updated',

  // -------------------------------------------------------------------------
  // Chat Events (messaging)
  // -------------------------------------------------------------------------
  /** New messages received */
  CHAT_NEW_MESSAGES: 'chat:newMessages',
  /** Conversation created */
  CHAT_CONVERSATION_CREATED: 'chat:conversationCreated',
  /** Message sent */
  CHAT_MESSAGE_SENT: 'chat:messageSent',
  /** Channel updated */
  CHANNEL_UPDATED: 'channel:updated',

  // -------------------------------------------------------------------------
  // Contact Events
  // -------------------------------------------------------------------------
  /** Contact added */
  CONTACT_ADDED: 'contact:added',
  /** Contacts list updated */
  CONTACTS_UPDATED: 'contacts:updated',
  /** New pending contact request */
  CONTACTS_PENDING_NEW: 'contacts:pending:new',
  /** Contact request accepted */
  CONTACTS_ACCEPTED: 'contacts:accepted',
  /** Verifiable credential received */
  CONTACTS_VC_RECEIVED: 'contacts:vc:received',

  // -------------------------------------------------------------------------
  // Navigation Events
  // -------------------------------------------------------------------------
  /** Navigate to route */
  NAVIGATE: 'navigate',

  // -------------------------------------------------------------------------
  // System Events
  // -------------------------------------------------------------------------
  /** Node.js log message */
  NODE_LOG: 'node-log',
  /** Main process log update */
  MAIN_PROCESS_LOG: 'update:mainProcessLog',
  /** ONE.core initialization progress */
  ONECORE_INIT_PROGRESS: 'onecore:init-progress',
  /** Local models text generation progress */
  LOCAL_MODELS_PROGRESS: 'localModels:textGenProgress',
} as const;

// Type for any valid event name
export type EventName = (typeof Events)[keyof typeof Events];

// =============================================================================
// Event Payload Types
// =============================================================================

export interface EventPayloads {
  // AI Events
  [Events.AI_RESPONDING]: {
    topicId: string;
    progress: number;
  };
  [Events.AI_ERROR]: {
    topicId: string;
    error: string;
  };

  // LLM Events
  [Events.LLM_STREAM]: {
    topicId: string;
    messageId: string;
    content: string;
    modelId?: string;
    modelName?: string;
  };
  [Events.LLM_COMPLETE]: {
    topicId: string;
    messageId: string;
    content: string;
    language?: string;
    status: 'success' | 'error';
    modelId?: string;
    modelName?: string;
  };
  [Events.LLM_THINKING]: {
    topicId: string;
    messageId: string;
    content: string;
  };
  [Events.LLM_STATUS]: {
    topicId: string;
    status: string;
  };

  // TTS Events
  [Events.TTS_PROGRESS]: {
    progress: number;
    status: string;
  };
  [Events.TTS_COMPLETE]: {
    audioData?: ArrayBuffer;
  };
  [Events.TTS_ERROR]: {
    error: string;
  };

  // Analysis Events
  [Events.SUBJECTS_UPDATED]: {
    topicId: string;
  };
  [Events.KEYWORDS_UPDATED]: {
    topicId: string;
  };

  // Chat Events
  [Events.CHAT_NEW_MESSAGES]: {
    topicId: string;
    messages: unknown[];
  };
  [Events.CHAT_CONVERSATION_CREATED]: {
    conversationId: string;
  };
  [Events.CHAT_MESSAGE_SENT]: {
    topicId: string;
    messageId: string;
  };
  [Events.CHANNEL_UPDATED]: {
    channelId: string;
  };

  // Contact Events
  [Events.CONTACT_ADDED]: {
    contactId: string;
  };
  [Events.CONTACTS_UPDATED]: Record<string, never>;
  [Events.CONTACTS_PENDING_NEW]: {
    contactId: string;
  };
  [Events.CONTACTS_ACCEPTED]: {
    contactId: string;
  };
  [Events.CONTACTS_VC_RECEIVED]: {
    contactId: string;
    vcType: string;
  };

  // Navigation Events
  [Events.NAVIGATE]: {
    route: string;
    params?: Record<string, unknown>;
  };

  // System Events
  [Events.NODE_LOG]: {
    level: string;
    message: string;
  };
  [Events.MAIN_PROCESS_LOG]: {
    log: string;
  };
  [Events.ONECORE_INIT_PROGRESS]: {
    step: string;
    progress: number;
  };
  [Events.LOCAL_MODELS_PROGRESS]: {
    modelId: string;
    progress: number;
  };
}

// =============================================================================
// Typed Event Emitter Interface
// =============================================================================

export interface TypedEventEmitter {
  emit<K extends EventName>(event: K, payload: EventPayloads[K]): void;
  on<K extends EventName>(event: K, handler: (payload: EventPayloads[K]) => void): () => void;
  off<K extends EventName>(event: K, handler: (payload: EventPayloads[K]) => void): void;
}

// =============================================================================
// Utility: Get all event names as array (for preload whitelist)
// =============================================================================

export const ALL_EVENT_NAMES: EventName[] = Object.values(Events);

// =============================================================================
// Utility: Check if string is valid event name
// =============================================================================

export function isValidEventName(name: string): name is EventName {
  return ALL_EVENT_NAMES.includes(name as EventName);
}
