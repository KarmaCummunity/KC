// FR-IMPORT-007 AC3 — after publishing a post from an import draft, record that it was imported.
import type { ImportEditableField } from '@kc/domain';
import type { IPostExtractionService } from '../ports/IPostExtractionService';

export interface AttachImportedPostInput {
  /** The draft's import id; null for a draft the function refused to run (nothing to attach). */
  readonly importId: string | null;
  readonly postId: string;
  /**
   * FR-IMPORT-010 AC4 — the draft fields the member changed before publishing; recorded after the
   * link is made. Absent when the caller could not tell (nothing is recorded then).
   */
  readonly editedFields?: readonly ImportEditableField[];
}

/**
 * Marks the just published post as imported from the member's import. It runs after the post
 * exists, so it never throws and never undoes the post: when the link cannot be made the post is
 * simply a normal one, and the result is `false`.
 */
export class AttachImportedPostUseCase {
  constructor(private readonly service: IPostExtractionService) {}

  async execute(input: AttachImportedPostInput): Promise<boolean> {
    if (input.importId === null) return false;
    let attached: boolean;
    try {
      attached = await this.service.attachPost(input.importId, input.postId);
    } catch {
      return false;
    }
    // The edits belong to a published import, so they are sent only once the link exists. Their
    // result does not change the answer: the post is linked whether or not telemetry is kept.
    if (attached && input.editedFields) {
      await this.service.recordEdits(input.importId, input.editedFields).catch(() => false);
    }
    return attached;
  }
}
