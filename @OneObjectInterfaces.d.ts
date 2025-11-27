/* eslint-disable @typescript-eslint/no-empty-interface */

/**
 * LAMA-specific type declarations for ONE.core objects
 * This extends the @OneObjectInterfaces module with our custom types
 */

// Import assembly.core types (Plan, Assembly, Story are defined there)
import type { Plan, Assembly, Story } from '@assembly/core';

declare module '@OneObjectInterfaces' {
    // Add our custom versioned object types
    export interface OneVersionedObjectInterfaces {
        GlobalLLMSettings: GlobalLLMSettings;
        AISettings: AISettings;
        AppSettings: AppSettings;
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
    }

    // Add our custom ID object types
    export interface OneIdObjectInterfaces {
        LLM: LLM;
    }

    // Define our custom object interfaces
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

    export interface AI {
        $type$: 'AI';
        aiId: string; // ID field - AI identifier (e.g., "started-as-gpt-oss-20b")
        displayName: string;
        personId: string; // AI Person ID
        llmProfileId: string; // LLM Profile ID hash that this AI delegates to
        modelId: string; // Model identifier (e.g., "gpt-oss:20b")
        owner: string; // Owner Person/Instance ID
        created: number;
        modified: number;
        active: boolean;
        deleted: boolean;
    }

    export interface Subject {
        $type$: 'Subject';
        keywords?: import('@refinio/one.core/lib/util/type-checks.js').SHA256IdHash<Keyword>[]; // Array of Keyword ID hashes - THIS IS THE ID PROPERTY (isId: true in recipe)
        description?: string; // LLM-generated description
        abstractionLevel?: number; // 1-42 scale

        // References - content that discusses this subject
        topics: string[];  // Array of topic/channel IDs
        memories: string[]; // Array of Memory IdHashes (from memory.core)
        // Future: documents, attachments
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