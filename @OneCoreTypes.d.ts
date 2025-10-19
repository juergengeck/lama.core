/**
 * TypeScript type definitions for LAMA Electron ONE.core objects
 *
 * This file extends the existing @OneObjectInterfaces with our custom ONE object types
 * following the declaration merging pattern described in ONE.core's README
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';

declare module '@OneObjectInterfaces' {
    // Subject represents a distinct discussion topic within a conversation
    // Tracks temporal ranges when the subject was discussed
    export interface Subject {
        $type$: 'Subject';
        id: string; // keyword combination (e.g., "pizza+baker+career")
        topic: string; // reference to parent topic (channel ID)
        keywords: string[];
        timeRanges: Array<{
            start: number;
            end: number;
        }>;
        messageCount: number;
        createdAt: number;
        lastSeenAt: number;
        archived?: boolean;
        likes?: number;
        dislikes?: number;
    }

    // Keyword extracted from message content
    export interface Keyword {
        $type$: 'Keyword';
        term: string; // ID field - deterministic lookup
        frequency: number;
        subjects: string[]; // Subject IDs (keyword combinations)
        score?: number;
        createdAt: number;
        lastSeen: number;
    }

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
    }

    // GlobalLLMSettings - global settings for LLM management
    export interface GlobalLLMSettings {
        $type$: 'GlobalLLMSettings';
        name: string; // Instance ID - this is the ID field
        defaultProvider: string;
        autoSelectBestModel: boolean;
        preferredModelIds: string[];
        defaultModelId?: string;
        temperature?: number;
        maxTokens?: number;
        systemPrompt?: string;
        streamResponses?: boolean;
        autoSummarize?: boolean;
        enableMCP?: boolean;
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