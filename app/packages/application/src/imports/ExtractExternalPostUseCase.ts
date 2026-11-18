// FR-IMPORT-006 AC3-AC4, FR-IMPORT-007 — turn a shared or pasted text into a reviewable draft.
import { manualImportDraft, type ImportDraft } from '@kc/domain';
import type { IPostExtractionService, PostExtractionRequest } from '../ports/IPostExtractionService';

/**
 * Asks the extraction service for a draft. It never throws and never blocks creating a post: an
 * empty text, an unreachable service or an error all give the manual draft, which leaves the
 * create form empty for the member to fill.
 */
export class ExtractExternalPostUseCase {
  constructor(private readonly service: IPostExtractionService) {}

  async execute(request: PostExtractionRequest): Promise<ImportDraft> {
    // Nothing to extract: do not spend a call (and a member's hourly allowance) on it.
    if (request.text.trim() === '') return manualImportDraft('empty_text');
    try {
      return (await this.service.extract(request)) ?? manualImportDraft('provider_failed');
    } catch {
      return manualImportDraft('provider_failed');
    }
  }
}
