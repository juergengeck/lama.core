/* eslint-disable @typescript-eslint/no-empty-interface */

/**
 * LAMA-specific type declarations for ONE.core objects
 * This extends the @OneObjectInterfaces module with our custom types
 */

// Import assembly.core types (Plan, Assembly, Story are defined there)
import type { Plan, Assembly, Story } from '@assembly/core';
// Import memory.core types
import type { Memory } from '@memory/core/types/Memory.js';

declare module '@OneObjectInterfaces' {
    // Add our custom versioned object types
    export interface OneVersionedObjectInterfaces {
        GlobalLLMSettings: GlobalLLMSettings;
        AISettings: AISettings;
        AppSettings: AppSettings;
        AI: AI;
        AIList: AIList;
        Subject: Subject; // Topic analysis
        Keyword: Keyword;
        ProposalConfig: ProposalConfig;
        Proposal: Proposal;
        ProposalInteractionPlan: ProposalInteractionPlan;
        ProposalInteractionResponse: ProposalInteractionResponse;
        // Assembly.core types (imported above)
        Plan: Plan;
        Assembly: Assembly;
        Story: Story;
        // Memory.core types
        Memory: Memory;
    }

    // Add our custom ID object types
    export interface OneIdObjectInterfaces {
        LLM: LLM;
        TTS: TTS;
        STT: STT;
    }

    // Define our custom object interfaces
    /**
     * Ollama server configuration for multi-server support
     */
    export interface OllamaServerConfig {
        id: string;              // Unique ID for this server
        name: string;            // Display name ("Local", "Home Server", etc.)
        baseUrl: string;         // Server URL (e.g., "http://localhost:11434")
        authType?: 'none' | 'bearer';
        enabled: boolean;        // Can disable without deleting
    }

    export interface GlobalLLMSettings {
        $type$: 'GlobalLLMSettings';
        creator: string; // Person ID hash - this is the ID field (enables direct lookup)
        created: number;
        modified: number;
        defaultModelId?: string;
        temperature: number;
        maxTokens: number;
        enableAutoSummary: boolean;
        enableAutoResponse: boolean;
        defaultPrompt: string;
        ollamaServers?: OllamaServerConfig[];  // Multi-server support
    }

    export interface AISettings {
        $type$: 'AISettings';
        name: string; // Instance name - this is the ID field
        defaultProvider: string;
        autoSelectBestModel: boolean;
        preferredModelIds: string[];
        defaultModelId?: string;
        temperature: number;
        maxTokens: number;
        systemPrompt?: string;
        streamResponses: boolean;
        autoSummarize: boolean;
        enableMCP: boolean;
        embeddingModel?: string;
    }

    export interface AppSettings {
        $type$: 'AppSettings';
        owner: string; // Instance owner ID hash - this is the ID field
        // App Settings
        theme: string;
        language: string;
        notifications: boolean;
        soundEnabled: boolean;
        vibrationEnabled: boolean;
        compactMode: boolean;
        showTimestamps: boolean;
        dateFormat: string;
        // Device Settings
        discoveryEnabled: boolean;
        discoveryPort: number;
        autoConnect: boolean;
        addOnlyConnectedDevices: boolean;
        showOfflineDevices: boolean;
        discoveryTimeout: number;
        // Network Settings
        commServerUrl: string;
        autoReconnect: boolean;
        connectionTimeout: number;
        enableWebSocket: boolean;
        enableQUIC: boolean;
        enableBluetooth: boolean;
        // AI Settings
        aiEnabled: boolean;
        aiProvider: string;
        aiModel: string;
        aiTemperature: number;
        aiMaxTokens: number;
        aiStreamResponses: boolean;
        aiAutoSummarize: boolean;
        aiKeywordExtraction: boolean;
        // Privacy Settings
        encryptStorage: boolean;
        requirePINOnStartup: boolean;
        autoLockTimeout: number;
        sendAnalytics: boolean;
        sendCrashReports: boolean;
        // Chat Settings
        enterToSend: boolean;
        showReadReceipts: boolean;
        groupMessagesBy: string;
        maxHistoryDays: number;
        autoDownloadMedia: boolean;
        maxMediaSize: number;
    }

