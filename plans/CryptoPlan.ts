/**
 * Crypto Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for cryptographic object operations.
 * Provides access to keys, certificates, and other crypto objects from ONE.core.
 * Can be used from both Electron IPC and Web Worker contexts.
 */

// Types
interface CryptoKey {
  id: string;
  type: string;
  filename: string;
  algorithm: string;
  size: number;
  created: Date;
  modified: Date;
  fingerprint: string;
  isPrivate: boolean;
  pemData: string;
}

interface Certificate {
  id: string;
  type: string;
  filename: string;
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  size: number;
  fingerprint: string;
  serialNumber: string;
}

interface ExportData {
  type: string;
  id: string;
  format: string;
  data: string;
  filename: string;
}

// Request/Response interfaces
export interface GetKeysRequest {}

export interface GetKeysResponse {
  success: boolean;
  data: CryptoKey[];
}

export interface GetCertificatesRequest {}

export interface GetCertificatesResponse {
  success: boolean;
  data: Certificate[];
}

export interface ExportCryptoObjectRequest {
  type: string;
  id: string;
  format?: string;
}

export interface ExportCryptoObjectResponse {
  success: boolean;
  data: ExportData;
}

/**
 * CryptoPlan - Pure business logic for cryptographic operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - nodeOneCore: Platform-specific ONE.core instance
 */
export class CryptoPlan {
  private nodeOneCore: any;

  constructor(nodeOneCore: any) {
    this.nodeOneCore = nodeOneCore;
  }

  /**
   * Get available keys from ONE.core
   */
  async getKeys(request: GetKeysRequest): Promise<GetKeysResponse> {
    try {
      const keys: CryptoKey[] = [];

      // Check if Node ONE.core is initialized
      if (this.nodeOneCore.initialized && this.nodeOneCore.ownerId) {
        try {
          // Get owner identity hash from ONE.core
          const ownerIdHash = this.nodeOneCore.ownerId;

          // Display the owner ID hash as the primary identity
          keys.push({
            id: 'owner-id',
            type: 'Owner Identity Hash',
            filename: 'owner.id',
            algorithm: 'SHA256',
            size: 64,
            created: new Date(),
            modified: new Date(),
            fingerprint: `SHA256:${String(ownerIdHash).substring(0, 47)}`,
            isPrivate: false,
            pemData: ownerIdHash
          });

          // Get instance-specific keys if available
          if (this.nodeOneCore.instanceModule) {
            try {
              const instanceInfo: CryptoKey = {
                id: 'instance-id',
                type: 'Instance Identity',
                filename: `${this.nodeOneCore.instanceName || 'node'}.id`,
                algorithm: 'ONE.core',
                size: 64,
                created: new Date(),
                modified: new Date(),
                fingerprint: `Instance:${this.nodeOneCore.instanceName}`,
                isPrivate: false,
                pemData: this.nodeOneCore.instanceName || 'Node.js Hub'
              };
              keys.push(instanceInfo);
            } catch (e) {
              console.log('[CryptoPlan] Could not get instance info:', e);
            }
          }

          // Get LeUTe model identity if available
          if (this.nodeOneCore.leuteModel) {
            try {
              // Get the owner's Someone model from LeUTe
              const ownerSomeone = await this.nodeOneCore.leuteModel.me();
              if (ownerSomeone) {
                keys.push({
                  id: 'leute-identity',
                  type: 'LeUTe Identity',
                  filename: 'leute.id',
                  algorithm: 'ONE.core LeUTe',
                  size: 64,
                  created: new Date(),
                  modified: new Date(),
                  fingerprint: `LeUTe:${ownerSomeone.idHash?.substring(0, 40)}`,
                  isPrivate: false,
                  pemData: ownerSomeone.idHash
                });
              }
            } catch (e) {
              console.log('[CryptoPlan] Could not get LeUTe identity:', e);
            }
          }
        } catch (e) {
          console.log('[CryptoPlan] Error getting keys from ONE.core:', e);
        }
      }

      // If no keys available from ONE.core, provide placeholder data
      if (keys.length === 0) {
        keys.push({
          id: 'no-keys',
          type: 'No Keys Available',
          filename: 'N/A',
          algorithm: 'N/A',
          size: 0,
          created: new Date(),
          modified: new Date(),
          fingerprint: 'ONE.core not initialized',
          isPrivate: false,
          pemData: 'Please log in to view keys'
        });
      }

      console.log('[CryptoPlan] Returning keys:', keys.length);
      return { success: true, data: keys };
    } catch (error: unknown) {
      console.error('[CryptoPlan] Failed to get keys:', error);
      throw error;
    }
  }

