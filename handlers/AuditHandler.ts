/**
 * Audit Handler (Pure Business Logic)
 *
 * Transport-agnostic handler for audit operations including:
 * - QR code generation for attestations
 * - Creating and retrieving attestations
 * - Exporting topics with attestations
 * - Verifying attestations
 *
 * Can be used from both Electron IPC and Web Worker contexts.
 */

// Request/Response interfaces
export interface GenerateQRRequest {
  messageHash?: string;
  messageVersion?: string;
  topicId?: string;
  attestationType?: string;
}

export interface GenerateQRResponse {
  success: boolean;
  qrDataUrl?: string;
  qrText?: string;
  metadata?: any;
  error?: string;
}

export interface CreateAttestationRequest {
  messageHash?: string;
  topicId?: string;
  auditorId?: string;
  [key: string]: any;
}

export interface CreateAttestationResponse {
  success: boolean;
  attestation?: any;
  certificateHash?: string;
  hash?: string;
  error?: string;
}

export interface GetAttestationsRequest {
  messageHash?: string;
  topicId?: string;
  auditorId?: string;
}

export interface GetAttestationsResponse {
  success: boolean;
  attestations: any[];
  error?: string;
}

export interface ExportTopicRequest {
  [key: string]: any;
}

export interface ExportTopicResponse {
  success: boolean;
  exportData?: any;
  format?: string;
  metadata?: any;
  error?: string;
}

export interface VerifyAttestationRequest {
  attestationHash: string;
  messageHash: string;
}

export interface VerifyAttestationResponse {
  success: boolean;
  verification?: any;
  error?: string;
}

export interface GenerateBatchQRRequest {
  messages: any[];
}

export interface GenerateBatchQRResponse {
  success: boolean;
  results?: any[];
  summary?: {
    total: number;
    successful: number;
    failed: number;
  };
  error?: string;
}

export interface ParseQRRequest {
  qrText: string;
}

export interface ParseQRResponse {
  success: boolean;
  parsed?: any;
  error?: string;
}

export interface GetAttestationStatusRequest {
  messageHash: string;
}

export interface GetAttestationStatusResponse {
  success: boolean;
  status?: {
    hasAttestations: boolean;
    attestationCount: number;
    fullyAttested: boolean;
    partiallyAttested: boolean;
    pendingSync: boolean;
    auditors: any[];
    signaturesComplete: boolean;
    missingSignatures: string[];
  };
  error?: string;
}

/**
 * AuditHandler - Pure business logic for audit operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - qrGenerator: QR code generation service
 * - attestationManager: Attestation management service (may be null if not initialized)
 * - topicExporter: Topic export service (may be null if not initialized)
 */
export class AuditHandler {
  private qrGenerator: any;
  private attestationManager: any;
  private topicExporter: any;

  constructor(
    qrGenerator: any,
    attestationManager: any,
    topicExporter: any
  ) {
    this.qrGenerator = qrGenerator;
    this.attestationManager = attestationManager;
    this.topicExporter = topicExporter;
  }

