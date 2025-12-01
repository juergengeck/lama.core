// packages/lama.core/modules/JournalModule.ts
import type { Module } from '@refinio/api';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';

// Plan system imports
import { StoryFactory } from '@refinio/refinio.api/plan-system';
import { AssemblyPlan, AssemblyListener, JournalPlan } from '@assembly/core';
import { SomeonePlan } from '@contact/core';

// ONE.core storage imports
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { storeUnversionedObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import { listAllIdHashes } from '@refinio/one.core/lib/system/storage-base.js';

/**
 * JournalModule - Assembly-based audit trail and journal
 *
 * Provides:
 * - StoryFactory: Creates Story objects for operation tracking
 * - AssemblyPlan: Creates Assembly objects from Stories
 * - AssemblyListener: Connects StoryFactory to Assembly creation
 * - JournalPlan: Queries Assemblies for journal display
 *
 * Responsibilities:
 * - Load existing Assemblies from storage on startup
 * - Listen to Story creation events during runtime
 * - Record owner Someone as Assembly for journal visibility
 * - Provide getAllAssemblies() query for journal display
 */
export class JournalModule implements Module {
  readonly name = 'JournalModule';

  static demands = [
    { targetType: 'OneCore', required: true },
    { targetType: 'LeuteModel', required: true }
  ];

  static supplies = [
    { targetType: 'StoryFactory' },
    { targetType: 'AssemblyPlan' },
    { targetType: 'AssemblyListener' },
    { targetType: 'JournalPlan' }
  ];

  private deps: {
    oneCore?: any;
    leuteModel?: LeuteModel;
  } = {};

  // Journal components
  public storyFactory!: StoryFactory;
  public assemblyPlan!: AssemblyPlan;
  public assemblyListener!: AssemblyListener;
  public journalPlan!: JournalPlan;

  // In-memory cache of Assembly idHashes
  private assemblyCache: Set<string> = new Set();

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('JournalModule missing required dependencies');
    }

    console.log('[JournalModule] Initializing journal module...');

    const { oneCore, leuteModel } = this.deps;

    // Create adapters for ONE.core storage functions
    const storeVersionedObjectAdapter = async (obj: any) => {
      const result = await storeVersionedObject(obj);
      return {
        hash: result.hash,
        idHash: result.idHash,
        versionHash: result.hash // versionHash is the same as hash for versioned objects
      };
    };

    const getObjectByIdHashAdapter = async (idHash: any) => {
      const result = await getObjectByIdHash(idHash);
      return result.obj;
    };

    const getObjectAdapter = async (hash: any) => {
      const { getObject } = await import('@refinio/one.core/lib/storage-unversioned-objects.js');
      const result = await getObject(hash);
      return result;
    };

    const storeUnversionedObjectAdapter = async (obj: any) => {
      const result = await storeUnversionedObject(obj);
      return { hash: result.hash };
    };

    const calculateIdHashOfObjAdapter = async (obj: any) => {
      return await calculateIdHashOfObj(obj);
    };

    // Initialize AssemblyPlan + StoryFactory for audit trail
    this.assemblyPlan = new AssemblyPlan({
      oneCore: oneCore!,
      storeVersionedObject: storeVersionedObjectAdapter,
      getObjectByIdHash: getObjectByIdHashAdapter,
      getObject: getObjectAdapter
    });

    this.storyFactory = new StoryFactory(storeVersionedObjectAdapter);
    console.log('[JournalModule] ✅ AssemblyPlan + StoryFactory initialized');

    // Create AssemblyListener to connect StoryFactory to Assembly creation
    this.assemblyListener = new AssemblyListener({
      storyFactory: this.storyFactory,
      assemblyPlan: this.assemblyPlan
    });

    // Initialize the listener to start listening to Story creation events
    this.assemblyListener.init();
    console.log('[JournalModule] ✅ AssemblyListener initialized and listening');

    // Listen to Story creation to populate Assembly cache (for new Assemblies)
    this.storyFactory.onStoryCreated(async (story) => {
      // Story.product contains the Assembly idHash
      if (story.product) {
        this.assemblyCache.add(story.product as string);
        console.log(`[JournalModule] Added Assembly ${(story.product as string).substring(0, 8)}... to cache (total: ${this.assemblyCache.size})`);
      }
    });

    // Load existing Assemblies from storage (for Assemblies created in previous sessions)
    await this.loadExistingAssemblies(getObjectByIdHashAdapter);

    // Record owner Someone as Assembly if needed
    await this.recordOwnerAssembly(
      oneCore!,
      leuteModel!,
      this.storyFactory,
      getObjectByIdHashAdapter,
      storeVersionedObjectAdapter,
      storeUnversionedObjectAdapter,
      calculateIdHashOfObjAdapter
    );

    // Create JournalPlan for journal queries
    this.journalPlan = new JournalPlan({
      // getAllAssemblies: query all Assembly objects from the cache
      getAllAssemblies: async () => {
        const assemblies: any[] = [];

        console.log(`[JournalModule] getAllAssemblies: Loading ${this.assemblyCache.size} assemblies from cache`);

        // Load each Assembly object from storage using the cached idHashes
        for (const assemblyIdHash of this.assemblyCache) {
          try {
            const assembly = await getObjectByIdHashAdapter(assemblyIdHash as any);
            assemblies.push(assembly);
          } catch (error) {
            console.error(`[JournalModule] Failed to load Assembly ${assemblyIdHash.substring(0, 8)}...:`, error);
            // Skip assemblies that can't be loaded (they may have been deleted)
          }
        }

        console.log(`[JournalModule] getAllAssemblies: Successfully loaded ${assemblies.length} assemblies`);
        return assemblies;
      },
      // getStory: retrieve Story by ID hash
      getStory: async (idHash) => {
        return await getObjectByIdHashAdapter(idHash) as any;
      }
    });
    console.log('[JournalModule] ✅ JournalPlan created for journal queries');

    console.log('[JournalModule] ✅ Initialized');
  }

  /**
   * Load existing Assembly objects from ONE.core storage into the cache
   * This is called on startup to restore Assemblies created in previous sessions
   */
  private async loadExistingAssemblies(
    getObjectByIdHashAdapter: (idHash: any) => Promise<any>
  ): Promise<void> {
    console.log('[JournalModule] Loading existing Assemblies from storage...');

    try {
      const allIdHashes = await listAllIdHashes();
      console.log(`[JournalModule] Found ${allIdHashes.length} versioned objects in storage`);

      let assemblyCount = 0;
      const typesSeen = new Set<string>();
      for (const idHash of allIdHashes) {
        try {
          const obj = await getObjectByIdHashAdapter(idHash);
          if (obj && obj.$type$) {
            typesSeen.add(obj.$type$);
            if (obj.$type$ === 'Assembly') {
              this.assemblyCache.add(idHash as string);
              assemblyCount++;
            }
          }
        } catch (error) {
          // Skip objects that can't be loaded (might be corrupted or deleted)
          // This is expected for some edge cases
        }
      }
      console.log(`[JournalModule] Object types found in storage: ${Array.from(typesSeen).join(', ')}`);

      console.log(`[JournalModule] Loaded ${assemblyCount} existing Assemblies into cache`);
    } catch (error) {
      console.error('[JournalModule] Failed to load existing Assemblies:', error);
      // Don't throw - allow app to continue even if loading fails
    }
  }

  /**
   * Record the owner Someone as an Assembly if it doesn't have one yet
   * This ensures the owner appears in the journal after app startup
   */
  private async recordOwnerAssembly(
    nodeOneCore: any,
    leuteModel: LeuteModel,
    factory: StoryFactory,
    getObjectByIdHashAdapter: (idHash: any) => Promise<any>,
    storeVersionedObjectAdapter: (obj: any) => Promise<any>,
    storeUnversionedObjectAdapter: (obj: any) => Promise<any>,
    calculateIdHashOfObjAdapter: (obj: any) => Promise<any>
  ): Promise<void> {
    console.log('[JournalModule] Checking if owner needs Assembly...');

    try {
      // Get the owner from leuteModel
      if (!leuteModel) {
        console.warn('[JournalModule] LeuteModel not available, skipping owner Assembly');
        return;
      }

      const me = await leuteModel.me();
      if (!me) {
        console.warn('[JournalModule] Owner Someone not found, skipping owner Assembly');
        return;
      }

      const ownerIdHash = me.idHash;
      const personId = await leuteModel.myMainIdentity();

      // Check if an Assembly already exists for the owner
      // Look through the cache for an Assembly with domain 'identity' and ownerId matching
      let hasOwnerAssembly = false;
      for (const assemblyIdHash of this.assemblyCache) {
        try {
          const assembly = await getObjectByIdHashAdapter(assemblyIdHash as any);
          if (assembly && assembly.supply && assembly.supply.domain === 'identity') {
            // Found an identity Assembly - owner already has one
            hasOwnerAssembly = true;
            console.log(`[JournalModule] Owner already has Assembly ${assemblyIdHash.substring(0, 8)}...`);
            break;
          }
        } catch (error) {
          // Skip assemblies that can't be loaded
        }
      }

      if (hasOwnerAssembly) {
        console.log('[JournalModule] Owner Assembly exists, no action needed');
        return;
      }

      // Create SomeonePlan and record the owner
      console.log('[JournalModule] Creating Assembly for owner Someone...');

      const plan = new SomeonePlan({
        storeVersionedObject: storeVersionedObjectAdapter,
        storeUnversionedObject: storeUnversionedObjectAdapter,
        calculateIdHashOfObj: calculateIdHashOfObjAdapter
      });

      // Register the Plan and wait for it to complete (async)
      await plan.setStoryFactory(factory);

      // Get display name if available
      let displayName: string | undefined;
      try {
        displayName = await me.getMainProfileDisplayName();
        if (displayName === 'undefined') displayName = undefined;
      } catch (e) {
        // Ignore errors getting display name
      }

      const result = await plan.recordExistingSomeone(
        ownerIdHash,
        personId,
        displayName
      );

      if (result.assemblyId) {
        this.assemblyCache.add(result.assemblyId as string);
        console.log(`[JournalModule] ✅ Created owner Assembly ${result.assemblyId.toString().substring(0, 8)}...`);
      }
    } catch (error) {
      console.error('[JournalModule] Failed to record owner Assembly:', error);
      // Don't throw - this is optional functionality
    }
  }

  async shutdown(): Promise<void> {
    console.log('[JournalModule] Shutting down...');

    // Cleanup AssemblyListener
    if (this.assemblyListener) {
      this.assemblyListener.destroy();
      console.log('[JournalModule] AssemblyListener destroyed');
    }

    // Clear the assembly cache
    this.assemblyCache.clear();
    console.log('[JournalModule] Assembly cache cleared');

    console.log('[JournalModule] Shutdown complete');
  }

  setDependency(targetType: string, instance: any): void {
    const key = targetType.charAt(0).toLowerCase() + targetType.slice(1);
    this.deps[key as keyof typeof this.deps] = instance;
  }

  emitSupplies(registry: any): void {
    registry.supply('StoryFactory', this.storyFactory);
    registry.supply('AssemblyPlan', this.assemblyPlan);
    registry.supply('AssemblyListener', this.assemblyListener);
    registry.supply('JournalPlan', this.journalPlan);
  }

  private hasRequiredDeps(): boolean {
    return !!(
      this.deps.oneCore &&
      this.deps.leuteModel
    );
  }
}
