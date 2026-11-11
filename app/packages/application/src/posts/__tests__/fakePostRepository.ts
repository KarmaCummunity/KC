import type {
  ClosureCandidate,
  CreatePostInput,
  FeedPage,
  IPostRepository,
  PostFeedFilter,
  PostWithOwner,
  ProfileClosedPostsPage,
  UpdatePostInput,
} from '../../ports/IPostRepository';
import type { PostActorIdentityRow, UpsertPostActorIdentityInput } from '../../ports/postActorIdentity';
import type {
  Post,
  PostStatus,
  PostVisibility,
  ProfileClosedPostsItem,
  ProfileClosedPostsListMode,
} from '@kc/domain';
import type { PostError } from '../errors';

/**
 * In-memory IPostRepository for use-case tests. Captures the last call to each
 * method so tests can assert on what the use case forwarded.
 */
export class FakePostRepository implements IPostRepository {
  // Stored data
  posts: PostWithOwner[] = [];
  nextCursor: string | null = null;

  // Call captures
  lastGetFeedArgs: { viewerId: string | null; filter: PostFeedFilter; limit: number; cursor?: string } | null = null;
  lastFindByIdArgs: {
    postId: string;
    viewerId: string | null;
    opts?: { identityListingHostUserId?: string | null };
  } | null = null;
  lastCreateArgs: CreatePostInput | null = null;
  lastUpdateArgs: { postId: string; patch: UpdatePostInput } | null = null;
  lastDeletePostId: string | null = null;
  lastAdminRemovePostId: string | null = null;
  lastGetMyPostsArgs: {
    userId: string;
    status: PostStatus[];
    limit: number;
    cursor?: string;
    visibility?: PostVisibility;
    excludeVisibility?: PostVisibility;
  } | null = null;
  lastCountOpenUserId: string | null = null;
  lastGetProfileClosedPostsArgs: {
    profileUserId: string;
    viewerUserId: string | null;
    limit: number;
    cursor?: string;
    listMode?: ProfileClosedPostsListMode;
  } | null = null;
  lastListPostActorIdentityPostId: string | null = null;
  lastUpsertPostActorIdentityArgs: UpsertPostActorIdentityInput | null = null;
  profileClosedPostsResult: ProfileClosedPostsItem[] = [];
  profileClosedPostsNextCursor: string | null = null;
  listPostActorIdentitiesResult: PostActorIdentityRow[] = [];

  // Stubs / errors
  createResult: Post | null = null;
  createError: Error | null = null;
  updateResult: Post | null = null;
  updateError: Error | null = null;
  findByIdResult: PostWithOwner | null = null;
  findByIdError: Error | null = null;
  deleteError: Error | null = null;
  adminRemoveError: Error | null = null;
  countOpenResult = 0;
  myPostsResult: Post[] = [];

  getFeed = async (
    viewerId: string | null,
    filter: PostFeedFilter,
    limit: number,
    cursor?: string,
  ): Promise<FeedPage> => {
    this.lastGetFeedArgs = { viewerId, filter, limit, cursor };
    return { posts: this.posts, nextCursor: this.nextCursor };
  };

  findById = async (
    postId: string,
    viewerId: string | null,
    opts?: { identityListingHostUserId?: string | null },
  ): Promise<PostWithOwner | null> => {
    this.lastFindByIdArgs = { postId, viewerId, opts };
    if (this.findByIdError) throw this.findByIdError;
    return this.findByIdResult;
  };

  create = async (input: CreatePostInput): Promise<Post> => {
    this.lastCreateArgs = input;
    if (this.createError) throw this.createError;
    if (!this.createResult) throw new Error('FakePostRepository: createResult not configured');
    return this.createResult;
  };

  update = async (postId: string, patch: UpdatePostInput): Promise<Post> => {
    this.lastUpdateArgs = { postId, patch };
    if (this.updateError) throw this.updateError;
    if (!this.updateResult) throw new Error('FakePostRepository: updateResult not configured');
    return this.updateResult;
  };

  delete = async (postId: string): Promise<void> => {
    this.lastDeletePostId = postId;
    if (this.deleteError) throw this.deleteError;
  };

  adminRemove = async (postId: string): Promise<void> => {
    this.lastAdminRemovePostId = postId;
    if (this.adminRemoveError) throw this.adminRemoveError;
  };

