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
    }

    // Add our custom ID object types
    export interface OneIdObjectInterfaces {
        LLM: LLM;
    }

    // Define our custom object interfaces
    export interface GlobalLLMSettings {
        $type$: 'GlobalLLMSettings';
        name: string; // Instance ID - this is the ID field
        defaultModelId?: string;
        temperature?: number;
        maxTokens?: number;
        defaultProvider: string;
        autoSelectBestModel: boolean;
        preferredModelIds: string[];
        systemPrompt?: string;
        streamResponses?: boolean;
        autoSummarize?: boolean;
        enableMCP?: boolean;
    }

    export interface LLM {
        $type$: 'LLM';
        modelId: string;
        name: string;
        provider: string;
        endpoint?: string;
        apiKey?: string;
        temperature?: number;
        maxTokens?: number;
        contextSize?: number;
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
}