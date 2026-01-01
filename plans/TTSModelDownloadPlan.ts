/**
 * TTSModelDownloadPlan (Platform-Agnostic)
 *
 * Downloads TTS models using transformers.js and tracks metadata in ONE.core.
 * ONE.core provides cross-platform storage abstraction (Node.js, browser, React Native).
 */

import type { TTSObjectManager } from '../models/TTSObjectManager.js';

export interface TTSModelInfo {
  id: string;
  name: string;
  huggingFaceRepo: string;
  sampleRate?: number;
  sizeBytes?: number;
  supportsVoiceCloning?: boolean;
  defaultVoiceUrl?: string;
}

export interface DownloadProgress {
  stage: 'downloading' | 'loading' | 'storing';
  percent: number;
  file?: string;
}

export interface DownloadResult {
  success: boolean;
  modelId: string;
  error?: string;
}

export interface TTSModelDownloadPlanDeps {
  ttsObjectManager: TTSObjectManager;
  onProgress?: (progress: DownloadProgress) => void;
  onError?: (error: Error) => void;
}

/**
 * Platform-agnostic TTS model download plan
 */
export class TTSModelDownloadPlan {
  private ttsObjectManager: TTSObjectManager;
  private onProgress?: (progress: DownloadProgress) => void;
  private onError?: (error: Error) => void;

  constructor(deps: TTSModelDownloadPlanDeps) {
    this.ttsObjectManager = deps.ttsObjectManager;
    this.onProgress = deps.onProgress;
    this.onError = deps.onError;
  }

  setCallbacks(callbacks: {
    onProgress?: (progress: DownloadProgress) => void;
    onError?: (error: Error) => void;
  }): void {
    if (callbacks.onProgress) this.onProgress = callbacks.onProgress;
    if (callbacks.onError) this.onError = callbacks.onError;
  }

  /**
   * Download a TTS model and store metadata in ONE.core
   */
  async download(modelInfo: TTSModelInfo): Promise<DownloadResult> {
    const { id: modelId, huggingFaceRepo } = modelInfo;

    try {
      console.log(`[TTSModelDownloadPlan] Downloading: ${modelId} from ${huggingFaceRepo}`);

      // Create/update metadata in ONE.core
      await this.ttsObjectManager.createOrUpdate({
        name: modelId,
        huggingFaceRepo,
        displayName: modelInfo.name,
        sampleRate: modelInfo.sampleRate || 24000,
        requiresReferenceAudio: modelInfo.supportsVoiceCloning,
        defaultVoiceUrl: modelInfo.defaultVoiceUrl,
        sizeBytes: modelInfo.sizeBytes,
        provider: 'transformers.js',
        architecture: 'chatterbox',
        capabilities: modelInfo.supportsVoiceCloning ? ['voice-cloning'] : undefined,
      });

      await this.ttsObjectManager.updateStatus(modelId, 'downloading');

      // Import transformers.js (works cross-platform)
      const transformers = await import('@huggingface/transformers');
      const { env } = transformers;
      const ChatterboxModel = (transformers as any).ChatterboxModel;
      const ChatterboxProcessor = (transformers as any).ChatterboxProcessor;

      if (!ChatterboxModel || !ChatterboxProcessor) {
        throw new Error('ChatterboxModel/ChatterboxProcessor not available in transformers.js');
      }

      env.allowLocalModels = true;

      // Progress callback
      const progressCallback = (progress: any) => {
        if (progress.status === 'progress' && progress.progress !== undefined) {
          const percent = Math.round(progress.progress);
          this.onProgress?.({ stage: 'downloading', percent, file: progress.file });
          this.ttsObjectManager.updateDownloadProgress(modelId, percent);
        }
      };

      this.onProgress?.({ stage: 'downloading', percent: 0 });

      // Download model (transformers.js handles cross-platform caching)
      await Promise.all([
        ChatterboxModel.from_pretrained(huggingFaceRepo, { progress_callback: progressCallback }),
        ChatterboxProcessor.from_pretrained(huggingFaceRepo),
      ]);

      await this.ttsObjectManager.updateStatus(modelId, 'installed');

      console.log(`[TTSModelDownloadPlan] Complete: ${modelId}`);
      this.onProgress?.({ stage: 'downloading', percent: 100 });

      return { success: true, modelId };
    } catch (error) {
      console.error(`[TTSModelDownloadPlan] Failed: ${modelId}`, error);
      await this.ttsObjectManager.updateStatus(modelId, 'error', (error as Error).message);
      this.onError?.(error as Error);
      return { success: false, modelId, error: (error as Error).message };
    }
  }

  async isDownloaded(modelId: string): Promise<boolean> {
    const obj = await this.ttsObjectManager.getByName(modelId);
    return obj?.status === 'installed' || obj?.status === 'ready';
  }

  async delete(modelId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ttsObjectManager.delete(modelId);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}
