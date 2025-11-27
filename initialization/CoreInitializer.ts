/**
 * CoreInitializer
 *
 * Enforces correct initialization order across connection.core → lama.core → chat.core
 * Platforms call this instead of manually orchestrating init() calls
 *
 * Flow control is centralized here - no fallbacks, no mitigation, fail fast
 */

import type { AIAssistantPlan } from '../plans/AIAssistantPlan.js';
import type { ChatPlan } from '@chat/core/plans/ChatPlan.js';

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
    aiAssistantModel: AIAssistantPlan;

    // Chat plans (platform must create these - from chat.core)
    chatPlan: ChatPlan;

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
 * 6. Chat plans
 *
 * Why this order:
 * - LLM cache MUST be populated before channelManager.init()
 * - channelManager.init() processes existing messages
 * - ChatPlan needs LLM cache to identify AI senders
 */
export async function initializeCoreModels(
    deps: CoreDependencies,
    onProgress?: (progress: InitializationProgress) => void
): Promise<void> {
    console.log('[CoreInitializer.initializeCoreModels] 🟢 START - Core initialization beginning');
    console.log('[CoreInitializer.initializeCoreModels] Received deps:', {
        oneCore: !!deps.oneCore,
        leuteModel: !!deps.leuteModel,
        channelManager: !!deps.channelManager,
        topicModel: !!deps.topicModel,
        connections: !!deps.connections,
        llmManager: !!deps.llmManager,
        aiAssistantModel: !!deps.aiAssistantModel
    });

    // Step 1: LeuteModel (base for all identity operations)
    onProgress?.({ stage: 'leute', percent: 10, message: 'Initializing contact model...' });
    console.log('[CoreInitializer] 🚀 Calling leuteModel.init()...');
    await deps.leuteModel.init();
    console.log('[CoreInitializer] ✅ leuteModel.init() completed');

    // CRITICAL: Set ownerId immediately after LeuteModel init, BEFORE AI module tries to use it
    const myMainId = await deps.leuteModel.myMainIdentity();
    if (deps.oneCore) {
        deps.oneCore.ownerId = myMainId;
        console.log('[CoreInitializer] ✅ Set oneCore.ownerId:', myMainId?.substring(0, 8) + '...');
    }

    // Step 2: LLM infrastructure (CRITICAL: before channels)
    onProgress?.({ stage: 'llm', percent: 30, message: 'Initializing LLM infrastructure...' });

    // Initialize LLM object manager (storage for LLM configs)
    if (deps.llmObjectManager?.initialize) {
        await deps.llmObjectManager.initialize();
        console.log('[CoreInitializer] ✅ LLMObjectManager initialized');
    }

    // Discover LLM models BEFORE initializing AIAssistantPlan
    // This ensures AIAssistantPlan.init() can create default chats with discovered models
    console.log('[CoreInitializer] 🚀 Calling llmManager.init()...');
    await deps.llmManager.init();
    console.log('[CoreInitializer] ✅ llmManager.init() completed - models discovered');

    // Initialize AI Assistant Plan (populates LLM contact cache)
    // Now that models are discovered, init() will create default chats
    console.log('[CoreInitializer] 🔍 Checking if aiAssistantModel.init exists...');
    console.log('[CoreInitializer] aiAssistantModel:', deps.aiAssistantModel ? 'EXISTS' : 'UNDEFINED');
    console.log('[CoreInitializer] aiAssistantModel.init:', deps.aiAssistantModel?.init ? 'EXISTS' : 'UNDEFINED');
    if (deps.aiAssistantModel?.init) {
        console.log('[CoreInitializer] 🚀 Calling aiAssistantModel.init()...');
        await deps.aiAssistantModel.init();
        console.log('[CoreInitializer] ✅ aiAssistantModel.init() completed');
    } else {
        console.warn('[CoreInitializer] ⚠️ Skipping aiAssistantModel.init() - not available');
    }

    // Step 3: ChannelManager (NOW safe to process existing messages)
    onProgress?.({ stage: 'channels', percent: 50, message: 'Initializing message channels...' });
    await deps.channelManager.init();
    console.log('[CoreInitializer] ✅ ChannelManager initialized');

    // Step 3.5: Scan existing conversations NOW that channels are loaded
    // This registers AI topics in the in-memory registry
    console.log('[CoreInitializer] Scanning existing conversations for AI topics...');
    const scannedCount = await deps.aiAssistantModel.scanExistingConversations();
    console.log(`[CoreInitializer] ✅ Scanned and registered ${scannedCount} AI topics`);

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

    // Step 7: Chat plans (no init method - ChatPlan is stateless)
    onProgress?.({ stage: 'chat', percent: 90, message: 'Chat plans ready...' });
    console.log('[CoreInitializer] ✅ ChatPlan ready (stateless)');

    onProgress?.({ stage: 'complete', percent: 100, message: 'Initialization complete' });
    console.log('[CoreInitializer.initializeCoreModels] 🟢 END - All core models initialized');
}

/**
 * Shutdown all core models in reverse order
 */
export async function shutdownCoreModels(deps: CoreDependencies): Promise<void> {
    console.log('[CoreInitializer] Shutting down core models...');

    const shutdownSteps = [
        // ChatPlan is stateless - no shutdown needed
        { name: 'TopicAnalysisModel', fn: () => deps.topicAnalysisModel?.shutdown?.() },
        { name: 'AIAssistantPlan', fn: () => deps.aiAssistantModel?.shutdown?.() },
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
