// packages/lama.core/modules/JournalModule.ts
import type { Module } from '@refinio/api';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';

// Plan system imports
import { StoryFactory } from '@refinio/api/plan-system';
import { AssemblyPlan, AssemblyListener, JournalPlan, AssemblyDimension } from '@assembly/core';
import type { Assembly, Story, Plan } from '@assembly/core';
import type { SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
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
    { targetType: 'LeuteModel', required: true },
    { targetType: 'StoryFactory', required: true }
  ];

  static supplies = [
    { targetType: 'AssemblyPlan' },
    { targetType: 'AssemblyListener' },
    { targetType: 'AssemblyDimension' },
    { targetType: 'JournalPlan' }
  ];

  private deps: {
    oneCore?: any;
    leuteModel?: LeuteModel;
    storyFactory?: StoryFactory;
  } = {};

  // Journal components
  public storyFactory!: StoryFactory;
  public assemblyPlan!: AssemblyPlan;
  public assemblyListener!: AssemblyListener;
  public journalPlan!: JournalPlan;
  public assemblyDimension!: AssemblyDimension;

  // In-memory cache of Assembly idHashes
  private assemblyCache: Set<string> = new Set();

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('JournalModule missing required dependencies');
    }

    console.log('[JournalModule] Initializing journal module...');

    const { oneCore, leuteModel, storyFactory } = this.deps;

    // Use the demanded StoryFactory from ModuleRegistry
    if (!storyFactory) {
      throw new Error('JournalModule requires StoryFactory');
    }
    this.storyFactory = storyFactory;
    console.log('[JournalModule] Using StoryFactory from ModuleRegistry');

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

    // Initialize AssemblyPlan for audit trail
    this.assemblyPlan = new AssemblyPlan({
      oneCore: oneCore!,
      storeVersionedObject: storeVersionedObjectAdapter,
      getObjectByIdHash: getObjectByIdHashAdapter,
      getObject: getObjectAdapter
    });

    console.log('[JournalModule] ✅ AssemblyPlan initialized');

    // Create and initialize AssemblyDimension for indexed queries FIRST
    // (so it's available for AssemblyListener)
    this.assemblyDimension = new AssemblyDimension();
    await this.assemblyDimension.init();

    // Create AssemblyListener to connect StoryFactory to Assembly creation
    // Include assemblyDimension and getPlan so new Assemblies are indexed
    this.assemblyListener = new AssemblyListener({
      storyFactory: this.storyFactory,
      assemblyPlan: this.assemblyPlan,
      assemblyDimension: this.assemblyDimension,
      getPlan: getObjectByIdHashAdapter
    });

    // Initialize the listener to start listening to Story creation events
    this.assemblyListener.init();
    console.log('[JournalModule] ✅ AssemblyListener initialized and listening');

    // Load existing Assemblies from storage into the dimension
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

    // NOTE: AI Persons get their Assemblies created when AIModule creates them
    // via createAI() - the registerPlanInstance wrapping handles this automatically.
    // We don't call recordAIPersonAssemblies() here because:
    // 1. On first startup, AIModule hasn't run yet (runs later due to more dependencies)
    // 2. On restart, it would redundantly create Assemblies for existing AI persons

    // Create JournalPlan for journal queries using AssemblyDimension
    this.journalPlan = new JournalPlan({
      assemblyDimension: this.assemblyDimension
    });
    console.log('[JournalModule] ✅ JournalPlan created for journal queries');

    console.log('[JournalModule] ✅ Initialized');
  }

  /**
   * Load existing Assembly objects from ONE.core storage into the dimension
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
              // Load related Story and Plan for indexing
              const assembly = obj as Assembly;
              this.assemblyCache.add(idHash as string);

              try {
                // Load Story from assembly.storyRef
                const story = await getObjectByIdHashAdapter(assembly.storyRef) as Story;
                // Load Plan from story.plan
                const plan = await getObjectByIdHashAdapter(story.plan) as Plan;

                // Index into dimension with full data
                // Note: We use idHash as the key since we're iterating over id hashes
                // In practice, both idHash and hash are SHA256 strings
                this.assemblyDimension.indexAssembly(
                  idHash as unknown as SHA256Hash<Assembly>,
                  assembly,
                  story,
                  plan
                );
                assemblyCount++;
              } catch (loadError) {
                // Story or Plan might not exist yet - still add to cache
                console.warn(`[JournalModule] Could not load Story/Plan for Assembly ${(idHash as string).substring(0, 8)}...`);
              }
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

      // Create SomeonePlan and record the owner
      // SomeonePlan.recordExistingSomeone is idempotent - safe to call multiple times
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

    // Clear the assembly dimension
    if (this.assemblyDimension) {
      this.assemblyDimension.clear();
      console.log('[JournalModule] AssemblyDimension cleared');
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
    // StoryFactory is demanded from ModuleRegistry, not supplied here
    registry.supply('AssemblyPlan', this.assemblyPlan);
    registry.supply('AssemblyListener', this.assemblyListener);
    registry.supply('AssemblyDimension', this.assemblyDimension);
    registry.supply('JournalPlan', this.journalPlan);
  }

  private hasRequiredDeps(): boolean {
    return !!(
      this.deps.oneCore &&
      this.deps.leuteModel &&
      this.deps.storyFactory
    );
  }
}
