/** FR-CLOSURE-001..003: validate owner + status + recipient, then close. */
import { postOwnerActions, type Post } from '@kc/domain';
import type { IPostRepository } from '../ports/IPostRepository';
import { PostError } from './errors';

export interface MarkAsDeliveredInput {
  postId: string;
  ownerId: string;
  recipientUserId: string | null;
}

export interface MarkAsDeliveredOutput {
  post: Post;
}

export class MarkAsDeliveredUseCase {
  constructor(private readonly repo: IPostRepository) {}

  async execute(input: MarkAsDeliveredInput): Promise<MarkAsDeliveredOutput> {
    const post = await this.repo.findById(input.postId, input.ownerId);
    if (!post) throw new PostError('forbidden', 'post_not_found');
    if (post.ownerId !== input.ownerId)
      throw new PostError('closure_not_owner', 'closure_not_owner');
    // Closing as delivered is a move of the post machine; the server holds the same graph.
    if (!postOwnerActions(post.status).close)
      throw new PostError('closure_wrong_status', 'closure_wrong_status');

    // Reject marking self as recipient — handled defensively here AND in the
    // SQL function (0017). The recipient existence check itself runs in the
    // RPC; we trust it rather than round-tripping a separate `findById`.
    if (input.recipientUserId !== null && input.recipientUserId === input.ownerId)
      throw new PostError('closure_recipient_not_in_chat', 'closure_recipient_not_in_chat');

    const closed = await this.repo.close(input.postId, input.recipientUserId);
    return { post: closed };
  }
}
