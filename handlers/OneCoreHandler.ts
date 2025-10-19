/**
 * ONE.core Handler (Pure Business Logic)
 *
 * Transport-agnostic handler for ONE.core operations.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Pattern based on refinio.api handler architecture.
 */

import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type { PersonDescriptionTypes } from '@refinio/one.models/lib/recipes/Leute/PersonDescriptions.js';
import type { CommunicationEndpointTypes } from '@refinio/one.models/lib/recipes/Leute/CommunicationEndpoints.js';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type { AvatarPreference } from '@OneObjectInterfaces';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';

// Type guards for ONE.core recipe union types
function isPersonName(obj: PersonDescriptionTypes): obj is Extract<PersonDescriptionTypes, { $type$: 'PersonName' }> {
  return obj.$type$ === 'PersonName';
}

function isEmail(obj: CommunicationEndpointTypes): obj is Extract<CommunicationEndpointTypes, { $type$: 'Email' }> {
  return obj.$type$ === 'Email';
}

// Request/Response types
export interface InitializeRequest {
  credentials: {
    email: string;
    password: string;
  };
}

export interface InitializeResponse {
  success: boolean;
  personId?: string;
  error?: string;
}

export interface GetContactsRequest {
  // No parameters needed
}

export interface Contact {
  id: string;
  personId: string;
  someoneId?: string;
  name: string;
  displayName: string;
  email: string;
  isAI: boolean;
  role: string;
  platform: string;
  status: string;
  isConnected: boolean;
  trusted: boolean;
  lastSeen: string;
  color: string;
}

export interface GetContactsResponse {
  success: boolean;
  contacts?: Contact[];
  error?: string;
}

// Avatar color generation
function generateAvatarColor(personId: string): string {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#14b8a6',
    '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e'
  ];

  let hash = 0;
  for (let i = 0; i < personId.length; i++) {
    hash = ((hash << 5) - hash) + personId.charCodeAt(i);
    hash = hash & hash;
  }

  return colors[Math.abs(hash) % colors.length];
}

function getMoodColor(mood: string): string {
  const moodColors: Record<string, string> = {
    'happy': '#f59e0b', 'sad': '#3b82f6', 'angry': '#ef4444',
    'calm': '#14b8a6', 'excited': '#ec4899', 'tired': '#8b5cf6',
    'focused': '#10b981', 'neutral': '#6366f1'
  };
  return moodColors[mood] || moodColors['neutral'];
}

async function getAvatarColor(personId: string): Promise<string> {
  try {
    const result = await getObjectByIdHash<AvatarPreference>(personId as any);
    if (result && result.obj) {
      const pref = result.obj;
      if (pref.mood) return getMoodColor(pref.mood);
      if (pref.color) return pref.color;
    }
  } catch (e) {
    // Preference doesn't exist, will create one
  }

  const color = generateAvatarColor(personId);
  const preference: AvatarPreference = {
    $type$: 'AvatarPreference',
    personId,
    color,
    updatedAt: Date.now()
  };

  try {
    await storeVersionedObject(preference);
  } catch (e) {
    console.warn('[OneCoreHandler] Failed to store avatar preference:', e);
  }

  return color;
}

// Additional Response types
export interface NodeStatusResponse {
  success: boolean;
  [key: string]: any;
}

export interface UpdateMoodRequest {
  mood: string;
}

export interface UpdateMoodResponse {
  success: boolean;
  data?: {
    mood: string;
    color: string;
  };
  error?: string;
}

export interface SetPersonNameRequest {
  name: string;
}

export interface SetPersonNameResponse {
  success: boolean;
  data?: {
    name: string;
  };
  error?: string;
}

export interface HasPersonNameResponse {
  success: boolean;
  hasName?: boolean;
  name?: string | null;
  error?: string;
}

/**
 * OneCoreHandler - Pure business logic for ONE.core operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - nodeOneCore: Platform-specific ONE.core instance
 * - stateManager: Optional state management (Electron only)
 * - chumSettings: Optional CHUM settings (Electron only)
 * - credentialsManager: Optional credentials manager (Electron only)
 */
export class OneCoreHandler {
  private nodeOneCore: any;
  private stateManager: any;
  private chumSettings: any;
  private credentialsManager: any;
  private leuteModel: LeuteModel | null = null;
  private channelManager: ChannelManager | null = null;
  private ownerId: SHA256IdHash<any> | null = null;
  private contactsCache: Contact[] | null = null;
  private contactsCacheTime = 0;
  private readonly CONTACTS_CACHE_TTL = 5000; // 5 seconds

