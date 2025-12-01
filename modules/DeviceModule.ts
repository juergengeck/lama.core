// packages/lama.browser/browser-ui/src/modules/DeviceModule.ts
import type { Module } from '@refinio/api';

// Device core plans (platform-agnostic)
import { NetworkDeviceInfoPlan, DevicePlan, DeviceDiscoveryPlan } from '@refinio/device.core';
import type { DiscoveryService } from '@connection/core';

// NOTE: QuicVCDiscoveryAdapter NOT imported - it requires Node.js dgram
// Browser doesn't support UDP discovery - only Node.js environments do

/**
 * DeviceModule - Device discovery and management
 *
 * Provides:
 * - NetworkDeviceInfoPlan (manage network device information)
 * - DevicePlan (manage logical devices)
 * - DeviceDiscoveryPlan (orchestrate discovery)
 */
export class DeviceModule implements Module {
  readonly name = 'DeviceModule';

  static demands = [
    { targetType: 'OneCore', required: true },
    { targetType: 'DiscoveryService', required: true }
  ];

  static supplies = [
    { targetType: 'NetworkDeviceInfoPlan' },
    { targetType: 'DevicePlan' },
    { targetType: 'DeviceDiscoveryPlan' }
  ];

  private deps: {
    oneCore?: any;
    discoveryService?: DiscoveryService;
  } = {};

  // Device Plans
  public networkDeviceInfoPlan!: NetworkDeviceInfoPlan;
  public devicePlan!: DevicePlan;
  public deviceDiscoveryPlan!: DeviceDiscoveryPlan;

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('DeviceModule missing required dependencies');
    }

    const { oneCore, discoveryService } = this.deps;

    // Initialize device plans
    this.networkDeviceInfoPlan = new NetworkDeviceInfoPlan(oneCore);
    this.devicePlan = new DevicePlan(oneCore);
    this.deviceDiscoveryPlan = new DeviceDiscoveryPlan(
      oneCore,
      this.networkDeviceInfoPlan,
      this.devicePlan
    );

    // NOTE: Browser doesn't support UDP discovery (Node.js only)
    // QuicVCDiscoveryAdapter is NOT initialized here
    // For Node.js environments, use transport.node/QuicVCDiscovery instead

    console.log('[DeviceModule] ✅ Initialized (browser mode - no UDP discovery)');
  }

  async shutdown(): Promise<void> {
    // Plans don't have shutdown methods yet
    console.log('[DeviceModule] Shutdown complete');
  }

  setDependency(targetType: string, instance: any): void {
    const key = targetType.charAt(0).toLowerCase() + targetType.slice(1);
    this.deps[key as keyof typeof this.deps] = instance;
  }

  emitSupplies(registry: any): void {
    registry.supply('NetworkDeviceInfoPlan', this.networkDeviceInfoPlan);
    registry.supply('DevicePlan', this.devicePlan);
    registry.supply('DeviceDiscoveryPlan', this.deviceDiscoveryPlan);
  }

  private hasRequiredDeps(): boolean {
    return !!this.deps.oneCore && !!this.deps.discoveryService;
  }
}
