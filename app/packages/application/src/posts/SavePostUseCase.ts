/** FR-POST-022 AC2–AC4 — bookmark a post for the signed-in user. */
import type { ISavedPostsRepository } from '../ports/ISavedPostsRepository';
import { PostError } from './errors';

export class SavePostUseCase {
  constructor(private readonly repo: ISavedPostsRepository) {}

  async execute(postId: string): Promise<void> {
    // Preserve the prior message string so any `.message` / toast fallback stays identical.
    if (!postId.trim()) {
      throw new PostError('forbidden', 'SavePostUseCase: postId is required');
    }
    await this.repo.savePost(postId);
  }
}