  constructor(
    nodeOneCore: any,
    stateManager?: any,
    chumSettings?: any,
    credentialsManager?: any
  ) {
    this.nodeOneCore = nodeOneCore;
    this.stateManager = stateManager;
    this.chumSettings = chumSettings;
    this.credentialsManager = credentialsManager;

    // Set models if nodeOneCore is already initialized
    if (nodeOneCore?.leuteModel) {
      this.leuteModel = nodeOneCore.leuteModel;
    }
    if (nodeOneCore?.channelManager) {
      this.channelManager = nodeOneCore.channelManager;
    }
  }

  /**
   * Set models after initialization
   */
  setModels(leuteModel: LeuteModel, channelManager: ChannelManager, ownerId?: SHA256IdHash<any>): void {
    this.leuteModel = leuteModel;
    this.channelManager = channelManager;
    if (ownerId) {
      this.ownerId = ownerId;
    }
  }

  /**
   * Invalidate contacts cache
   */
  invalidateContactsCache(): void {
    this.contactsCache = null;
    this.contactsCacheTime = 0;
  }

  /**
   * Initialize Node.js ONE.core instance
   */
  // initializeNode is platform-specific and should be implemented in lama.electron
  // This is just a placeholder that throws an error
  async initializeNode(params: { user?: { name: string; password: string }; name?: string; password?: string }): Promise<{ success: boolean; data?: any; error?: string }> {
    throw new Error('initializeNode must be implemented by platform layer (lama.electron)');
  }

  /**
   * Get Node instance status
   */
  async getNodeStatus(): Promise<NodeStatusResponse> {
    const info = this.nodeOneCore.getInfo();
    return {
      success: true,
      ...info
    };
  }

