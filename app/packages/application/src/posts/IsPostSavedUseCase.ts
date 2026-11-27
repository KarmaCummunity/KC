/** FR-POST-022 AC3 — whether the current user bookmarked a post. */
import type { ISavedPostsRepository } from '../ports/ISavedPostsRepository';
import { PostError } from './errors';

export class IsPostSavedUseCase {
  constructor(private readonly repo: ISavedPostsRepository) {}

  async execute(postId: string): Promise<boolean> {
    // Preserve the prior message string so any `.message` / toast fallback stays identical.
    if (!postId.trim()) {
      throw new PostError('forbidden', 'IsPostSavedUseCase: postId is required');
    }
    return this.repo.isPostSaved(postId);
  }
}
