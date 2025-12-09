/**
 * Plan Registration Service for lama.core
 *
 * Registers all lama.core plan instances with the MCP plan registry.
 * This allows headless servers and all platforms to expose lama.core
 * functionality via MCP without manual registration.
 *
 * Usage (headless server):
 * ```typescript
 * import { registerLamaCorePlans } from '@lama/core/services/plan-registration.js';
 * import { planRegistry } from '@mcp/core';
 *
 * // Initialize your handlers
 * const aiAssistantHandler = new AIAssistantHandler(nodeOneCore, ...);
 *
 * // Register all lama.core plans
 * registerLamaCorePlans({
 *   nodeOneCore,
 *   aiAssistantHandler,
 *   // ... other handlers
 * });
 *
 * // Now MCP can discover and call these plans
 * ```
 */

import { planRegistry } from '@mcp/core';

export interface LamaCoreDependencies {
  nodeOneCore: any;
  aiAssistantHandler?: any;
  chatMemoryHandler?: any;
  subjectService?: any;
  proposalEngine?: any;
  llmManager?: any;
  meaningPlan?: any;
}

/**
 * Register all lama.core handlers/services with the plan registry
 */
export function registerLamaCorePlans(deps: LamaCoreDependencies): void {
  console.log('[lama.core] Registering plans with MCP registry...');

  // Register AI Assistant Handler
  if (deps.aiAssistantHandler) {
    planRegistry.registerPlan(
      'ai-assistant',
      'llm',
      deps.aiAssistantHandler,
      'AI assistant operations (contacts, topics, messages)'
    );
  }

  // Register Chat Memory Handler
  if (deps.chatMemoryHandler) {
    planRegistry.registerPlan(
      'chat-memory',
      'memory',
      deps.chatMemoryHandler,
      'Chat memory and subject extraction'
    );
  }

  // Register Subject Service
  if (deps.subjectService) {
    planRegistry.registerPlan(
      'subjects',
      'analysis',
      deps.subjectService,
      'Subject and keyword management'
    );
  }

  // Register Proposal Engine
  if (deps.proposalEngine) {
    planRegistry.registerPlan(
      'proposals',
      'recommendations',
      deps.proposalEngine,
      'Context-aware proposal generation'
    );
  }

  // Register LLM Manager
  if (deps.llmManager) {
    planRegistry.registerPlan(
      'llm',
      'llm',
      deps.llmManager,
      'LLM provider management (Ollama, Claude, LMStudio)'
    );
  }

  // Register Meaning Plan (semantic similarity dimension)
  if (deps.meaningPlan) {
    planRegistry.registerPlan(
      'meaning',
      'semantic',
      deps.meaningPlan,
      'Semantic similarity search - find content by meaning using embeddings'
    );
  }

  console.log('[lama.core] Plan registration complete');
}

/**
 * Get lama.core plan dependencies from a NodeOneCore instance
 * Convenience function to extract plan instances from NodeOneCore
 */
export function getLamaCoreDepend(nodeOneCore: any): LamaCoreDependencies {
  return {
    nodeOneCore,
    aiAssistantHandler: nodeOneCore.aiAssistantModel,
    chatMemoryHandler: nodeOneCore.chatMemoryHandler,
    subjectService: nodeOneCore.subjectService,
    proposalEngine: nodeOneCore.proposalEngine,
    llmManager: nodeOneCore.llmManager,
    meaningPlan: nodeOneCore.meaningPlan
  };
}
