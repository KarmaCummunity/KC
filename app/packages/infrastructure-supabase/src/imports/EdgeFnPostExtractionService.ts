// app/packages/infrastructure-supabase/src/imports/EdgeFnPostExtractionService.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IPostExtractionService, PostExtractionRequest } from '@kc/application';
import { parseImportDraft, type ImportDraft } from '@kc/domain';

/**
 * FR-IMPORT-001..009 — calls the `extract-external-post` Edge Function (ADR-008). The caller's
 * session is attached by the client, so the function knows the member; the request body carries
 * no identity. The answer is parsed defensively: a body that is not a draft is the manual route.
 */
export class EdgeFnPostExtractionService implements IPostExtractionService {
  constructor(private readonly client: SupabaseClient) {}

  async extract(request: PostExtractionRequest): Promise<ImportDraft | null> {
    const { data, error } = await this.client.functions.invoke<unknown>('extract-external-post', {
      body: { text: request.text, channel: request.channel, sourcePlatform: request.sourcePlatform },
    });
    // A transport or HTTP error is "no answer" (the use case then falls back to manual), never a throw.
    if (error || data === null || data === undefined) return null;
    return parseImportDraft(data);
  }
}
