/**
 * FR-PROFILE-001 AC4 / FR-PROFILE-002 AC2 / FR-POST-017 AC1 (all revised).
 *
 * Returns the closed-posts list for a profile screen, with an identity-role
 * label per item ('publisher' | 'respondent'). The UI derives the economic
 * role (giver / receiver) from (post.type, identityRole) to render the badge.
 */
import type { IPostRepository } from '../ports/IPostRepository';
import type { ProfileClosedPostsItem, ProfileClosedPostsListMode } from '@kc/domain';

export interface GetProfileClosedPostsInput {
  profileUserId: string;
  viewerUserId: string | null;
  limit?: number;
  cursor?: string;
  /** Default `standard` — main profile Closed tab. `owner_only_me` for Hidden screen. */
  listMode?: ProfileClosedPostsListMode;
}

export interface GetProfileClosedPostsOutput {
  items: ProfileClosedPostsItem[];
  // Pass to the next call's `cursor`. Null when no further pages exist. Opaque: it is the
  // keyset position the repository returned with the page.
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 30;
const HARD_MAX = 100;

export class GetProfileClosedPostsUseCase {
  constructor(private readonly repo: IPostRepository) {}

  async execute(input: GetProfileClosedPostsInput): Promise<GetProfileClosedPostsOutput> {
    const limit = clamp(input.limit ?? DEFAULT_LIMIT, 1, HARD_MAX);
    const { items, nextCursor } = await this.repo.getProfileClosedPosts(
      input.profileUserId,
      input.viewerUserId,
      limit,
      input.cursor,
      input.listMode ?? 'standard',
    );
    return { items, nextCursor };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