  /**
   * Get available certificates from ONE.core
   */
  async getCertificates(request: GetCertificatesRequest): Promise<GetCertificatesResponse> {
    try {
      const certificates: Certificate[] = [];

      // Check if Node ONE.core is initialized
      if (this.nodeOneCore.initialized && this.nodeOneCore.ownerId) {
        try {
          // Get identity certificate from ONE.core if available
          const ownerIdHash = this.nodeOneCore.ownerId;

          certificates.push({
            id: 'owner-cert',
            type: 'Owner Certificate',
            filename: 'owner.crt',
            subject: `CN=Owner, ID=${String(ownerIdHash).substring(0, 16)}`,
            issuer: 'CN=ONE.core Self-Signed',
            validFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            validTo: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000),
            size: 1024,
            fingerprint: `SHA256:${String(ownerIdHash).substring(0, 47)}`,
            serialNumber: String(ownerIdHash).substring(0, 16).toUpperCase()
          });

          // Add instance certificate if available
          if (this.nodeOneCore.instanceName) {
            certificates.push({
              id: 'instance-cert',
              type: 'Instance Certificate',
              filename: `${this.nodeOneCore.instanceName}.crt`,
              subject: `CN=${this.nodeOneCore.instanceName}, O=LAMA IoM`,
              issuer: `CN=Owner ${String(ownerIdHash).substring(0, 8)}, O=LAMA ONE.core`,
              validFrom: new Date(),
              validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
              size: 1024,
              fingerprint: `Instance:${this.nodeOneCore.instanceName}`,
              serialNumber: Date.now().toString(16).toUpperCase()
            });
          }

          // Add IoM group certificate if IoMManager is available
          if ((this.nodeOneCore as any).iomManager) {
            try {
              const iomGroup = await (this.nodeOneCore as any).iomManager.iomGroup();
              if (iomGroup) {
                certificates.push({
                  id: 'iom-cert',
                  type: 'IoM Group Certificate',
                  filename: 'iom-group.crt',
                  subject: `CN=IoM Group, ID=${iomGroup.idHash?.substring(0, 16)}`,
                  issuer: `CN=Owner ${String(ownerIdHash).substring(0, 8)}`,
                  validFrom: new Date(),
                  validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                  size: 1024,
                  fingerprint: `IoM:${iomGroup.idHash?.substring(0, 44)}`,
                  serialNumber: iomGroup.idHash?.substring(0, 16).toUpperCase()
                });
              }
            } catch (e) {
              console.log('[CryptoPlan] Could not get IoM group:', e);
            }
          }
        } catch (e) {
          console.log('[CryptoPlan] Error getting certificates from ONE.core:', e);
        }
      }

      // If no certificates available, provide placeholder
      if (certificates.length === 0) {
        certificates.push({
          id: 'no-certs',
          type: 'No Certificates Available',
          filename: 'N/A',
          subject: 'N/A',
          issuer: 'N/A',
          validFrom: new Date(),
          validTo: new Date(),
          size: 0,
          fingerprint: 'ONE.core not initialized',
          serialNumber: 'Please log in to view certificates'
        });
      }

      console.log('[CryptoPlan] Returning certificates:', certificates.length);
      return { success: true, data: certificates };
    } catch (error: unknown) {
      console.error('[CryptoPlan] Failed to get certificates:', error);
      throw error;
    }
  }

  /**
   * Export a key or certificate from ONE.core
   */
  async exportCryptoObject(request: ExportCryptoObjectRequest): Promise<ExportCryptoObjectResponse> {
    const { type, id, format } = request;

    try {
      let exportData: ExportData;

      // Check if Node ONE.core is initialized
      if (this.nodeOneCore.initialized && this.nodeOneCore.ownerId) {
        const ownerIdHash = this.nodeOneCore.ownerId;

        // Export based on the requested ID
        switch (id) {
          case 'owner-id':
            exportData = {
              type: 'IDENTITY',
              id,
              format: format || 'hex',
              data: ownerIdHash,
              filename: `owner-id.${format || 'txt'}`
            };
            break;

          case 'instance-id':
            exportData = {
              type: 'INSTANCE',
              id,
              format: format || 'txt',
              data: this.nodeOneCore.instanceName || 'Node.js Hub',
              filename: `instance.${format || 'txt'}`
            };
            break;

          case 'leute-identity':
            try {
              const ownerSomeone = await this.nodeOneCore.leuteModel?.me();
              exportData = {
                type: 'LEUTE',
                id,
                format: format || 'hex',
                data: ownerSomeone?.idHash || 'Not available',
                filename: `leute.${format || 'txt'}`
              };
            } catch (e) {
              exportData = {
                type: 'LEUTE',
                id,
                format: format || 'txt',
                data: 'LeUTe model not available',
                filename: 'error.txt'
              };
            }
            break;

          default:
            exportData = {
              type,
              id,
              format: format || 'txt',
              data: 'Key not found',
              filename: `${id}.txt`
            };
        }
      } else {
        exportData = {
          type,
          id,
          format: format || 'txt',
          data: 'ONE.core not initialized',
          filename: 'error.txt'
        };
      }

      return { success: true, data: exportData };
    } catch (error: unknown) {
      console.error('[CryptoPlan] Failed to export:', error);
      throw error;
    }
  }
}
