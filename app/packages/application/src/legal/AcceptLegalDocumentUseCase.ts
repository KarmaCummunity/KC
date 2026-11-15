import type {
  AcceptLegalDocumentInput,
  AcceptLegalDocumentResult,
  ILegalDocumentRepository,
} from '../ports/ILegalDocumentRepository';

// Why the server refused to record a legal-document acceptance (accept_legal_document).
// Mapped to SRS: FR-AUTH-002 AC5, FR-SETTINGS-010 AC3 / AC4.

export type LegalConsentErrorCode =
  /** The version is older than the last material one or newer than the published one. */
  | 'version_out_of_range'
  /** No such legal document type. */
  | 'unknown_document';

export class LegalConsentError extends Error {
  readonly code: LegalConsentErrorCode;
  readonly cause?: unknown;

  constructor(code: LegalConsentErrorCode, cause?: unknown) {
    super(`legal_consent:${code}`);
    this.name = 'LegalConsentError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, LegalConsentError.prototype);
  }
}

export function isLegalConsentError(value: unknown): value is LegalConsentError {
  return value instanceof LegalConsentError;
}

const MAX_USER_AGENT_LEN = 500;

export class AcceptLegalDocumentUseCase {
  constructor(private readonly repo: ILegalDocumentRepository) {}

  execute(input: AcceptLegalDocumentInput): Promise<AcceptLegalDocumentResult> {
    return this.repo.acceptVersion({
      docType: input.docType,
      version: input.version,
      locale: input.locale,
      userAgent: input.userAgent.slice(0, MAX_USER_AGENT_LEN),
    });
  }
}
