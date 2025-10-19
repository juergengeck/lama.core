/**
 * Keyword Access Storage
 * Handles persistence of KeywordAccessState objects using ONE.core channel storage
 *
 * Implements composite key pattern: keywordTerm + principalId for uniqueness
 *
 * Note: KeywordAccessState objects are stored in channels like other ONE.core objects.
 * They should be posted to a dedicated access-control channel or the main topic channel.
 */

import type { KeywordAccessState, AccessStateValue, PrincipalType } from '../recipes/KeywordAccessState.js';

// Storage channel ID for access control objects
const ACCESS_CONTROL_CHANNEL = 'keyword-access-control';

/**
 * Create a new access state for a keyword and principal
 * Posts the access state to the access control channel via ChannelManager
 * Throws if keyword or principal is invalid
 *
 * @param channelManager - ChannelManager instance
 * @param keywordTerm - The keyword term
 * @param principalId - User or group ID (SHA256Hash)
 * @param principalType - 'user' or 'group'
 * @param state - 'allow', 'deny', or 'none'
 * @param updatedBy - User who made the change (SHA256Hash)
 * @returns Hash of the created object
 */
export async function createAccessState(
    channelManager: any,
    keywordTerm: string,
    principalId: string,
    principalType: PrincipalType,
    state: AccessStateValue,
    updatedBy: string
): Promise<string> {
    if (!channelManager) {
        throw new Error('channelManager is required');
    }

    if (!keywordTerm || typeof keywordTerm !== 'string') {
        throw new Error('keywordTerm is required and must be a string');
    }

    if (!principalId || typeof principalId !== 'string') {
        throw new Error('principalId is required and must be a string');
    }

    if (!principalType || !['user', 'group'].includes(principalType)) {
        throw new Error('principalType must be "user" or "group"');
    }

    if (!state || !['allow', 'deny', 'none'].includes(state)) {
        throw new Error('state must be "allow", "deny", or "none"');
    }

    if (!updatedBy || typeof updatedBy !== 'string') {
        throw new Error('updatedBy is required and must be a string');
    }

    // Normalize keyword term
    const normalizedTerm = keywordTerm.toLowerCase().trim();

    const accessState: KeywordAccessState = {
        $type$: 'KeywordAccessState',
        keywordTerm: normalizedTerm,
        principalId,
        principalType,
        state,
        updatedAt: new Date().toISOString(),
        updatedBy
    };

    // Post to access control channel
    const hash = await channelManager.postToChannel(ACCESS_CONTROL_CHANNEL, accessState);

    console.log(`[KeywordAccessStorage] Created access state for keyword "${normalizedTerm}" and principal ${principalId}`);

    return hash;
}

/**
 * Update an existing access state (upsert pattern)
 * If access state exists for the keyword+principal combo, update it
 * Otherwise, create a new one
 *
 * @param channelManager - ChannelManager instance
 * @param keywordTerm - The keyword term
 * @param principalId - User or group ID (SHA256Hash)
 * @param principalType - 'user' or 'group'
 * @param state - 'allow', 'deny', or 'none'
 * @param updatedBy - User who made the change (SHA256Hash)
 * @returns Object with hash and created flag
 */
export async function updateAccessState(
    channelManager: any,
    keywordTerm: string,
    principalId: string,
    principalType: PrincipalType,
    state: AccessStateValue,
    updatedBy: string
): Promise<{ hash: string; created: boolean }> {
    // Normalize keyword term
    const normalizedTerm = keywordTerm.toLowerCase().trim();

    // Find existing access state
    const existing = await getAccessStateByPrincipal(channelManager, normalizedTerm, principalId);

    // Always create a new version (ONE.core objects are immutable)
    const hash = await createAccessState(channelManager, normalizedTerm, principalId, principalType, state, updatedBy);

    const created = !existing;

    console.log(`[KeywordAccessStorage] ${created ? 'Created' : 'Updated'} access state for keyword "${normalizedTerm}" and principal ${principalId}`);

    return { hash, created };
}

/**
 * Get all access states for a specific keyword
 * Queries the access control channel for KeywordAccessState objects
 *
 * @param channelManager - ChannelManager instance
 * @param keywordTerm - The keyword term to filter by
 * @returns Array of access states for the keyword
 */
