/**
 * Contacts Handler (Pure Business Logic)
 *
 * Transport-agnostic handler for contact management operations.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Pattern based on refinio.api handler architecture.
 */

export interface Contact {
  id: string;
  personId: string;
  name: string;
  isAI: boolean;
  modelId?: string;
  canMessage: boolean;
  isConnected: boolean;
}

export interface ContactWithTrust extends Contact {
  trustLevel: string;
  canSync: boolean;
  discoverySource: string;
  discoveredAt: number;
}

export interface GetContactsResponse {
  success: boolean;
  contacts?: Contact[];
  error?: string;
}

export interface GetContactsWithTrustResponse {
  success: boolean;
  contacts?: ContactWithTrust[];
  error?: string;
}

/**
 * ContactsHandler - Pure business logic for contact operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - nodeOneCore: Platform-specific ONE.core instance
 */
export class ContactsHandler {
  private nodeOneCore: any;

  constructor(nodeOneCore: any) {
    this.nodeOneCore = nodeOneCore;
  }

  /**
   * Get all contacts
   */
  async getContacts(): Promise<GetContactsResponse> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      // Get human contacts - these are Someone objects that need to be transformed
      const someoneObjects = await this.nodeOneCore.leuteModel.others();
      const allContacts: Contact[] = [];

      // Track processed Person IDs to skip duplicates
      const processedPersonIds = new Set<string>();

      // Transform Someone objects to plain serializable objects
      for (const someone of someoneObjects) {
        try {
          const personId = await someone.mainIdentity();
          if (!personId) continue;

          // Skip if we've already processed this Person (duplicate Someone object)
          if (processedPersonIds.has(personId)) {
            continue;
          }
          processedPersonIds.add(personId);

          // Get profile to extract display name from PersonName
          const profile = await someone.mainProfile();
          let displayName: string | null = null;

          if (profile?.personDescriptions && Array.isArray(profile.personDescriptions)) {
            const nameDesc = profile.personDescriptions.find((d: any) => d.$type$ === 'PersonName');
            if (nameDesc && 'name' in nameDesc) {
              displayName = nameDesc.name;
            }
          }

          // If no PersonName found, throw error
          if (!displayName) {
            throw new Error(`No PersonName found for contact ${String(personId).substring(0, 8)}`);
          }

          // Check if this is an AI contact
          let isAI = false;
          let modelId: string | undefined;
          if (this.nodeOneCore.aiAssistantModel?.llmObjectManager) {
            isAI = this.nodeOneCore.aiAssistantModel.llmObjectManager.isLLMPerson(personId);

            // If this is an AI, get the model ID
            if (isAI && this.nodeOneCore.aiAssistantModel) {
              modelId = this.nodeOneCore.aiAssistantModel.getModelIdForPersonId(personId);
            }
          }

          allContacts.push({
            id: personId,
            personId: personId,
            name: displayName,
            isAI: isAI,
            modelId: modelId,
            canMessage: true,
            isConnected: isAI // AI is always "connected"
          });
        } catch (err: any) {
          console.error('[ContactsHandler] Error processing someone:', err);
        }
      }

