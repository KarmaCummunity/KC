import type { LegalDocType, LegalDocumentContent } from '@kc/domain';
import type { ILegalDocumentRepository } from '../ports/ILegalDocumentRepository';

/**
 * The document type has no published version (FR-SETTINGS-010). A refusal the
 * caller can tell from a failure to reach the server: there is nothing to show
 * until an administrator publishes the document.
 */
export class LegalDocumentNotPublishedError extends Error {
  constructor(readonly docType: LegalDocType) {
    // The `legal:` prefix is the one every failure of this read carries.
    super(`legal:getCurrentContent failed for ${docType}: not published`);
    this.name = 'LegalDocumentNotPublishedError';
    Object.setPrototypeOf(this, LegalDocumentNotPublishedError.prototype);
  }
}

export interface LoadLegalDocumentInput {
  readonly docType: LegalDocType;
}

export class LoadLegalDocumentUseCase {
  constructor(private readonly repo: ILegalDocumentRepository) {}

  execute(input: LoadLegalDocumentInput): Promise<LegalDocumentContent> {
    return this.repo.getCurrentContent(input.docType);
  }
}
