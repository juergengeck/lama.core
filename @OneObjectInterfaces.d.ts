/* eslint-disable @typescript-eslint/no-empty-interface */

/**
 * LAMA-specific type declarations for ONE.core objects
 * This extends the @OneObjectInterfaces module with our custom types
 */

declare module '@OneObjectInterfaces' {
    // Add our custom versioned object types
    export interface OneVersionedObjectInterfaces {
        GlobalLLMSettings: GlobalLLMSettings;
        Keyword: Keyword;
        ProposalConfig: ProposalConfig;
        Proposal: Proposal;
        ProposalInteractionPlan: ProposalInteractionPlan;
        ProposalInteractionResponse: ProposalInteractionResponse;
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

    export interface LLM {
        $type$: 'LLM';
        name: string; // ID field - model name
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

    export interface Keyword {
        $type$: 'Keyword';
        term: string; // ID property - normalized keyword term
        frequency: number;
        subjects: string[]; // Array of subject IDs
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
}