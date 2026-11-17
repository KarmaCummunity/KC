// app/packages/application/src/ports/IPostExtractionService.ts
import type { ImportChannel, ImportDraft, ImportSourcePlatform } from '@kc/domain';

export interface PostExtractionRequest {
  /** The text the member shared or pasted, as they have it; the server scrubs it. */
  readonly text: string;
  readonly channel: ImportChannel;
  readonly sourcePlatform: ImportSourcePlatform;
}

/**
 * FR-IMPORT-001..009 — the client-facing seam to the server-owned extraction pipeline
 * (the `extract-external-post` Edge Function, ADR-008).
 */
export interface IPostExtractionService {
  /**
   * The draft for the text, or `null` when the function could not be reached or answered with an
   * error. A refusal it chose to give (switched off, a limit, nothing to extract) is a draft with
   * the manual route, not `null`.
   */
  extract(request: PostExtractionRequest): Promise<ImportDraft | null>;

  /**
   * FR-IMPORT-007 AC3 — after the member publishes a post from an import draft, marks the post as
   * imported from that import and links the two. Returns whether it was linked; a refusal or a
   * failure is `false`, never an exception: the post already exists and must not be undone.
   */
  attachPost(importId: string, postId: string): Promise<boolean>;
}
