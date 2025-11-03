/**
 * CoreInitializer
 *
 * Enforces correct initialization order across connection.core → lama.core → chat.core
 * Platforms call this instead of manually orchestrating init() calls
 *
 * Flow control is centralized here - no fallbacks, no mitigation, fail fast
 */

import type { AIAssistantHandler } from '../handlers/AIAssistantHandler.js';
import type { ChatHandler } from '@chat/core/handlers/ChatHandler.js';

export interface CoreDependencies {
    // ONE.core models (from connection.core or one.models)
    oneCore: any;
    leuteModel: any;
    channelManager: any;
    topicModel: any;
    connections: any;

    // LAMA-specific (platform must create these)
    llmManager: any;
    llmObjectManager: any;
    aiAssistantModel: AIAssistantHandler;

    // Chat handlers (platform must create these)
    chatHandler: ChatHandler;

    // Optional dependencies
    topicAnalysisModel?: any;
    topicGroupManager?: any;
    stateManager?: any;
}

export interface InitializationProgress {
    stage: string;
    percent: number;
    message: string;
}

/**
 * Initialize all core models in the correct order
 *
 * Order enforced:
 * 1. LeuteModel (contacts/identities)
 * 2. LLM infrastructure (llmManager, aiAssistantModel) - BEFORE channels!
 * 3. ChannelManager (message channels)
 * 4. TopicModel (conversations)
 * 5. ConnectionsModel (P2P/federation)
 * 6. Chat handlers
 *
 * Why this order:
 * - LLM cache MUST be populated before channelManager.init()
 * - channelManager.init() processes existing messages
 * - ChatHandler needs LLM cache to identify AI senders
 */
export async function initializeCoreModels(
    deps: CoreDependencies,
    onProgress?: (progress: InitializationProgress) => void
): Promise<void> {
    console.log('[CoreInitializer] Starting initialization...');

    // Step 1: LeuteModel (base for all identity operations)
    onProgress?.({ stage: 'leute', percent: 10, message: 'Initializing contact model...' });
    await deps.leuteModel.init();
    console.log('[CoreInitializer] ✅ LeuteModel initialized');

    // Step 2: LLM infrastructure (CRITICAL: before channels)
    onProgress?.({ stage: 'llm', percent: 30, message: 'Initializing LLM infrastructure...' });

    // Initialize LLM object manager (storage for LLM configs)
    if (deps.llmObjectManager?.initialize) {
        await deps.llmObjectManager.initialize();
        console.log('[CoreInitializer] ✅ LLMObjectManager initialized');
    }

    // Initialize LLM manager (discover models, load configs)
    if (deps.llmManager?.init) {
        await deps.llmManager.init();
        console.log('[CoreInitializer] ✅ LLMManager initialized');
    }

    // Initialize AI Assistant Handler (populates LLM contact cache)
    if (deps.aiAssistantModel?.init) {
        await deps.aiAssistantModel.init();
        console.log('[CoreInitializer] ✅ AIAssistantHandler initialized (LLM cache populated)');
    }

    // Step 3: ChannelManager (NOW safe to process existing messages)
    onProgress?.({ stage: 'channels', percent: 50, message: 'Initializing message channels...' });
    await deps.channelManager.init();
    console.log('[CoreInitializer] ✅ ChannelManager initialized');

    // Step 4: TopicModel (conversations)
    onProgress?.({ stage: 'topics', percent: 60, message: 'Initializing conversations...' });
    await deps.topicModel.init();
    console.log('[CoreInitializer] ✅ TopicModel initialized');

    // Step 5: ConnectionsModel (P2P/federation)
    onProgress?.({ stage: 'connections', percent: 70, message: 'Initializing P2P connections...' });
    if (deps.connections?.init) {
        await deps.connections.init();
        console.log('[CoreInitializer] ✅ ConnectionsModel initialized');
    }

    // Step 6: Topic Analysis Model (if available)
    onProgress?.({ stage: 'analysis', percent: 80, message: 'Initializing topic analysis...' });
    if (deps.topicAnalysisModel?.init) {
        await deps.topicAnalysisModel.init();
        console.log('[CoreInitializer] ✅ TopicAnalysisModel initialized');
    }

    // Step 7: Chat handlers
    onProgress?.({ stage: 'chat', percent: 90, message: 'Initializing chat handlers...' });
    if (deps.chatHandler?.init) {
        await deps.chatHandler.init();
        console.log('[CoreInitializer] ✅ ChatHandler initialized');
    }

    onProgress?.({ stage: 'complete', percent: 100, message: 'Initialization complete' });
    console.log('[CoreInitializer] ✅ All core models initialized');
}

/**
 * Shutdown all core models in reverse order
 */
export async function shutdownCoreModels(deps: CoreDependencies): Promise<void> {
    console.log('[CoreInitializer] Shutting down core models...');

    const shutdownSteps = [
        { name: 'ChatHandler', fn: () => deps.chatHandler?.shutdown?.() },
        { name: 'TopicAnalysisModel', fn: () => deps.topicAnalysisModel?.shutdown?.() },
        { name: 'AIAssistantHandler', fn: () => deps.aiAssistantModel?.shutdown?.() },
        { name: 'LLMManager', fn: () => deps.llmManager?.shutdown?.() },
        { name: 'ConnectionsModel', fn: () => deps.connections?.shutdown?.() },
        { name: 'TopicModel', fn: () => deps.topicModel?.shutdown?.() },
        { name: 'ChannelManager', fn: () => deps.channelManager?.shutdown?.() },
        { name: 'LeuteModel', fn: () => deps.leuteModel?.shutdown?.() },
    ];

    for (const step of shutdownSteps) {
        await step.fn();
        console.log(`[CoreInitializer] ✅ ${step.name} shutdown`);
    }

    console.log('[CoreInitializer] ✅ Shutdown complete');
}
