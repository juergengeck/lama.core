/**
 * Proposal Interaction Helper (Plan/Response Pattern)
 *
 * Manages user interactions with proposals using ONE.core's Plan/Response architecture.
 * - ProposalInteractionPlan: User's intent (view/dismiss/share)
 * - ProposalInteractionResponse: Result of executing the plan
 */

import {
  storeVersionedObject,
  getObjectByIdHash,
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { ProposalInteractionPlan, ProposalInteractionResponse } from '@OneObjectInterfaces';

/**
 * Create and store a ProposalInteractionPlan
 *
 * @param userEmail - User who is interacting
 * @param proposalIdHash - Which proposal (IdHash<Proposal>)
 * @param action - What action (view/dismiss/share)
 * @param topicId - Context: where the interaction happened
 * @returns The stored plan with its ID hash
 */
export async function createProposalInteractionPlan(
  userEmail: string,
  proposalIdHash: SHA256IdHash<any>,
  action: 'view' | 'dismiss' | 'share',
  topicId: string
): Promise<{ plan: ProposalInteractionPlan; planIdHash: SHA256IdHash<ProposalInteractionPlan> }> {
  const plan: ProposalInteractionPlan = {
    $type$: 'ProposalInteractionPlan',
    userEmail,
    proposalIdHash: proposalIdHash as string,
    action,
    topicId,
    createdAt: Date.now(),
  };

  // Store the plan
  const result = await storeVersionedObject(plan);
  const planIdHash = result.hash as unknown as SHA256IdHash<ProposalInteractionPlan>;

  console.log(`[ProposalInteractions] Created ${action} plan:`, planIdHash);

  return { plan, planIdHash };
}

/**
 * Create and store a ProposalInteractionResponse
 *
 * @param planIdHash - The plan this is a response to
 * @param success - Did the action succeed?
 * @param options - Optional metadata (sharedToTopicId, viewDuration, error)
 * @returns The stored response with its ID hash
 */
export async function createProposalInteractionResponse(
  planIdHash: SHA256IdHash<ProposalInteractionPlan>,
  success: boolean,
  options?: {
    sharedToTopicId?: string;
    viewDuration?: number;
    error?: string;
  }
): Promise<{ response: ProposalInteractionResponse; responseIdHash: SHA256IdHash<ProposalInteractionResponse> }> {
  const response: ProposalInteractionResponse = {
    $type$: 'ProposalInteractionResponse',
    plan: planIdHash as string,
    success,
    executedAt: Date.now(),
    ...options,
  };

  // Store the response
  const result = await storeVersionedObject(response);
  const responseIdHash = result.hash as unknown as SHA256IdHash<ProposalInteractionResponse>;

  console.log(`[ProposalInteractions] Created response for plan ${planIdHash}:`, responseIdHash, 'success:', success);

  return { response, responseIdHash };
}

/**
 * Check if a proposal has been dismissed by a user
 *
 * @param userEmail - User email
 * @param proposalIdHash - Proposal ID hash
 * @returns true if the user has dismissed this proposal
 */
export async function isProposalDismissed(
  userEmail: string,
  proposalIdHash: SHA256IdHash<any>
): Promise<boolean> {
  try {
    // Calculate the plan ID hash for a dismiss action
    // This uses the composite ID (userEmail + proposalIdHash + action)
    const dismissPlanId = {
      $type$: 'ProposalInteractionPlan' as const,
      userEmail,
      proposalIdHash: proposalIdHash as string,
      action: 'dismiss' as const,
    };

    const planIdHash = await calculateIdHashOfObj(dismissPlanId as any);

    // Try to retrieve the plan
    const result = await getObjectByIdHash(planIdHash);

    // If it exists, the proposal was dismissed
    return result && result.obj !== null;
  } catch (error) {
    // If we can't find it, it wasn't dismissed
    console.error('[ProposalInteractions] Error checking dismissal:', error);
    return false;
  }
}

/**
 * Check if a proposal has been shared by a user
 *
 * @param userEmail - User email
 * @param proposalIdHash - Proposal ID hash
 * @returns true if the user has shared this proposal
 */
export async function isProposalShared(
  userEmail: string,
  proposalIdHash: SHA256IdHash<any>
): Promise<boolean> {
  try {
    // Calculate the plan ID hash for a share action
    const sharePlanId = {
      $type$: 'ProposalInteractionPlan' as const,
      userEmail,
      proposalIdHash: proposalIdHash as string,
      action: 'share' as const,
    };

    const planIdHash = await calculateIdHashOfObj(sharePlanId as any);

    // Try to retrieve the plan
    const result = await getObjectByIdHash(planIdHash);

    // If it exists, the proposal was shared
    return result && result.obj !== null;
  } catch (error) {
    console.error('[ProposalInteractions] Error checking share:', error);
    return false;
  }
}

/**
 * Get all interaction plans for a user and proposal
 *
 * @param userEmail - User email
 * @param proposalIdHash - Proposal ID hash
 * @returns Array of interactions (view/dismiss/share)
 */
export async function getProposalInteractions(
  userEmail: string,
  proposalIdHash: SHA256IdHash<any>
): Promise<ProposalInteractionPlan[]> {
  const interactions: ProposalInteractionPlan[] = [];

  for (const action of ['view', 'dismiss', 'share'] as const) {
    try {
      const planId = {
        $type$: 'ProposalInteractionPlan' as const,
        userEmail,
        proposalIdHash: proposalIdHash as string,
        action,
      };

      const planIdHash = await calculateIdHashOfObj(planId as any);
      const result = await getObjectByIdHash(planIdHash);

      if (result && result.obj) {
        interactions.push(result.obj as ProposalInteractionPlan);
      }
    } catch (error) {
      // Skip if not found
    }
  }

  return interactions;
}
