import type { GuestPost } from '../ports/IGuestPostsRepository';
import type { IGuestProfileRepository } from '../ports/IGuestProfileRepository';

export class ListGuestProfilePostsUseCase {
  constructor(private readonly repo: IGuestProfileRepository) {}

  execute(shareHandle: string, beforeId?: string): Promise<readonly GuestPost[]> {
    const handle = shareHandle.trim().replace(/^@+/, '');
    if (!handle) return Promise.resolve([]);
    return this.repo.listPosts(handle, beforeId);
  }
}
