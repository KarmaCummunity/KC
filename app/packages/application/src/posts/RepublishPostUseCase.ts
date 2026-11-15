/** FR-POST-013 AC3 — clone an expired post into a new open post via `rpc_republish_post`. */
import { postOwnerActions } from '@kc/domain';
import type { IPostRepository } from '../ports/IPostRepository';
import { PostError } from './errors';

export interface RepublishPostInput {
  postId: string;
  ownerId: string;
}

export interface RepublishPostOutput {
  newPostId: string;
}

export class RepublishPostUseCase {
  constructor(private readonly repo: IPostRepository) {}

  async execute(input: RepublishPostInput): Promise<RepublishPostOutput> {
    const post = await this.repo.findById(input.postId, input.ownerId);
    if (!post) throw new PostError('republish_not_found', 'republish_not_found');
    if (post.ownerId !== input.ownerId)
      throw new PostError('republish_not_owner', 'republish_not_owner');
    if (!postOwnerActions(post.status).republish)
      throw new PostError('republish_wrong_status', 'republish_wrong_status');

    const newPostId = await this.repo.republish(input.postId);
    return { newPostId };
  }
}