  /**
   * Generate QR code for message/topic attestation
   */
  async generateQR(request: GenerateQRRequest): Promise<GenerateQRResponse> {
    console.log('[AuditHandler] Generate QR:', request);

    try {
      const { messageHash, messageVersion, topicId, attestationType = 'message' } = request;

      if (!messageHash && attestationType === 'message') {
        throw new Error('Message hash required for message QR');
      }

      let result: any;
      if (attestationType === 'topic' && topicId) {
        // Generate QR for topic
        result = await this.qrGenerator.generateQRForTopic({
          topicId,
          topicHash: messageHash || topicId // Use topicId as fallback
        });
      } else {
        // Generate QR for message
        result = await this.qrGenerator.generateQRForMessage({
          messageHash,
          messageVersion,
          topicId,
          attestationType
        });
      }

      return {
        success: true,
        qrDataUrl: result.qrDataUrl,
        qrText: result.qrText,
        metadata: result.metadata
      };
    } catch (error) {
      console.error('[AuditHandler] Error generating QR:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Create attestation for a message
   */
  async createAttestation(request: CreateAttestationRequest): Promise<CreateAttestationResponse> {
    console.log('[AuditHandler] Create attestation:', request);

    try {
      if (!this.attestationManager) {
        throw new Error('Attestation manager not available - ONE.core not initialized');
      }

      const result = await this.attestationManager.createAttestation(request);

      return {
        success: true,
        attestation: result.attestation,
        certificateHash: result.certificateHash,
        hash: result.hash
      };
    } catch (error) {
      console.error('[AuditHandler] Error creating attestation:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get attestations for message/topic/auditor
   */
  async getAttestations(request: GetAttestationsRequest): Promise<GetAttestationsResponse> {
    console.log('[AuditHandler] Get attestations:', request);

    try {
      if (!this.attestationManager) {
        return {
          success: true,
          attestations: []
        };
      }

      const { messageHash, topicId, auditorId } = request;
      let attestations: any[] = [];

      if (messageHash) {
        attestations = await this.attestationManager.getAttestationsForMessage(messageHash);
      } else if (topicId) {
        attestations = await this.attestationManager.getAttestationsForTopic(topicId);
      } else if (auditorId) {
        attestations = await this.attestationManager.getAttestationsByAuditor(auditorId);
      }

      return {
        success: true,
        attestations
      };
    } catch (error) {
      console.error('[AuditHandler] Error getting attestations:', error);
      return {
        success: false,
        error: (error as Error).message,
        attestations: []
      };
    }
  }

  /**
   * Export topic with attestations
   */
  async exportTopic(request: ExportTopicRequest): Promise<ExportTopicResponse> {
    console.log('[AuditHandler] Export topic:', request);

    try {
      if (!this.topicExporter) {
        throw new Error('Topic exporter not available');
      }

      const result = await this.topicExporter.exportTopicWithAttestations(request);

      return {
        success: true,
        exportData: result.data,
        format: result.format,
        metadata: result.metadata
      };
    } catch (error) {
      console.error('[AuditHandler] Error exporting topic:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Verify attestation
   */
  async verifyAttestation(request: VerifyAttestationRequest): Promise<VerifyAttestationResponse> {
    console.log('[AuditHandler] Verify attestation:', request);

    try {
      if (!this.attestationManager) {
        throw new Error('Attestation manager not available');
      }

      const { attestationHash, messageHash } = request;

      const verification = await this.attestationManager.verifyAttestation(
        attestationHash,
        messageHash
      );

      return {
        success: true,
        verification
      };
    } catch (error) {
      console.error('[AuditHandler] Error verifying attestation:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Generate batch QR codes for multiple messages
   */
  async generateBatchQR(request: GenerateBatchQRRequest): Promise<GenerateBatchQRResponse> {
    console.log('[AuditHandler] Generate batch QR codes');

    try {
      const { messages } = request;

      if (!messages || !Array.isArray(messages)) {
        throw new Error('Messages array required');
      }

      const results = await this.qrGenerator.generateBatchQRCodes(messages);

      const successCount = results.filter((r: any) => r.success).length;
      console.log(`[AuditHandler] Generated ${successCount}/${messages.length} QR codes`);

      return {
        success: true,
        results,
        summary: {
          total: messages.length,
          successful: successCount,
          failed: messages.length - successCount
        }
      };
    } catch (error) {
      console.error('[AuditHandler] Error in batch QR generation:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Parse scanned QR code
   */
  async parseQR(request: ParseQRRequest): Promise<ParseQRResponse> {
    console.log('[AuditHandler] Parse QR code');

    try {
      const { qrText } = request;

      if (!qrText) {
        throw new Error('QR text required');
      }

      const parsed = this.qrGenerator.parseQRData(qrText);

      return {
        success: true,
        parsed
      };
    } catch (error) {
      console.error('[AuditHandler] Error parsing QR:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get attestation status for UI display
   */
  async getAttestationStatus(request: GetAttestationStatusRequest): Promise<GetAttestationStatusResponse> {
    console.log('[AuditHandler] Get attestation status');

    try {
      if (!this.attestationManager) {
        return {
          success: true,
          status: {
            hasAttestations: false,
            attestationCount: 0,
            fullyAttested: false,
            partiallyAttested: false,
            pendingSync: false,
            auditors: [],
            signaturesComplete: true,
            missingSignatures: []
          }
        };
      }

      const { messageHash } = request;
      const attestations = await this.attestationManager.getAttestationsForMessage(messageHash);

      // Build status object
      const status = {
        hasAttestations: attestations.length > 0,
        attestationCount: attestations.length,
        fullyAttested: attestations.length >= 2, // Consider fully attested with 2+ attestations
        partiallyAttested: attestations.length === 1,
        pendingSync: false, // Would check sync status in real implementation

        auditors: attestations.map((att: any) => ({
          id: att.auditorId,
          name: att.auditorName || 'Unknown',
          attestedAt: att.timestamp,
          trustLevel: 3 // Would fetch from trust manager
        })),

        signaturesComplete: attestations.every((att: any) => att.signature),
        missingSignatures: attestations
          .filter((att: any) => !att.signature)
          .map((att: any) => att.auditorId)
      };

      return {
        success: true,
        status
      };
    } catch (error) {
      console.error('[AuditHandler] Error getting status:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
}
