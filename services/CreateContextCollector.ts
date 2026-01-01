/**
 * CreationContextCollector - Gathers environment context for AI creation
 *
 * Platform-agnostic interface with implementations for Electron/Browser.
 */

import type { CreationContext } from './AICreateService.js';

export interface CreationContextProvider {
  getDeviceName(): Promise<string>;
  getLocale(): string;
}

export class CreationContextCollector {
  constructor(private provider: CreationContextProvider) {}

  async collect(): Promise<CreationContext> {
    const device = await this.provider.getDeviceName();
    const locale = this.provider.getLocale();

    return {
      device,
      locale,
      time: new Date(),
      app: 'LAMA'
    };
  }
}

/**
 * Default provider using Node.js APIs (for Electron main process)
 */
export class NodeCreationContextProvider implements CreationContextProvider {
  async getDeviceName(): Promise<string> {
    const os = await import('os');
    return os.hostname().split('.')[0]; // Remove .local suffix
  }

  getLocale(): string {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  }
}
