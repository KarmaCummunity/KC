/** FR-CHAT-017 — recipients the "+" on the Inbox offers: people I follow, then other people found by name. */
import { BackendUnavailableError, type User } from '@kc/domain';
import type { IBlockRepository } from '../ports/IBlockRepository';
import type { IUserRepository } from '../ports/IUserRepository';

export interface ListChatStartCandidatesInput {
  viewerId: string;
  query: string;
}

export interface ChatStartCandidates {
  /** People I follow, newest follow first; narrowed by the query when there is one. */
  following: User[];
  /** Other members matching the query. Empty until the query has 2+ characters. */
  others: User[];
}

const FOLLOWING_LIMIT = 100;
const OTHERS_LIMIT = 20;
const MIN_SEARCH_CHARS = 2;

export class ListChatStartCandidatesUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly blocks: IBlockRepository,
  ) {}

  async execute(input: ListChatStartCandidatesInput): Promise<ChatStartCandidates> {
    const query = input.query.trim();
    const searching = query.length >= MIN_SEARCH_CHARS;
    const [followed, found, myBlocks] = await Promise.all([
      this.users.getFollowing(input.viewerId, FOLLOWING_LIMIT),
      searching
        ? this.users.searchUsers(query, { excludeUserId: input.viewerId, limit: OTHERS_LIMIT })
        : Promise.resolve([] as User[]),
      // Blocked people are also hidden by the server (users_hide_blocked); a backend without the
      // blocked-users list degrades to that filter alone instead of failing the screen.
      this.blocks.listMyBlockedUsers().catch((error: unknown) => {
        if (error instanceof BackendUnavailableError) return [];
        throw error;
      }),
    ]);
    const hidden = new Set(myBlocks.map((b) => b.userId));
    const offerable = (u: User) =>
      u.userId !== input.viewerId && u.accountStatus === 'active' && !hidden.has(u.userId);

    const following = followed.filter(offerable).filter((u) => !searching || matches(u, query));
    const followingIds = new Set(following.map((u) => u.userId));
    const others = found.filter(offerable).filter((u) => !followingIds.has(u.userId));
    return { following, others };
  }
}

function matches(user: User, query: string): boolean {
  const needle = query.toLowerCase();
  return (
    (user.displayName ?? '').toLowerCase().includes(needle) ||
    user.shareHandle.toLowerCase().includes(needle)
  );
}