      return {
        success: true,
        contacts: allContacts
      };
    } catch (error) {
      console.error('[ContactsHandler] Failed to get contacts:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get all contacts with trust information
   */
  async getContactsWithTrust(): Promise<GetContactsWithTrustResponse> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      const contacts = await this.nodeOneCore.leuteModel.others();

      // Enhance with trust information
      const contactsWithTrust: ContactWithTrust[] = await Promise.all(contacts.map(async (contact: any): Promise<ContactWithTrust> => {
        // Get trust level from trust manager
        const trustLevel = await this.nodeOneCore.quicTransport?.trustManager?.getContactTrustLevel(contact.personId) || 'unknown';

        // Check if connected via QUIC
        const isConnected = this.nodeOneCore.quicTransport?.peers?.has(contact.personId) || false;

        // Check communication permissions
        const canMessage = await this.nodeOneCore.quicTransport?.trustManager?.canCommunicateWith(contact.personId, 'message') || false;
        const canSync = await this.nodeOneCore.quicTransport?.trustManager?.canCommunicateWith(contact.personId, 'sync') || false;

        return {
          ...contact,
          id: contact.personId,
          name: contact.name || 'Unknown',
          isAI: false, // TODO: Check if AI
          canMessage,
          isConnected,
          trustLevel,
          canSync,
          discoverySource: 'quic-vc-discovery',
          discoveredAt: Date.now() - Math.random() * 86400000 // TODO: Get actual timestamp
        };
      }));

      return { success: true, contacts: contactsWithTrust };
    } catch (error) {
      console.error('[ContactsHandler] Failed to get contacts with trust:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get pending contacts (contacts awaiting acceptance)
   */
  async getPendingContacts(): Promise<{ success: boolean; pendingContacts?: any[]; error?: string }> {
    try {
      if (!this.nodeOneCore.quicTransport?.leuteModel) {
        return { success: true, pendingContacts: [] };
      }

      const pendingContacts = this.nodeOneCore.quicTransport.leuteModel.getPendingContacts();
      return { success: true, pendingContacts };
    } catch (error) {
      console.error('[ContactsHandler] Failed to get pending contacts:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get specific pending contact details
   */
  async getPendingContact(pendingId: string): Promise<{ success: boolean; pendingContact?: any; error?: string }> {
    try {
      if (!this.nodeOneCore.quicTransport?.leuteModel) {
        return { success: false, error: 'Contact manager not initialized' };
      }

      const pendingContact = this.nodeOneCore.quicTransport.leuteModel.getPendingContact(pendingId);
      if (!pendingContact) {
        return { success: false, error: 'Pending contact not found' };
      }

      return { success: true, pendingContact };
    } catch (error) {
      console.error('[ContactsHandler] Failed to get pending contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Accept a pending contact (update trust level)
   */
  async acceptContact(personId: string, options: any = {}): Promise<{ success: boolean; error?: string; [key: string]: any }> {
    try {
      if (!this.nodeOneCore.quicTransport?.trustManager) {
        return { success: false, error: 'Trust manager not initialized' };
      }

      const result = await this.nodeOneCore.quicTransport.trustManager.acceptContact(personId, options);
      return result;
    } catch (error) {
      console.error('[ContactsHandler] Failed to accept contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Block a contact
   */
  async blockContact(personId: string, reason: string): Promise<{ success: boolean; error?: string; [key: string]: any }> {
    try {
      if (!this.nodeOneCore.quicTransport?.trustManager) {
        return { success: false, error: 'Trust manager not initialized' };
      }

      const result = await this.nodeOneCore.quicTransport.trustManager.blockContact(personId, reason);
      return result;
    } catch (error) {
      console.error('[ContactsHandler] Failed to block contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Reject a pending contact
   */
  async rejectContact(pendingId: string, reason: string): Promise<{ success: boolean; error?: string; [key: string]: any }> {
    try {
      if (!this.nodeOneCore.quicTransport?.leuteModel) {
        return { success: false, error: 'Contact manager not initialized' };
      }

      const result = await this.nodeOneCore.quicTransport.leuteModel.rejectContact(pendingId, reason);
      return result;
    } catch (error) {
      console.error('[ContactsHandler] Failed to reject contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Add a new contact
   */
  async addContact(personInfo: { name: string; email: string }): Promise<{ success: boolean; contact?: any; error?: string }> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      // Create Person object
      const { storeVersionedObject } = await import('@refinio/one.core/lib/storage-versioned-objects.js');
      const person = {
        $type$: 'Person',
        name: personInfo.name,
        email: personInfo.email
      };

      const personResult = await storeVersionedObject(person as any);

      // Create Someone object and add to contacts
      const { default: SomeoneModel } = await import('@refinio/one.models/lib/models/Leute/SomeoneModel.js');
      const someone = await SomeoneModel.constructWithNewSomeone(personResult.idHash, person as any);

      await this.nodeOneCore.leuteModel.addSomeoneElse(someone.idHash);

      return {
        success: true,
        contact: {
          personHash: personResult.idHash,
          someoneHash: someone.idHash,
          person
        }
      };
    } catch (error) {
      console.error('[ContactsHandler] Failed to add contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Remove a contact
   */
  async removeContact(contactId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      await this.nodeOneCore.leuteModel.removeSomeoneElse(contactId as any);
      return { success: true };
    } catch (error) {
      console.error('[ContactsHandler] Failed to remove contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Revoke contact's VC
   */
  async revokeContactVC(personId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.nodeOneCore.quicTransport?.leuteModel) {
        return { success: false, error: 'Contact manager not initialized' };
      }

      await this.nodeOneCore.quicTransport.leuteModel.revokeContactVC(personId);
      return { success: true };
    } catch (error) {
      console.error('[ContactsHandler] Failed to revoke contact VC:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

}