    export interface LLM {
        $type$: 'LLM';
        name: string; // ID field - model name
        server: string; // ID field - server URL (mandatory, defaults to http://localhost:11434)
        modelId?: string;
        filename: string;
        modelType: 'local' | 'remote';
        inferenceType?: 'ondevice' | 'server' | 'cloud'; // Where model runs: ondevice=transformers.js, server=Ollama/LMStudio, cloud=Claude/OpenAI
        active: boolean;
        deleted: boolean;
        creator?: string;
        created: number;
        modified: number;
        createdAt: string;
        lastUsed: string;
        lastInitialized?: number;
        usageCount?: number;
        size?: number;
        personId?: string;
        capabilities?: Array<'chat' | 'inference'>;
        // Model parameters
        temperature?: number;
        maxTokens?: number;
        contextSize?: number;
        batchSize?: number;
        threads?: number;
        mirostat?: number;
        topK?: number;
        topP?: number;
        // Optional properties
        architecture?: string;
        contextLength?: number;
        quantization?: string;
        checksum?: string;
        provider?: string;
        downloadUrl?: string;
        systemPrompt?: string;
        // Network configuration (for remote Ollama)
        baseUrl?: string;
        authType?: 'none' | 'bearer';
        encryptedAuthToken?: string;
    }

    /**
     * TTS (Text-to-Speech) model configuration
     * Model weights are stored as blobs and referenced here
     */
    export interface TTS {
        $type$: 'TTS';
        name: string; // ID field - model identifier (e.g., 'chatterbox')
        huggingFaceRepo: string; // HuggingFace repo (e.g., 'onnx-community/chatterbox-ONNX')
        displayName?: string; // Human-readable name for UI
        modelType: 'local' | 'remote';
        sampleRate: number; // Audio output sample rate (e.g., 24000)
        requiresReferenceAudio?: boolean; // Voice cloning needs reference
        defaultVoiceUrl?: string; // Default voice audio URL
        status: 'not_installed' | 'downloading' | 'installed' | 'loading' | 'ready' | 'error';
        sizeBytes?: number; // Total model size
        downloadProgress?: number; // 0-100 during download
        errorMessage?: string; // Error details if status is 'error'
        // Blob references for model files
        modelBlobs?: import('@refinio/one.core/lib/util/type-checks.js').SHA256Hash<import('@refinio/one.core/lib/recipes.js').BLOB>[];
        blobMetadata?: string; // JSON mapping filename -> blob hash
        provider?: string; // e.g., 'transformers.js', 'onnx-runtime'
        architecture?: string; // e.g., 'chatterbox', 'vits'
        capabilities?: Array<'voice-cloning' | 'multilingual' | 'streaming'>;
        owner?: string; // Person/Instance ID hash
        created: number;
        modified: number;
        lastUsed?: number;
        usageCount?: number;
        deleted?: boolean;
    }

    /**
     * STT (Speech-to-Text) model configuration (Whisper, etc.)
     * Model weights are stored as blobs and referenced here
     */
    export interface STT {
        $type$: 'STT';
        name: string; // ID field - model identifier (e.g., 'whisper-tiny')
        huggingFaceRepo: string; // HuggingFace repo (e.g., 'onnx-community/whisper-tiny')
        displayName?: string; // Human-readable name for UI
        modelType: 'local' | 'remote';
        sampleRate: number; // Expected input sample rate (e.g., 16000)
        languages?: string[]; // Supported languages (ISO 639-1 codes)
        supportsTranslation?: boolean;
        status: 'not_installed' | 'downloading' | 'installed' | 'loading' | 'ready' | 'error';
        sizeBytes?: number; // Total model size
        downloadProgress?: number; // 0-100 during download
        errorMessage?: string; // Error details if status is 'error'
        // Blob references for model files
        modelBlobs?: import('@refinio/one.core/lib/util/type-checks.js').SHA256Hash<import('@refinio/one.core/lib/recipes.js').BLOB>[];
        blobMetadata?: string; // JSON mapping filename -> blob hash
        provider?: string; // e.g., 'transformers.js', 'onnx-runtime'
        architecture?: string; // e.g., 'whisper', 'wav2vec2'
        sizeVariant?: string; // e.g., 'tiny', 'base', 'small', 'medium', 'large'
        capabilities?: Array<'multilingual' | 'translation' | 'timestamps' | 'streaming'>;
        owner?: string; // Person/Instance ID hash
        created: number;
        modified: number;
        lastUsed?: number;
        usageCount?: number;
        deleted?: boolean;
    }

    export interface AI {
        $type$: 'AI';
        aiId: string; // ID field - AI identifier (e.g., "dreizehn" from AI creation email prefix)
        displayName: string;
        personId: string; // AI Person ID
        llmId?: string; // Optional LLM ID hash; undefined = use app default
        modelId: string; // Model identifier (e.g., "gpt-oss:20b")
        owner: string; // Owner Person/Instance ID
        created: number;
        modified: number;
        active: boolean;
        deleted: boolean;
        // AI behavior flags (global defaults, can be overridden per-topic)
        analyse?: boolean; // Run analytics extraction (default: true)
        respond?: boolean; // Generate AI responses (default: true)
        mute?: boolean; // Suppress notifications (default: false)
        ignore?: boolean; // Skip entirely (default: false)
        personality?: {
            creationContext?: {
                device: string;
                locale: string;
                time: number;
                app: string;
            };
            traits?: string[];
            systemPromptAddition?: string;
        };
    }