  /**
   * Set Node instance configuration state
   */
  async setNodeState(params: { key: string; value: any }): Promise<{ success: boolean; error?: string }> {
    console.log(`[OneCoreHandler] Set Node state: ${params.key}`);

    try {
      await this.nodeOneCore.setState(params.key, params.value);
      return { success: true };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to set state:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get Node instance configuration state
   */
  async getNodeState(params: { key: string }): Promise<{ success: boolean; value?: any; error?: string }> {
    console.log(`[OneCoreHandler] Get Node state: ${params.key}`);

    try {
      const value = this.nodeOneCore.getState(params.key);
      return {
        success: true,
        value
      };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to get state:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get Node instance full configuration
   */
  async getNodeConfig(): Promise<{ success: boolean; config?: any; error?: string }> {
    console.log('[OneCoreHandler] Get Node configuration');

    try {
      const info = this.nodeOneCore.getInfo();
      return {
        success: true,
        config: info.config || {}
      };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to get config:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get contacts from ONE.core instance
   */
  async getContacts(request: GetContactsRequest): Promise<GetContactsResponse> {
    // Check cache first
    const now = Date.now();
    if (this.contactsCache && (now - this.contactsCacheTime) < this.CONTACTS_CACHE_TTL) {
      console.log('[OneCoreHandler] Returning cached contacts');
      return {
        success: true,
        contacts: this.contactsCache
      };
    }

    console.log('\n' + '='.repeat(60));
    console.log('[OneCoreHandler] 📋 GETTING CONTACTS - START');
    console.log('='.repeat(60));

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.leuteModel) {
        return {
          success: false,
          error: 'ONE.core not initialized',
          contacts: []
        };
      }

      const contacts: Contact[] = [];

      // Get owner ID
      let myId: string | null = null;
      try {
        const me = await this.nodeOneCore.leuteModel.me();
        myId = await me.mainIdentity();
      } catch (error) {
        console.warn('[OneCoreHandler] Error getting owner ID:', error);
      }

      // Get ALL contacts from LeuteModel.others()
      console.log('[OneCoreHandler] Step 1: Calling LeuteModel.others()...');
      const others = await this.nodeOneCore.leuteModel.others();
      console.log(`[OneCoreHandler] ✅ LeuteModel.others() returned ${others.length} contacts`);

      // Track processed personIds to avoid duplicates
      const processedPersonIds = new Set<string>();

      // Process contacts
      for (const someone of others) {
        try {
          const personId = await someone.mainIdentity();

          if (!personId || processedPersonIds.has(personId)) {
            continue;
          }
          processedPersonIds.add(personId);

          const profile = await someone.mainProfile();

          // Extract email
          let email: string | null = null;
          if ((someone as any).email) {
            email = (someone as any).email;
          } else if (profile?.communicationEndpoints?.length > 0) {
            const emailEndpoint = profile.communicationEndpoints.find(isEmail);
            if (emailEndpoint && 'email' in emailEndpoint) {
              email = emailEndpoint.email;
            }
          } else if (typeof (someone as any).mainEmail === 'function') {
            try {
              email = await (someone as any).mainEmail();
            } catch (e) {
              // mainEmail might not exist or fail
            }
          }

          // Check if AI contact
          let isAI = false;
          if (this.nodeOneCore.aiAssistantModel?.llmObjectManager) {
            isAI = this.nodeOneCore.aiAssistantModel.llmObjectManager.isLLMPerson(personId);
          }
          if (!isAI && email && email.endsWith('@ai.local')) {
            isAI = true;
          }

          // Get display name
          let displayName: string | null = null;
          if (profile) {
            try {
              const personNames = profile.descriptionsOfType('PersonName');
              if (personNames && personNames.length > 0) {
                displayName = personNames[0].name;
              }
            } catch (e: any) {
              console.log(`[OneCoreHandler] Error getting PersonName: ${e.message}`);
            }
          }

          // Extract name from AI email if needed
          if (displayName === 'Unknown Contact' && email && isAI) {
            const emailPrefix = email.split('@')[0];
            displayName = emailPrefix
              .replace(/lmstudio_/g, '')
              .replace(/ollama_/g, '')
              .replace(/claude_/g, '')
              .replace(/_/g, ' ')
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');

            if (email.includes('lmstudio')) {
              displayName += ' (LM Studio)';
            } else if (email.includes('ollama')) {
              displayName += ' (Ollama)';
            }
          }

          // Fallback display name
          if (!displayName) {
            displayName = personId ? `Contact ${String(personId).substring(0, 8)}` : 'Unknown Contact';
          }

          // Check if owner
          const isOwner = personId === myId;
          if (isOwner) {
            displayName += ' (You)';
          }

          // Get avatar color
          const color = await getAvatarColor(personId);

          contacts.push({
            id: personId,
            personId: personId,
            someoneId: someone.idHash,
            name: displayName,
            displayName: displayName,
            email: email || `${String(personId).substring(0, 8)}@lama.network`,
            isAI: isAI,
            role: isOwner ? 'owner' : 'contact',
            platform: isAI ? 'ai' : (isOwner ? 'nodejs' : 'external'),
            status: isOwner ? 'owner' : 'offline',
            isConnected: isOwner ? true : false,
            trusted: true,
            lastSeen: new Date().toISOString(),
            color
          });
        } catch (error) {
          console.warn('[OneCoreHandler] Error processing contact:', error);
        }
      }

      console.log('\n[OneCoreHandler] SUMMARY:');
      console.log(`[OneCoreHandler]   - Total from LeuteModel.others(): ${others.length}`);
      console.log(`[OneCoreHandler]   - After deduplication: ${contacts.length}`);
      console.log(`[OneCoreHandler]   - Owner: ${contacts.filter(c => c.role === 'owner').length}`);
      console.log(`[OneCoreHandler]   - AI contacts: ${contacts.filter(c => c.isAI).length}`);
      console.log(`[OneCoreHandler]   - Regular contacts: ${contacts.filter(c => !c.isAI && c.role !== 'owner').length}`);
      console.log('='.repeat(60) + '\n');

      // Update cache
      this.contactsCache = contacts;
      this.contactsCacheTime = now;

      return {
        success: true,
        contacts
      };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to get contacts:', error);
      return {
        success: false,
        error: (error as Error).message,
        contacts: []
      };
    }
  }

  /**
   * Get credentials status
   */
  async getCredentialsStatus(): Promise<{ success: boolean; ownCredentials?: number; trustedIssuers?: number; instanceId?: string; error?: string }> {
    if (!this.credentialsManager) {
      return { success: false, error: 'Credentials manager not available' };
    }

    console.log('[OneCoreHandler] Getting credentials status');

    try {
      const credentials = this.credentialsManager.getAllCredentials();
      return {
        success: true,
        ownCredentials: credentials.own.length,
        trustedIssuers: credentials.trusted.length,
        instanceId: this.credentialsManager.getOwnInstanceId()
      };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to get credentials status:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get shared credentials for browser IoM setup
   */
  async getBrowserCredentials(): Promise<{ success: boolean; error?: string; [key: string]: any }> {
    console.log('[OneCoreHandler] Getting credentials for browser IoM');

    try {
      const credentials = await this.nodeOneCore.getCredentialsForBrowser();
      return {
        success: true,
        ...credentials
      };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to get browser credentials:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get list of connected peers
   */
  async getPeerList(): Promise<{ success: boolean; peers?: any[]; error?: string }> {
    console.log('[OneCoreHandler] Getting peer list');

    try {
      const result = await this.getContacts({});

      if (result.success && result.contacts) {
        const peers = result.contacts.map((contact: Contact) => ({
          id: contact.id,
          personId: contact.personId,
          name: contact.name,
          displayName: contact.displayName,
          email: contact.email,
          isAI: contact.isAI,
          status: contact.status || 'offline',
          isConnected: contact.isConnected || false
        }));

        return {
          success: true,
          peers
        };
      }

      return result;
    } catch (error) {
      console.error('[OneCoreHandler] Failed to get peer list:', error);
      return {
        success: false,
        error: (error as Error).message,
        peers: []
      };
    }
  }

  /**
   * Clear storage
   *
   * NOTE: This method requires platform-specific clearAppDataShared function.
   * The platform adapter should inject the clearAppDataShared function.
   */
  async clearStorage(clearAppDataShared?: () => Promise<{ success: boolean; error?: string }>): Promise<{ success: boolean; error?: string }> {
    console.log('[OneCoreHandler] Clear storage request');

    // Check if we're in a browser/worker environment
    // @ts-ignore - WorkerGlobalScope is not available in all contexts
    const isBrowserWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
    const isBrowser = typeof window !== 'undefined' || isBrowserWorker;

    if (isBrowser) {
      // Browser platform uses storage:cleanup worker message instead
      console.log('[OneCoreHandler] clearStorage not available in browser - use storage:cleanup worker message');
      return {
        success: false,
        error: 'clearStorage is not available in browser platform. Use storage:cleanup worker message instead.'
      };
    }

    try {
      if (!clearAppDataShared) {
        throw new Error('clearAppDataShared function not provided');
      }

      const result = await clearAppDataShared();
      console.log('[OneCoreHandler] clearAppDataShared result:', result);
      return result;
    } catch (error) {
      console.error('[OneCoreHandler] Failed to clear storage:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Restart ONE.core instance
   */
  async restartNode(): Promise<{ success: boolean; data?: any; error?: string }> {
    console.log('[OneCoreHandler] Restarting ONE.core instance...');

    try {
      if (this.nodeOneCore.initialized) {
        console.log('[OneCoreHandler] Shutting down current instance...');
        await this.nodeOneCore.shutdown();
      }

      console.log('[OneCoreHandler] Instance shut down - UI must re-initialize');

      return {
        success: true,
        data: {
          message: 'Instance shut down - please re-login'
        }
      };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to restart instance:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Update user's mood
   */
  async updateMood(request: UpdateMoodRequest): Promise<UpdateMoodResponse> {
    console.log(`[OneCoreHandler] Update mood: ${request.mood}`);

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.leuteModel) {
        return {
          success: false,
          error: 'ONE.core not initialized'
        };
      }

      const me = await this.nodeOneCore.leuteModel.me();
      const personId = await me.mainIdentity();

      if (!personId) {
        return {
          success: false,
          error: 'Could not get user person ID'
        };
      }

      // Get existing preference or create new one
      let preference: AvatarPreference | null = null;
      try {
        const result = await getObjectByIdHash<AvatarPreference>(personId as any);
        if (result && result.obj) {
          preference = result.obj;
        }
      } catch (e) {
        // Preference doesn't exist
      }

      // Create updated preference
      const updatedPref: AvatarPreference = {
        $type$: 'AvatarPreference',
        personId,
        color: preference?.color || generateAvatarColor(personId),
        mood: request.mood as any,
        updatedAt: Date.now()
      };

      await storeVersionedObject(updatedPref);

      // Invalidate cache
      this.invalidateContactsCache();

      return {
        success: true,
        data: {
          mood: request.mood,
          color: getMoodColor(request.mood)
        }
      };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to update mood:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Check if user has PersonName set
   */
  async hasPersonName(): Promise<HasPersonNameResponse> {
    console.log('[OneCoreHandler] Checking if user has PersonName');

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.leuteModel) {
        return {
          success: false,
          error: 'ONE.core not initialized'
        };
      }

      const me = await this.nodeOneCore.leuteModel.me();
      const profile = await me.mainProfile();

      if (!profile) {
        return {
          success: true,
          hasName: false
        };
      }

      try {
        const personNames = profile.descriptionsOfType('PersonName');
        const hasName = personNames && personNames.length > 0 && personNames[0].name;

        return {
          success: true,
          hasName: !!hasName,
          name: hasName ? personNames[0].name : null
        };
      } catch (e) {
        return {
          success: true,
          hasName: false
        };
      }
    } catch (error) {
      console.error('[OneCoreHandler] Failed to check PersonName:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Set PersonName for user
   */
  async setPersonName(request: SetPersonNameRequest): Promise<SetPersonNameResponse> {
    console.log('[OneCoreHandler] Setting PersonName:', request.name);

    try {
      if (!this.nodeOneCore.initialized || !this.nodeOneCore.leuteModel) {
        return {
          success: false,
          error: 'ONE.core not initialized'
        };
      }

      if (!request.name || request.name.trim().length === 0) {
        return {
          success: false,
          error: 'Name cannot be empty'
        };
      }

      const me = await this.nodeOneCore.leuteModel.me();
      const personId = await me.mainIdentity();

      if (!personId) {
        return {
          success: false,
          error: 'Could not get user person ID'
        };
      }

      // Get or create profile
      let profile = await me.mainProfile();

      if (!profile) {
        const { default: ProfileModel } = await import('@refinio/one.models/lib/models/Leute/ProfileModel.js');
        profile = await ProfileModel.constructWithNewProfile(personId, personId, 'default');
        console.log('[OneCoreHandler] Created new profile for user');
      }

      // Create PersonName description
      const personName = {
        $type$: 'PersonName' as const,
        name: request.name.trim()
      };

      // Remove existing PersonName if present
      if (profile.personDescriptions) {
        profile.personDescriptions = profile.personDescriptions.filter(
          (desc: any) => desc.$type$ !== 'PersonName'
        );
      } else {
        profile.personDescriptions = [];
      }

      // Add new PersonName
      profile.personDescriptions.push(personName);

      // Save profile
      await profile.saveAndLoad();

      console.log('[OneCoreHandler] PersonName set successfully:', request.name);

      // Invalidate cache
      this.invalidateContactsCache();

      return {
        success: true,
        data: {
          name: request.name.trim()
        }
      };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to set PersonName:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Create local invite for browser connection
   */
  async createLocalInvite(options: any = {}): Promise<{ success: boolean; invite?: any; error?: string }> {
    console.log('[OneCoreHandler] Create local invite');
    try {
      const invite = await (this.nodeOneCore as any).createLocalInvite(options);
      return { success: true, invite };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to create local invite:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Create pairing invitation for browser instance
   */
  async createBrowserPairingInvite(): Promise<{ success: boolean; invitation?: any; error?: string }> {
    console.log('[OneCoreHandler] Create browser pairing invitation');
    try {
      const invitation = await (this.nodeOneCore as any).createBrowserPairingInvite();
      return { success: true, invitation };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to create browser pairing invite:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get stored browser pairing invitation
   */
  async getBrowserPairingInvite(): Promise<{ success: boolean; invitation?: any; error?: string }> {
    console.log('[OneCoreHandler] Get browser pairing invitation');

    if (!this.stateManager) {
      return {
        success: false,
        error: 'State manager not available'
      };
    }

    try {
      const browserInvite = this.stateManager.getState('browserInvite');

      if (!browserInvite) {
        return {
          success: false,
          error: 'No browser invitation available'
        };
      }

      const now = new Date();
      const expiresAt = new Date(browserInvite.expiresAt);

      if (now > expiresAt) {
        return {
          success: false,
          error: 'Browser invitation has expired'
        };
      }

      return {
        success: true,
        invitation: browserInvite.invitation
      };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to get browser pairing invite:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Create network invite for remote connections
   */
  async createNetworkInvite(options: any = {}): Promise<{ success: boolean; invite?: any; error?: string }> {
    console.log('[OneCoreHandler] Create network invite');
    try {
      const invite = await (this.nodeOneCore as any).createNetworkInvite(options);
      return { success: true, invite };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to create network invite:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * List all active invites
   */
  async listInvites(): Promise<{ success: boolean; invites?: any[]; error?: string }> {
    console.log('[OneCoreHandler] List invites');
    try {
      const invites = await (this.nodeOneCore as any).listInvites();
      return { success: true, invites };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to list invites:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Revoke an invite
   */
  async revokeInvite(inviteId: string): Promise<{ success: boolean; error?: string }> {
    console.log('[OneCoreHandler] Revoke invite:', inviteId);
    try {
      await (this.nodeOneCore as any).revokeInvite(inviteId);
      return { success: true };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to revoke invite:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Test settings replication with credentials
   */
  async testSettingsReplication(category: string, data: any): Promise<{ success: boolean; testResult?: any; error?: string }> {
    console.log(`[OneCoreHandler] Testing settings replication: ${category}`);

    if (!this.chumSettings) {
      return {
        success: false,
        error: 'CHUM settings not available'
      };
    }

    try {
      const result = await this.chumSettings.testSettingsValidation(category, data);
      return {
        success: true,
        testResult: result
      };
    } catch (error) {
      console.error('[OneCoreHandler] Settings replication test failed:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Sync connection settings to peers
   */
  async syncConnectionSettings(connectionSettings: any): Promise<{ success: boolean; settingsId?: string; replicatedAt?: number; error?: string }> {
    console.log('[OneCoreHandler] Syncing connection settings to peers');

    if (!this.chumSettings) {
      return {
        success: false,
        error: 'CHUM settings not available'
      };
    }

    try {
      const settingsObject = await this.chumSettings.syncConnectionSettings(connectionSettings);
      return {
        success: true,
        settingsId: settingsObject.id,
        replicatedAt: settingsObject.timestamp
      };
    } catch (error) {
      console.error('[OneCoreHandler] Failed to sync connection settings:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Store data securely using LLM objects
   *
   * NOTE: This method requires LLMConfigHandler dependency.
   * The Electron adapter should inject the llmConfigHandler instance.
   */
  async secureStore(key: string, value: any, encrypted: boolean = false, llmConfigHandler?: any): Promise<{ success: boolean; data?: any; error?: string }> {
    console.log(`[OneCoreHandler] Secure store: ${key} (encrypted: ${encrypted})`);
    console.log(`[OneCoreHandler] nodeOneCore initialized: ${this.nodeOneCore?.initialized}, channelManager: ${!!this.nodeOneCore?.channelManager}`);

    try {
      if (key === 'claude_api_key') {
        if (!this.nodeOneCore?.initialized || !this.nodeOneCore?.channelManager) {
          throw new Error('ONE.core not initialized');
        }

        if (!llmConfigHandler) {
          throw new Error('LLM config handler not provided');
        }

        console.log('[OneCoreHandler] Storing Claude API key via LLMConfigHandler...');
        const result = await llmConfigHandler.setConfig({
          modelType: 'remote',
          baseUrl: 'https://api.anthropic.com',
          authType: 'bearer',
          authToken: value,
          modelName: 'claude',
          setAsActive: true
        });

        console.log('[OneCoreHandler] LLMConfigHandler result:', result);

        if (!result.success) {
          throw new Error('error' in result ? result.error : 'Failed to store API key');
        }

        return {
          success: true,
          data: { stored: true, configHash: result.configHash }
        };
      }

      throw new Error(`Unsupported secure storage key: ${key}`);

    } catch (error) {
      console.error('[OneCoreHandler] secureStore error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Retrieve data from LLM objects
   *
   * NOTE: This method requires decryptToken function dependency.
   * The Electron adapter should inject the decryptToken function.
   */
  async secureRetrieve(key: string, decryptToken?: (encrypted: string) => string): Promise<{ success: boolean; value?: any; error?: string }> {
    console.log(`[OneCoreHandler] Secure retrieve: ${key}`);

    try {
      if (key === 'claude_api_key') {
        if (!this.nodeOneCore?.channelManager) {
          throw new Error('ONE.core not initialized');
        }

        if (!decryptToken) {
          throw new Error('Decrypt token function not provided');
        }

        const iterator = this.nodeOneCore.channelManager.objectIteratorWithType('LLM', {
          channelId: 'lama'
        });

        for await (const llmObj of iterator) {
          if (llmObj?.data?.name === 'claude' && llmObj.data.active && !llmObj.data.deleted) {
            const encrypted = (llmObj.data as any).encryptedAuthToken;
            if (encrypted) {
              const apiKey = decryptToken(encrypted);
              return { success: true, value: apiKey };
            }
          }
        }

        throw new Error('API key not found');
      }

      throw new Error(`Unsupported secure storage key: ${key}`);

    } catch (error) {
      console.error('[OneCoreHandler] secureRetrieve error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
}
