/** FR-POST-022 AC5 — remove a bookmark. */
import type { ISavedPostsRepository } from '../ports/ISavedPostsRepository';
import { PostError } from './errors';

export class UnsavePostUseCase {
  constructor(private readonly repo: ISavedPostsRepository) {}

  async execute(postId: string): Promise<void> {
    // Preserve the prior message string so any `.message` / toast fallback stays identical.
    if (!postId.trim()) {
      throw new PostError('forbidden', 'UnsavePostUseCase: postId is required');
    }
    await this.repo.unsavePost(postId);
  }
}
