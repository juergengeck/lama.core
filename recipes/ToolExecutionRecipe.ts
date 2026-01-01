/**
 * ToolExecution Recipe for ONE.core
 * Defines the schema for AI tool execution tracking objects
 *
 * Each ToolExecution represents a single tool call made by an AI.
 * Used for audit trails, journal entries, and debugging.
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';

/**
 * ToolExecution object - stored in ONE.core
 */
export interface ToolExecution {
    $type$: 'ToolExecution';
    /** Unique execution ID (tool + timestamp + requestId) */
    id: string;
    /** Full tool name (e.g., plan:ai-assistant:sendMessage, mcp:filesystem:read) */
    tool: string;
    /** Tool prefix (plan or mcp) */
    prefix: 'plan' | 'mcp';
    /** Domain/plan name */
    domain: string;
    /** Method name */
    method: string;
    /** Execution result status */
    status: 'success' | 'error' | 'denied';
    /** Error message if status is error */
    errorMessage?: string;
    /** Topic/conversation context */
    topicId?: string;
    /** AI Person that made the call */
    callerId: SHA256IdHash<Person>;
    /** Request correlation ID */
    requestId: string;
    /** Execution start timestamp */
    timestamp: number;
    /** Execution duration in ms */
    duration: number;
    /** Parameters hash (for privacy - don't store raw params) */
    paramsHash?: string;
    /** Result data hash (for privacy - don't store raw result) */
    resultHash?: string;
}

/**
 * ONE.core Recipe definition for ToolExecution
 */
export const ToolExecutionRecipe = {
    $type$: 'Recipe' as const,
    name: 'ToolExecution',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^ToolExecution$/ }
        },
        {
            itemprop: 'id',
            itemtype: { type: 'string' },
            isId: true
        },
        {
            itemprop: 'tool',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'prefix',
            itemtype: {
                type: 'string',
                regexp: /^(plan|mcp)$/
            }
        },
        {
            itemprop: 'domain',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'method',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'status',
            itemtype: {
                type: 'string',
                regexp: /^(success|error|denied)$/
            }
        },
        {
            itemprop: 'errorMessage',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'topicId',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'callerId',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Person'])
            }
        },
        {
            itemprop: 'requestId',
            itemtype: { type: 'string' }
        },
        {
            itemprop: 'timestamp',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'duration',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'paramsHash',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'resultHash',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};