  // ── Closure (P0.6) ───────────────────────────────────────────────────────
  closeResult: Post | null = null;
  reopenResult: Post | null = null;
  republishResult: string | null = null;
  closeError: PostError | Error | null = null;
  reopenError: PostError | Error | null = null;
  republishError: PostError | Error | null = null;
  closureCandidatesResult: ClosureCandidate[] = [];
  lastCloseArgs: { postId: string; recipientUserId: string | null } | null = null;
  lastOwnerComplete: {
    targetId: string;
    recipientUserId: string | null;
    mode: 'assign' | 'close_without';
  } | null = null;
  ownerCompleteResult: { closed: boolean } = { closed: true };
  lastReopenArgs: { postId: string } | null = null;
  lastRepublishArgs: { postId: string } | null = null;
  lastGetClosureCandidatesPostId: string | null = null;

  ownerCompleteOffer = async (
    targetId: string,
    recipientUserId: string | null,
    mode: 'assign' | 'close_without',
  ): Promise<{ closed: boolean }> => {
    this.lastOwnerComplete = { targetId, recipientUserId, mode };
    return this.ownerCompleteResult;
  };

  close = async (postId: string, recipientUserId: string | null): Promise<Post> => {
    this.lastCloseArgs = { postId, recipientUserId };
    if (this.closeError) throw this.closeError;
    if (!this.closeResult) throw new Error('FakePostRepository: closeResult not configured');
    return this.closeResult;
  };

  reopen = async (postId: string): Promise<Post> => {
    this.lastReopenArgs = { postId };
    if (this.reopenError) throw this.reopenError;
    if (!this.reopenResult) throw new Error('FakePostRepository: reopenResult not configured');
    return this.reopenResult;
  };

  republish = async (postId: string): Promise<string> => {
    this.lastRepublishArgs = { postId };
    if (this.republishError) throw this.republishError;
    if (!this.republishResult) throw new Error('FakePostRepository: republishResult not configured');
    return this.republishResult;
  };

  unmrkRecipientSelf = async (_postId: string): Promise<void> => {};

  getClosureCandidates = async (postId: string): Promise<ClosureCandidate[]> => {
    this.lastGetClosureCandidatesPostId = postId;
    return this.closureCandidatesResult;
  };

  myPostsNextCursor: string | null = null;
  getMyPosts = async (
    userId: string,
    status: PostStatus[],
    limit: number,
    cursor?: string,
    visibility?: PostVisibility,
    excludeVisibility?: PostVisibility,
  ): Promise<{ posts: Post[]; nextCursor: string | null }> => {
    this.lastGetMyPostsArgs = { userId, status, limit, cursor, visibility, excludeVisibility };
    return { posts: this.myPostsResult, nextCursor: this.myPostsNextCursor };
  };

  countOpenByUser = async (userId: string): Promise<number> => {
    this.lastCountOpenUserId = userId;
    return this.countOpenResult;
  };

  countProfilePostsForViewer = async (
    ownerId: string,
    _viewerId: string | null,
  ): Promise<number> => {
    this.lastCountOpenUserId = ownerId;
    return this.countOpenResult;
  };

  countProfileOpenPosts = async (
    ownerId: string,
    _options?: { excludeOnlyMe?: boolean },
  ): Promise<number> => {
    this.lastCountOpenUserId = ownerId;
    return this.countOpenResult;
  };

  countProfileClosedPosts = async (
    profileUserId: string,
    _viewerUserId: string | null,
  ): Promise<number> => {
    this.lastCountOpenUserId = profileUserId;
    return this.countOpenResult;
  };

  getProfileClosedPosts = async (
    profileUserId: string,
    viewerUserId: string | null,
    limit: number,
    cursor?: string,
    listMode?: ProfileClosedPostsListMode,
  ): Promise<ProfileClosedPostsPage> => {
    this.lastGetProfileClosedPostsArgs = { profileUserId, viewerUserId, limit, cursor, listMode };
    return { items: this.profileClosedPostsResult, nextCursor: this.profileClosedPostsNextCursor };
  };

  listPostActorIdentities = async (postId: string): Promise<PostActorIdentityRow[]> => {
    this.lastListPostActorIdentityPostId = postId;
    return this.listPostActorIdentitiesResult;
  };

  upsertPostActorIdentity = async (input: UpsertPostActorIdentityInput): Promise<void> => {
    this.lastUpsertPostActorIdentityArgs = input;
  };

}

export { makePostWithOwner, makeClosureCandidate } from './fakePostRepositoryFactories';
