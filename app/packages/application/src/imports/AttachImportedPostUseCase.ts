// FR-IMPORT-007 AC3 — after publishing a post from an import draft, record that it was imported.
import type { IPostExtractionService } from '../ports/IPostExtractionService';

export interface AttachImportedPostInput {
  /** The draft's import id; null for a draft the function refused to run (nothing to attach). */
  readonly importId: string | null;
  readonly postId: string;
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
    try {
      return await this.service.attachPost(input.importId, input.postId);
    } catch {
      return false;
    }
  }
}
