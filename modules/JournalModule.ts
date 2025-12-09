// packages/lama.core/modules/JournalModule.ts
/**
 * JournalModule - Persisted index for Assembly queries
 *
 * Persists AssemblyDimension index via cube.core DimensionStateManager.
 *
 * Responsibilities:
 * - Listen to Story creation events and index new Assemblies
 * - Provide query interface via JournalPlan
 * - Persist/load AssemblyDimension state via DimensionStateManager
 */
import type { Module } from '@refinio/api';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type { SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';

// Plan system imports
import { StoryFactory } from '@refinio/api/plan-system';
import { AssemblyPlan, AssemblyListener, JournalPlan, AssemblyDimension } from '@assembly/core';

// cube.core imports for dimension persistence
import { DimensionStateManager } from '@cube/core';
import type { DimensionState, DimensionStateStorage } from '@cube/core';

// ONE.core storage imports
import { storeVersionedObject, getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { storeUnversionedObject, getObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

/**
 * JournalModule - Persisted index for Assembly queries
 *
 * Supplies: AssemblyPlan, AssemblyListener, AssemblyDimension, JournalPlan
 * Demands: OneCore, LeuteModel, StoryFactory
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

  // Dimension persistence
  private dimensionStateManager!: DimensionStateManager;
  private lastSavedHash: SHA256Hash<DimensionState> | null = null;

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
      const result = await getObject(hash);
      return result;
    };

    // Initialize AssemblyPlan for audit trail
    this.assemblyPlan = new AssemblyPlan({
      oneCore: oneCore!,
      storeVersionedObject: storeVersionedObjectAdapter,
      getObjectByIdHash: getObjectByIdHashAdapter,
      getObject: getObjectAdapter
    });

    console.log('[JournalModule] AssemblyPlan initialized');

    // Create and initialize AssemblyDimension for indexed queries
    this.assemblyDimension = new AssemblyDimension();
    await this.assemblyDimension.init();

    // Initialize DimensionStateManager for persistence
    this.dimensionStateManager = new DimensionStateManager();

    const dimensionStorage: DimensionStateStorage = {
      storeUnversionedObject: async (obj: DimensionState) => {
        // Cast through any - DimensionState recipe registered via cube.core
        const result = await storeUnversionedObject(obj as any);
        return { hash: result.hash as unknown as SHA256Hash<DimensionState> };
      },
      getObject: async (hash: SHA256Hash<DimensionState>) => {
        // Cast through any - DimensionState recipe registered via cube.core
        return await getObject(hash as any) as DimensionState;
      },
      // Additional functions for reference persistence (enables automatic state loading)
      storeVersionedObject: async (obj: any) => {
        const result = await storeVersionedObject(obj);
        return { idHash: result.idHash, hash: result.hash };
      },
      getObjectByIdHash: async (idHash: any) => {
        const result = await getObjectByIdHash(idHash);
        return { obj: result.obj as any };
      },
      calculateIdHashOfObj: async (obj: any) => {
        return await calculateIdHashOfObj(obj);
      }
    };

    await this.dimensionStateManager.init(dimensionStorage);
    this.dimensionStateManager.registerDimension(this.assemblyDimension);

    // Load saved state from previous session (if any)
    const loaded = await this.dimensionStateManager.loadLatest('assembly');
    if (loaded) {
      const stats = this.assemblyDimension.getStats?.();
      console.log(`[JournalModule] Restored AssemblyDimension state: ${stats?.totalAssemblies || 0} assemblies`);
    } else {
      console.log('[JournalModule] No previous AssemblyDimension state found (first run or no data)');
    }

    console.log('[JournalModule] AssemblyDimension and DimensionStateManager initialized');

    // Create AssemblyListener to connect StoryFactory to Assembly creation
    // Include assemblyDimension and getPlan so new Assemblies are indexed
    // onIndexed triggers persistence immediately when assemblies are indexed
    this.assemblyListener = new AssemblyListener({
      storyFactory: this.storyFactory,
      assemblyPlan: this.assemblyPlan,
      assemblyDimension: this.assemblyDimension,
      getPlan: getObjectByIdHashAdapter,
      onIndexed: async () => {
        await this.dimensionStateManager.saveAndPersistRef('assembly');
      }
    });

    // Initialize the listener to start listening to Story creation events
    this.assemblyListener.init();
    console.log('[JournalModule] AssemblyListener initialized and listening');

    // Create JournalPlan for journal queries using AssemblyDimension
    this.journalPlan = new JournalPlan({
      assemblyDimension: this.assemblyDimension
    });
    console.log('[JournalModule] JournalPlan created for journal queries');

    console.log('[JournalModule] Initialized');
  }

  /**
   * Save the current AssemblyDimension state
   * Call this periodically or after indexing new assemblies
   */
  async saveState(): Promise<SHA256Hash<DimensionState> | null> {
    const hash = await this.dimensionStateManager.save('assembly');
    if (hash) {
      this.lastSavedHash = hash;
      console.log(`[JournalModule] Saved dimension state: ${hash}`);
    }
    return hash;
  }

  /**
   * Load AssemblyDimension state from a previous hash
   */
  async loadState(hash: SHA256Hash<DimensionState>): Promise<boolean> {
    const success = await this.dimensionStateManager.load('assembly', hash);
    if (success) {
      this.lastSavedHash = hash;
      console.log(`[JournalModule] Loaded dimension state: ${hash}`);
    }
    return success;
  }

  /**
   * Get the last saved state hash
   */
  getLastSavedHash(): SHA256Hash<DimensionState> | null {
    return this.lastSavedHash;
  }

  async shutdown(): Promise<void> {
    console.log('[JournalModule] Shutting down...');

    // Save state and persist reference before shutdown
    const stats = this.assemblyDimension?.getStats?.();
    console.log(`[JournalModule] Saving state with ${stats?.totalAssemblies || 0} assemblies...`);
    await this.dimensionStateManager?.saveAndPersistRef?.('assembly');

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