export async function getAccessStatesByKeyword(
    channelManager: any,
    keywordTerm: string
): Promise<KeywordAccessState[]> {
    if (!channelManager) {
        throw new Error('channelManager is required');
    }

    if (!keywordTerm || typeof keywordTerm !== 'string') {
        throw new Error('keywordTerm is required and must be a string');
    }

    const normalizedTerm = keywordTerm.toLowerCase().trim();

    try {
        // Get channel infos for access control channel
        const channelInfos = await channelManager.getMatchingChannelInfos({
            channelId: ACCESS_CONTROL_CHANNEL
        });

        if (!channelInfos || channelInfos.length === 0) {
            console.log('[KeywordAccessStorage] No access control channel found, returning empty array');
            return [];
        }

        // Iterate through all objects in the channel
        const accessStates: KeywordAccessState[] = [];

        for await (const entry of channelManager.multiChannelObjectIterator(channelInfos)) {
            if (
                entry.data &&
                entry.data.$type$ === 'KeywordAccessState' &&
                entry.data.keywordTerm === normalizedTerm
            ) {
                accessStates.push(entry.data as KeywordAccessState);
            }
        }

        console.log(`[KeywordAccessStorage] Retrieved ${accessStates.length} access states for keyword "${normalizedTerm}"`);

        return accessStates;
    } catch (error) {
        console.error('[KeywordAccessStorage] Error retrieving access states:', error);
        throw error;
    }
}

/**
 * Get access state for a specific keyword and principal (composite key lookup)
 *
 * @param channelManager - ChannelManager instance
 * @param keywordTerm - The keyword term
 * @param principalId - User or group ID (SHA256Hash)
 * @returns Access state object or null if not found
 */
export async function getAccessStateByPrincipal(
    channelManager: any,
    keywordTerm: string,
    principalId: string
): Promise<KeywordAccessState | null> {
    if (!channelManager) {
        throw new Error('channelManager is required');
    }

    if (!keywordTerm || typeof keywordTerm !== 'string') {
        throw new Error('keywordTerm is required and must be a string');
    }

    if (!principalId || typeof principalId !== 'string') {
        throw new Error('principalId is required and must be a string');
    }

    const normalizedTerm = keywordTerm.toLowerCase().trim();

    // Get all access states for this keyword
    const allStates = await getAccessStatesByKeyword(channelManager, normalizedTerm);

    // Find by principal ID
    const found = allStates.find((state: KeywordAccessState) =>
        state.principalId === principalId
    );

    if (found) {
        console.log(`[KeywordAccessStorage] Found access state for keyword "${normalizedTerm}" and principal ${principalId}`);
    }

    return found || null;
}

/**
 * Delete an access state for a keyword and principal
 * Note: ONE.core objects are immutable, so we create a new version with state='none'
 *
 * @param channelManager - ChannelManager instance
 * @param keywordTerm - The keyword term
 * @param principalId - User or group ID (SHA256Hash)
 * @param deletedBy - User who deleted the state (SHA256Hash)
 * @returns true if deleted, false if not found
 */
export async function deleteAccessState(
    channelManager: any,
    keywordTerm: string,
    principalId: string,
    deletedBy: string
): Promise<boolean> {
    if (!channelManager) {
        throw new Error('channelManager is required');
    }

    if (!keywordTerm || typeof keywordTerm !== 'string') {
        throw new Error('keywordTerm is required and must be a string');
    }

    if (!principalId || typeof principalId !== 'string') {
        throw new Error('principalId is required and must be a string');
    }

    const normalizedTerm = keywordTerm.toLowerCase().trim();

    // Find existing state
    const existing = await getAccessStateByPrincipal(channelManager, normalizedTerm, principalId);

    if (!existing) {
        console.log(`[KeywordAccessStorage] No access state found to delete for keyword "${normalizedTerm}" and principal ${principalId}`);
        return false;
    }

    // Mark as deleted by setting state to 'none'
    const updated: KeywordAccessState = {
        ...existing,
        state: 'none',
        updatedAt: new Date().toISOString(),
        updatedBy: deletedBy
    };

    // Post updated state to channel
    await channelManager.postToChannel(ACCESS_CONTROL_CHANNEL, updated);

    console.log(`[KeywordAccessStorage] Deleted (set to 'none') access state for keyword "${normalizedTerm}" and principal ${principalId}`);

    return true;
}

/**
 * Get all access states (for admin/debugging)
 *
 * @param channelManager - ChannelManager instance
 * @returns Array of all access states
 */
export async function getAllAccessStates(channelManager: any): Promise<KeywordAccessState[]> {
    if (!channelManager) {
        throw new Error('channelManager is required');
    }

    try {
        // Get channel infos for access control channel
        const channelInfos = await channelManager.getMatchingChannelInfos({
            channelId: ACCESS_CONTROL_CHANNEL
        });

        if (!channelInfos || channelInfos.length === 0) {
            console.log('[KeywordAccessStorage] No access control channel found');
            return [];
        }

        // Iterate through all objects in the channel
        const accessStates: KeywordAccessState[] = [];

        for await (const entry of channelManager.multiChannelObjectIterator(channelInfos)) {
            if (entry.data && entry.data.$type$ === 'KeywordAccessState') {
                accessStates.push(entry.data as KeywordAccessState);
            }
        }

        console.log(`[KeywordAccessStorage] Retrieved ${accessStates.length} total access states`);
        return accessStates;
    } catch (error) {
        console.error('[KeywordAccessStorage] Error retrieving all access states:', error);
        throw error;
    }
}
