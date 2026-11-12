/** FR-CLOSURE-005: reopen a closed post (with cleanup of recipient row + counter deltas via triggers). */
import { postOwnerActions, type Post } from '@kc/domain';
import type { IPostRepository } from '../ports/IPostRepository';
import { PostError } from './errors';

export interface ReopenPostInput {
  postId: string;
  ownerId: string;
}

export interface ReopenPostOutput {
  post: Post;
}

export class ReopenPostUseCase {
  constructor(private readonly repo: IPostRepository) {}

  async execute(input: ReopenPostInput): Promise<ReopenPostOutput> {
    const post = await this.repo.findById(input.postId, input.ownerId);
    if (!post) throw new PostError('forbidden', 'post_not_found');
    if (post.ownerId !== input.ownerId)
      throw new PostError('closure_not_owner', 'closure_not_owner');

    // Reopening is a move of the post machine (an ending → open, by the owner).
    if (!postOwnerActions(post.status).reopen)
      throw new PostError('closure_wrong_status', 'closure_wrong_status');

    if (post.status === 'deleted_no_recipient') {
      const deleteAfter = post.deleteAfter ? new Date(post.deleteAfter).getTime() : 0;
      if (deleteAfter <= Date.now())
        throw new PostError('reopen_window_expired', 'reopen_window_expired');
    }

    const reopened = await this.repo.reopen(input.postId);
    return { post: reopened };
  }
}
