/**
 * InstancePlan - Records instance lifecycle events with Story/Assembly tracking
 *
 * Called after ModuleRegistry.initAll() to create retroactive Assemblies for
 * Instance and Owner that were created before StoryFactory existed.
 *
 * Creates TWO Stories (and thus TWO Assemblies via AssemblyListener):
 * 1. Instance Story - product = instanceId → Assembly for Instance
 * 2. Owner Story - product = ownerId → Assembly for Owner
 */
import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, Instance, OneObjectTypes } from '@refinio/one.core/lib/recipes.js';
import type { StoryFactory, ExecutionMetadata, ExecutionResult, OperationResult, Plan } from '@refinio/api/plan-system';

export interface InstancePlanDependencies {
  storyFactory: StoryFactory;
  ownerId: SHA256IdHash<Person>;
  instanceId: SHA256IdHash<Instance>;
  instanceName: string;
}

/**
 * InstancePlan - Records instance lifecycle events for journal visibility
 */
export class InstancePlan {
  static readonly PLAN_ID = 'OneInstancePlan';
  static readonly PLAN_NAME = 'Instance';
  static readonly PLAN_DESCRIPTION = 'Records instance lifecycle events for journal visibility';
  static readonly PLAN_DOMAIN = 'instance';

  private storyFactory: StoryFactory;
  private ownerId: SHA256IdHash<Person>;
  private instanceId: SHA256IdHash<Instance>;
  private instanceName: string;
  private planIdHash: SHA256IdHash<Plan> | null = null;

  constructor(deps: InstancePlanDependencies) {
    this.storyFactory = deps.storyFactory;
    this.ownerId = deps.ownerId;
    this.instanceId = deps.instanceId;
    this.instanceName = deps.instanceName;
  }

  /**
   * Initialize the plan by registering it with StoryFactory
   */
  async init(): Promise<void> {
    this.planIdHash = await this.storyFactory.registerPlan({
      id: InstancePlan.PLAN_ID,
      name: InstancePlan.PLAN_NAME,
      description: InstancePlan.PLAN_DESCRIPTION,
      domain: InstancePlan.PLAN_DOMAIN,
      demandPatterns: [{ keywords: ['instance', 'initialization', 'setup'] }],
      supplyPatterns: [{ keywords: ['instance', 'ready', 'initialized'] }]
    });
    console.log(`[InstancePlan] Registered Plan with hash: ${String(this.planIdHash).substring(0, 8)}...`);
  }

  /**
   * Record instance creation - creates TWO Stories/Assemblies
   * 1. Instance Assembly (entity = instanceId)
   * 2. Owner Assembly (entity = ownerId)
   */
  async recordInstanceCreation(): Promise<{
    instanceStoryId?: SHA256IdHash<any>;
    ownerStoryId?: SHA256IdHash<any>;
  }> {
    console.log(`[InstancePlan] Recording instance creation: ${this.instanceName}`);

    if (!this.planIdHash) {
      console.warn('[InstancePlan] Plan not initialized - call init() first');
      return {};
    }

    const instanceVersion = `v1-${Date.now()}`;

    // Story 1: Instance creation (product = instanceId)
    const instanceMetadata: ExecutionMetadata = {
      title: `Instance "${this.instanceName}" created - Initialize and register with journal`,
      planId: this.planIdHash,
      planTypeName: InstancePlan.PLAN_ID,
      owner: this.ownerId,
      instanceVersion
    };

    console.log(`[InstancePlan] Creating Instance Story with entity: ${this.instanceId.toString().substring(0, 8)}...`);
    const instanceResult = await this.storyFactory.wrapExecution(
      instanceMetadata,
      async (): Promise<OperationResult<{ success: boolean }>> => {
        return {
          result: { success: true },
          productHash: this.instanceId as unknown as SHA256Hash<OneObjectTypes>
        };
      }
    );

    console.log(`[InstancePlan] ✅ Created Instance Story: ${instanceResult.storyId?.toString().substring(0, 8)}...`);

    // Story 2: Owner initialization (product = ownerId)
    const ownerMetadata: ExecutionMetadata = {
      title: `Owner initialized for "${this.instanceName}" - Set up owner identity`,
      planId: this.planIdHash,
      planTypeName: InstancePlan.PLAN_ID,
      owner: this.ownerId,
      instanceVersion
    };

    console.log(`[InstancePlan] Creating Owner Story with entity: ${this.ownerId.toString().substring(0, 8)}...`);
    const ownerResult = await this.storyFactory.wrapExecution(
      ownerMetadata,
      async (): Promise<OperationResult<{ success: boolean }>> => {
        return {
          result: { success: true },
          productHash: this.ownerId as unknown as SHA256Hash<OneObjectTypes>
        };
      }
    );

    console.log(`[InstancePlan] ✅ Created Owner Story: ${ownerResult.storyId?.toString().substring(0, 8)}...`);

    return {
      instanceStoryId: instanceResult.storyId,
      ownerStoryId: ownerResult.storyId
    };
  }
}