    export interface AIList {
        $type$: 'AIList';
        id: string; // ID field - fixed value 'ai-list' (singleton per user)
        aiIds: Set<string>; // Set of AI IdHashes for easy enumeration
        modified: number;
    }

    export interface Subject {
        $type$: 'Subject';
        keywords?: import('@refinio/one.core/lib/util/type-checks.js').SHA256IdHash<Keyword>[]; // Array of Keyword ID hashes - THIS IS THE ID PROPERTY (isId: true in recipe)
        description?: string; // LLM-generated description
        abstractionLevel?: number; // 1-42 scale

        // Timestamp fields for message navigation
        timeRanges: Array<{ start: number; end: number }>;  // Time spans when subject was discussed (UI uses for scrolling)
        createdAt: number;     // Unix timestamp when subject was first created
        lastSeenAt: number;    // Unix timestamp when subject was last referenced
        messageCount: number;  // Number of messages referencing this subject

        // References - content that discusses this subject
        topics: string[];  // Array of topic/channel IDs
        memories: string[]; // Array of Memory IdHashes (from memory.core)
        feedbackRefs: string[]; // Array of Feedback IdHashes - user ratings on messages/memories in this subject's context
        // Future: documents, attachments
    }

    /**
     * Feedback - minimal user rating of content
     * Identity: target + author (one rating per person per target)
     * NO timestamp: Story provides it via reverse map
     * NO targetType: Subject understands what targets it has
     */
    export interface Feedback {
        $type$: 'Feedback';
        target: string;  // IdHash of rated thing (Message, Memory, etc.)
        author: string;  // Person IdHash who gave feedback
        rating: 'like' | 'dislike';
    }

    export interface Keyword {
        $type$: 'Keyword';
        term: string; // ID property - normalized keyword term
        frequency: number;
        subjects: import('@refinio/one.core/lib/util/type-checks.js').SHA256IdHash<Subject>[]; // Array of Subject IdHashes (matches recipe)
        score?: number;
        createdAt: number; // Unix timestamp
        lastSeen: number; // Unix timestamp
    }

    export interface ProposalConfig {
        $type$: 'ProposalConfig';
        userEmail: string; // ID property - user's email
        matchWeight: number; // 0.0 to 1.0 - weight given to keyword match
        recencyWeight: number; // 0.0 to 1.0 - weight given to recency
        recencyWindow: number; // milliseconds - time window for recency boost
        minJaccard: number; // 0.0 to 1.0 - minimum Jaccard similarity threshold
        minSimilarity?: number; // 0.0 to 1.0 - minimum embedding similarity threshold
        maxProposals: number; // 1-50 - maximum number of proposals to return
        updatedAt: number; // Unix timestamp of last update
    }

    export interface Proposal {
        $type$: 'Proposal';
        topicId: string; // ID property - where proposal appears
        pastSubject: string; // ID property - IdHash of past subject to share
        currentSubject?: string; // ID property - IdHash of current subject (optional for topic-level)
        matchedKeywords: string[]; // Keywords that matched
        relevanceScore: number; // Combined match + recency score
        sourceTopicId: string; // Where the past subject comes from
        pastSubjectName: string; // Display name
        createdAt: number; // Unix timestamp
    }

    export interface ProposalInteractionPlan {
        $type$: 'ProposalInteractionPlan';
        userEmail: string; // ID property - who is interacting
        proposalIdHash: string; // ID property - which proposal (IdHash)
        action: 'view' | 'dismiss' | 'share'; // ID property - what action
        topicId: string; // Context: where the interaction happened
        createdAt: number; // Unix timestamp
    }

    export interface ProposalInteractionResponse {
        $type$: 'ProposalInteractionResponse';
        plan: string; // ID property - IdHash of the plan
        success: boolean; // Did the action succeed?
        executedAt: number; // Unix timestamp
        sharedToTopicId?: string; // Optional: for 'share' actions
        viewDuration?: number; // Optional: for 'view' actions (milliseconds)
        error?: string; // Optional: if success = false
    }

    // AssemblyPlan and CubeAssembly removed - use Plan/Assembly/Story from @assembly/core instead
}