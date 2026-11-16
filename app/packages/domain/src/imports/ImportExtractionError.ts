import { DomainError } from '../errors';

/** Why an import text or a provider result cannot be used (stable discriminator for callers). */
export type ImportExtractionFailure =
  | 'empty_text'
  | 'invalid_shape'
  | 'invalid_enum'
  | 'invalid_time';

/**
 * Raised when an external-post import breaks an invariant: the shared text is empty after
 * scrubbing, or the provider's JSON does not match the extraction contract (FR-IMPORT-003).
 * The Edge Function maps `invalid_*` to one retry, then to the manual route (FR-IMPORT-006 AC4).
 */
export class ImportExtractionError extends DomainError {
  readonly code = 'import_extraction';

  constructor(public readonly reason: ImportExtractionFailure, message: string) {
    super(message, { reason });
  }
}
