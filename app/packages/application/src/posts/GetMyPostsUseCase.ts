/** FR-POST-016: list the caller's own posts (any visibility, owner sees all). */
import type { IPostRepository } from '../ports/IPostRepository';
import type { Post, PostStatus, PostVisibility } from '@kc/domain';

export interface GetMyPostsInput {
  userId: string;
  status: PostStatus[];
  limit?: number;
  cursor?: string;
  /** When set, only posts with this visibility are returned. */
  visibility?: PostVisibility;
  /** When set, posts with this visibility are excluded. */
  excludeVisibility?: PostVisibility;
}

export interface GetMyPostsOutput {
  posts: Post[];
  /** Audit §3.10 — null when no more pages; pass to the next call as `cursor`. */
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 20;
const HARD_MAX = 100;

export class GetMyPostsUseCase {
  constructor(private readonly repo: IPostRepository) {}

  async execute(input: GetMyPostsInput): Promise<GetMyPostsOutput> {
    if (input.status.length === 0) {
      throw new Error('GetMyPostsUseCase: status must include at least one value');
    }
    const limit = clamp(input.limit ?? DEFAULT_LIMIT, 1, HARD_MAX);
    return this.repo.getMyPosts(
      input.userId,
      input.status,
      limit,
      input.cursor,
      input.visibility,
      input.excludeVisibility,
    );
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
