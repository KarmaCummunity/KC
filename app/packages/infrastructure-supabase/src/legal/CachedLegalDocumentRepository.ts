import type { LegalDocType, LegalDocumentContent, LegalPendingItem } from '@kc/domain';
import type { AcceptLegalDocumentInput, AcceptLegalDocumentResult, ILegalDocumentRepository } from '@kc/application';
import type { LegalDocumentCache } from './legalCache';

/**
 * Keeps a copy of each legal document on the device, so the terms can be
 * shown with no connection: a document that loads is stored, and one that
 * fails to load is answered from the stored copy when there is one.
 *
 * The cache wraps any source of the port (Supabase directly, or KC's API),
 * which is why it is its own class: where the documents come from changes,
 * the offline copy must not.
 */
export class CachedLegalDocumentRepository implements ILegalDocumentRepository {
  constructor(
    private readonly source: ILegalDocumentRepository,
    private readonly cache: LegalDocumentCache,
  ) {}

  async getCurrentContent(docType: LegalDocType): Promise<LegalDocumentContent> {
    try {
      const fresh = await this.source.getCurrentContent(docType);
      await this.cache.write(fresh);
      return fresh;
    } catch (error) {
      const cached = await this.cache.readPointer(docType);
      if (cached) return cached;
      throw error;
    }
  }

  getPendingForCurrentUser(): Promise<LegalPendingItem[]> {
    return this.source.getPendingForCurrentUser();
  }

  acceptVersion(input: AcceptLegalDocumentInput): Promise<AcceptLegalDocumentResult> {
    return this.source.acceptVersion(input);
  }
}
