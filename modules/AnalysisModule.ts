// packages/lama.browser/browser-ui/src/modules/AnalysisModule.ts
import type { Module } from '@refinio/api';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';

// LAMA core models
import TopicAnalysisModel from '@lama/core/one-ai/models/TopicAnalysisModel';

/**
 * AnalysisModule - Analysis infrastructure for memories, topics, documents
 *
 * Provides:
 * - TopicAnalysisModel for conversation analysis
 * - Future: MemoryAnalysisModel, DocumentAnalysisModel, etc.
 */
export class AnalysisModule implements Module {
  readonly name = 'AnalysisModule';

  static demands = [
    { targetType: 'ChannelManager', required: true },
    { targetType: 'TopicModel', required: true }
  ];

  static supplies = [
    { targetType: 'TopicAnalysisModel' }
  ];

  private deps: {
    channelManager?: ChannelManager;
    topicModel?: TopicModel;
  } = {};

  public topicAnalysisModel!: TopicAnalysisModel;

  async init(): Promise<void> {
    if (!this.hasRequiredDeps()) {
      throw new Error('AnalysisModule missing required dependencies');
    }

    console.log('[AnalysisModule] Initializing analysis module...');

    const { channelManager, topicModel } = this.deps;

    // Create and initialize TopicAnalysisModel
    console.log('[AnalysisModule] Creating TopicAnalysisModel...');
    this.topicAnalysisModel = new TopicAnalysisModel(channelManager!, topicModel!);
    await this.topicAnalysisModel.init();
    console.log('[AnalysisModule] TopicAnalysisModel initialized');

    console.log('[AnalysisModule] Initialized');
  }

  async shutdown(): Promise<void> {
    console.log('[AnalysisModule] Shutting down...');
    // TopicAnalysisModel shutdown if needed
    console.log('[AnalysisModule] Shutdown complete');
  }

  setDependency(targetType: string, instance: any): void {
    const key = targetType.charAt(0).toLowerCase() + targetType.slice(1);
    this.deps[key as keyof typeof this.deps] = instance;
  }

  emitSupplies(registry: any): void {
    registry.supply('TopicAnalysisModel', this.topicAnalysisModel);
  }

  private hasRequiredDeps(): boolean {
    return !!(
      this.deps.channelManager &&
      this.deps.topicModel
    );
  }
}
