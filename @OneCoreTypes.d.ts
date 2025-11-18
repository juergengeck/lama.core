/**
 * TypeScript type definitions for LAMA Electron ONE.core objects
 *
 * This file extends the existing @OneObjectInterfaces with our custom ONE object types
 * following the declaration merging pattern described in ONE.core's README
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';

declare module '@OneObjectInterfaces' {
    // NOTE: Subject and Keyword types are now defined in @OneObjectInterfaces.d.ts
    // to match the recipes exactly. Do not redefine them here.

    // Summary of a topic conversation with versioning support
    export interface Summary {
        $type$: 'Summary';
        id: string; // format: ${topicId}-v${version}
        topic: string; // reference to parent topic
        content: string;
        subjects: string[]; // Subject IDs
        keywords: string[]; // All keywords from all subjects
        version: number;
        previousVersion?: string; // Hash of previous summary
        createdAt: number;
        updatedAt: number;
        changeReason?: string;
        hash?: string;
    }

    // WordCloudSettings for visualization preferences
    export interface WordCloudSettings {
        $type$: 'WordCloudSettings';
        creator: string;
        created: number;
        modified: number;
        maxWordsPerSubject: number;
        relatedWordThreshold: number;
        minWordFrequency: number;
        showSummaryKeywords: boolean;
        fontScaleMin: number;
        fontScaleMax: number;
        colorScheme: string;
        layoutDensity: string;
    }

    // LLM object type - represents a Language Learning Model configuration
    export interface LLM {
        $type$: 'LLM';
        name: string;
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

        // Required LLM identification fields
        modelId: string;

        // personId being present = this is an AI contact
        personId?: SHA256IdHash<Person>;
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
    }

    // AI object type - represents an AI assistant identity
    export interface AI {
        $type$: 'AI';
        aiId: string; // ID field - AI identifier
        displayName: string;
        personId: SHA256IdHash<Person>; // AI Person ID
        llmPersonId: SHA256IdHash<Person>; // LLM Person ID that this AI delegates to
        modelId: string; // Model identifier
        owner: SHA256IdHash<Person>; // Owner Person/Instance ID
        created: number;
        modified: number;
        active: boolean;
        deleted: boolean;
    }

    // GlobalLLMSettings - global settings for LLM management
    // Uses creator (Person ID) as ID field for direct retrieval
    export interface GlobalLLMSettings {
        $type$: 'GlobalLLMSettings';
        creator: string; // Person ID hash - ID field (enables direct lookup, NO QUERIES)
        created: number;
        modified: number;
        defaultModelId?: string;
        temperature: number;
        maxTokens: number;
        enableAutoSummary: boolean;
        enableAutoResponse: boolean;
        defaultPrompt: string;
    }

    // MessageAssertion for verifiable message credentials
    export interface MessageAssertion {
        $type$: 'MessageAssertion';
        messageId: string;
        messageHash: string;
        text: string;
        timestamp: string;
        sender: string;
        subjects?: string[];
        keywords?: string[];
        version?: number;
        assertedAt: string;
        assertionType: string;
        assertionVersion: string;
    }

    // XMLMessageAttachment - stores XML-formatted LLM messages
    export interface XMLMessageAttachment {
        $type$: 'XMLMessageAttachment';
        topicId: string;
        messageId: string;
        xmlContent?: string; // Inline XML if ≤1KB
        xmlBlob?: string; // BLOB hash if >1KB (stored as string)
        format: string; // 'llm-query' | 'llm-response'
        version: number; // Schema version (1)
        createdAt: number; // Unix timestamp
        size: number; // Byte size
    }

    // SystemPromptTemplate - per-model system prompts with XML format instructions
    export interface SystemPromptTemplate {
        $type$: 'SystemPromptTemplate';
        modelId: string; // ID field - FK to LLM
        promptText: string;
        xmlSchemaVersion: number;
        version: number;
        active: boolean;
        createdAt: number;
        updatedAt: number;
    }

    // MCPServer - Configuration for an MCP server
    export interface MCPServer {
        $type$: 'MCPServer';
        name: string; // ID field - unique server identifier
        command: string;
        args: string[];
        description: string;
        enabled: boolean;
        createdAt: number;
        updatedAt: number;
    }

    // MCPServerConfig - User's MCP configuration object
    export interface MCPServerConfig {
        $type$: 'MCPServerConfig';
        userEmail: string; // ID field - user identifier
        servers: SHA256IdHash<MCPServer>[];
        updatedAt: number;
    }

    // ProposalConfig - Configuration for proposal matching algorithm
    export interface ProposalConfig {
        $type$: 'ProposalConfig';
        userEmail: string; // ID field - user identifier
        matchWeight: number;
        recencyWeight: number;
        recencyWindow: number;
        minJaccard: number;
        maxProposals: number;
        updatedAt: number;
    }

    // AvatarPreference - Stores avatar color preference for a person
    export interface AvatarPreference {
        $type$: 'AvatarPreference';
        personId: string; // ID field - Person ID hash
        color: string; // Hex color code
        mood?: 'happy' | 'sad' | 'angry' | 'calm' | 'excited' | 'tired' | 'focused' | 'neutral'; // Current mood
        updatedAt: number; // Unix timestamp
    }

    // Import AffirmationCertificate from ONE.models - it's already defined there

    // Extend ONE.core's ID object interfaces (for objects that can be retrieved by ID)
    interface OneIdObjectInterfaces {
        LLM: Pick<LLM, '$type$' | 'name'>;
        GlobalLLMSettings: GlobalLLMSettings;
        SystemPromptTemplate: Pick<SystemPromptTemplate, '$type$' | 'modelId'>;
    }

    // Extend ONE.core's versioned object interfaces with our types
    interface OneVersionedObjectInterfaces {
        Subject: Subject;
        Keyword: Keyword;
        Summary: Summary;
        WordCloudSettings: WordCloudSettings;
        LLM: LLM;
        GlobalLLMSettings: GlobalLLMSettings;
        MessageAssertion: MessageAssertion;
        XMLMessageAttachment: XMLMessageAttachment;
        SystemPromptTemplate: SystemPromptTemplate;
        MCPServer: MCPServer;
        MCPServerConfig: MCPServerConfig;
        ProposalConfig: ProposalConfig;
        AvatarPreference: AvatarPreference;
    }
}