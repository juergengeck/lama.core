// packages/lama.browser/browser-ui/src/modules/TrustModule.ts
import type { Module } from '@refinio/api';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import { TrustModel } from '@trust/core/models/TrustModel.js';
import { TrustPlan } from '@trust/core/plans/TrustPlan.js';

/**
 * TrustModule - Trust and identity management
 *
 * Provides:
 * - TrustModel (identity subscriptions)
 * - TrustPlan (trust management operations)
 *
 * Implementation extracted from Model.ts (lines 432-435):
 * - TrustModel expects: (leuteModel, trustedKeysManager?)
 * - TrustPlan wraps TrustModel for RPC-style operations
 */
export class TrustModule implements Module {
  readonly name = 'TrustModule';

  static demands = [
    { targetType: 'LeuteModel', required: true }
  ];

  static supplies = [
    { targetType: 'TrustModel' },
    { targetType: 'TrustPlan' }
  ];

  private deps: {
    leuteModel?: LeuteModel;
  } = {};

  // Trust components
  public trustModel!: TrustModel;
  public trustPlan!: TrustPlan;

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('TrustModule missing required dependencies');
    }

    // Initialize TrustModel and TrustPlan for trust level tracking and chain of trust
    // TrustModel expects: (leuteModel, trustedKeysManager?)
    this.trustModel = new TrustModel(this.deps.leuteModel!, undefined);
    this.trustPlan = new TrustPlan(this.trustModel);

    console.log('[TrustModule] Initialized');
  }

  async shutdown(): Promise<void> {
    await this.trustPlan?.shutdown?.();
    await this.trustModel?.shutdown?.();

    console.log('[TrustModule] Shutdown complete');
  }

  setDependency(targetType: string, instance: any): void {
    const key = targetType.charAt(0).toLowerCase() + targetType.slice(1);
    this.deps[key as keyof typeof this.deps] = instance;
  }

  emitSupplies(registry: any): void {
    registry.supply('TrustModel', this.trustModel);
    registry.supply('TrustPlan', this.trustPlan);
  }

  private hasRequiredDeps(): boolean {
    return !!this.deps.leuteModel;
  }
}
