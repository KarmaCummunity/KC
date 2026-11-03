// ─────────────────────────────────────────────
// Composition root for IPostRepository — mirrors authComposition.ts.
// Mapped to SRS: FR-POST-001..010, FR-POST-014, FR-POST-016, FR-FEED-001..005, FR-STATS-003..004.
// ─────────────────────────────────────────────

import {
  getSupabaseClient,
  EdgeFnTranslationService,
  SupabaseFeedRealtime,
  SupabasePostRepository,
  SupabasePostTranslationReader,
  SupabaseStatsRepository,
} from '@kc/infrastructure-supabase';
import {
  CreatePostUseCase,
  DismissFirstPostNudgeUseCase,
  GetActivePostsCountUseCase,
  GetClosureCandidatesUseCase,
  GetCommunityStatsSnapshotUseCase,
  GetFeedUseCase,
  GetMyPostsUseCase,
  GetProfileClosedPostsUseCase,
  GetPostByIdUseCase,
  GetTranslatedPostsUseCase,
  ListMyActivityTimelineUseCase,
  ListPostActorIdentityUseCase,
  MarkAsDeliveredUseCase,
  MaterializePostTranslationsUseCase,
  ReopenPostUseCase,
  RepublishPostUseCase,
  UnmarkRecipientSelfUseCase,
  UpdatePostUseCase,
  UpsertPostActorIdentityUseCase,
  type IFeedRealtime,
  type IPostRepository,
  type IStatsRepository,
} from '@kc/application';
import { getUserRepo } from './userComposition';
import { pickAuthStorage } from './authSecureStorage';

let _repo: IPostRepository | null = null;
let _realtime: IFeedRealtime | null = null;
let _stats: IStatsRepository | null = null;
let _create: CreatePostUseCase | null = null;
let _update: UpdatePostUseCase | null = null;
let _getFeed: GetFeedUseCase | null = null;
let _getById: GetPostByIdUseCase | null = null;
let _myPosts: GetMyPostsUseCase | null = null;
let _profileClosedPosts: GetProfileClosedPostsUseCase | null = null;
let _markDelivered: MarkAsDeliveredUseCase | null = null;
let _reopen: ReopenPostUseCase | null = null;
let _republish: RepublishPostUseCase | null = null;
let _unmrkRecipientSelf: UnmarkRecipientSelfUseCase | null = null;
let _getClosureCandidates: GetClosureCandidatesUseCase | null = null;
let _getActivePostsCount: GetActivePostsCountUseCase | null = null;
let _communityStatsSnapshot: GetCommunityStatsSnapshotUseCase | null = null;
let _listMyActivityTimeline: ListMyActivityTimelineUseCase | null = null;
let _dismissFirstPostNudge: DismissFirstPostNudgeUseCase | null = null;
let _listPostActorIdentity: ListPostActorIdentityUseCase | null = null;
let _upsertPostActorIdentity: UpsertPostActorIdentityUseCase | null = null;
let _getTranslatedPosts: GetTranslatedPostsUseCase | null = null;
let _materializePostTranslations: MaterializePostTranslationsUseCase | null = null;

function getRepo(): IPostRepository {
  if (_repo) return _repo;
  _repo = new SupabasePostRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  return _repo;
}

export function getCreatePostUseCase(): CreatePostUseCase {
  _create ??= new CreatePostUseCase(getRepo());
  return _create;
}

export function getUpdatePostUseCase(): UpdatePostUseCase {
  _update ??= new UpdatePostUseCase(getRepo());
  return _update;
}

export function getFeedUseCase(): GetFeedUseCase {
  _getFeed ??= new GetFeedUseCase(getRepo());
  return _getFeed;
}

export function getPostByIdUseCase(): GetPostByIdUseCase {
  _getById ??= new GetPostByIdUseCase(getRepo());
  return _getById;
}

export function getMyPostsUseCase(): GetMyPostsUseCase {
  _myPosts ??= new GetMyPostsUseCase(getRepo());
  return _myPosts;
}

export function getProfileClosedPostsUseCase(): GetProfileClosedPostsUseCase {
  _profileClosedPosts ??= new GetProfileClosedPostsUseCase(getRepo());
  return _profileClosedPosts;
}

/** Re-export for callers that need to issue raw queries (e.g. countOpenByUser). */
export function getPostRepo(): IPostRepository {
  return getRepo();
}

// ── Closure (FR-CLOSURE-001..005) ─────────────────────────────────────────
export function getMarkAsDeliveredUseCase(): MarkAsDeliveredUseCase {
  _markDelivered ??= new MarkAsDeliveredUseCase(getRepo());
  return _markDelivered;
}

export function getReopenPostUseCase(): ReopenPostUseCase {
  _reopen ??= new ReopenPostUseCase(getRepo());
  return _reopen;
}

export function getRepublishPostUseCase(): RepublishPostUseCase {
  _republish ??= new RepublishPostUseCase(getRepo());
  return _republish;
}

export function getUnmarkRecipientSelfUseCase(): UnmarkRecipientSelfUseCase {
  _unmrkRecipientSelf ??= new UnmarkRecipientSelfUseCase(getRepo());
  return _unmrkRecipientSelf;
}

export function getGetClosureCandidatesUseCase(): GetClosureCandidatesUseCase {
  if (!_getClosureCandidates) {
    _getClosureCandidates = new GetClosureCandidatesUseCase(getRepo());
  }
  return _getClosureCandidates;
}

// ── P1.2 — feed discovery (FR-FEED-009, 014, 015) ─────────────────────────
export function getFeedRealtime(): IFeedRealtime {
  if (!_realtime) {
    _realtime = new SupabaseFeedRealtime(getSupabaseClient({ storage: pickAuthStorage() }));
  }
  return _realtime;
}

export function getStatsRepo(): IStatsRepository {
  if (!_stats) {
    _stats = new SupabaseStatsRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  }
  return _stats;
}

export function getActivePostsCountUseCase(): GetActivePostsCountUseCase {
  _getActivePostsCount ??= new GetActivePostsCountUseCase(getStatsRepo());
  return _getActivePostsCount;
}

export function getCommunityStatsSnapshotUseCase(): GetCommunityStatsSnapshotUseCase {
  if (!_communityStatsSnapshot) {
    _communityStatsSnapshot = new GetCommunityStatsSnapshotUseCase(getStatsRepo());
  }
  return _communityStatsSnapshot;
}

export function getListMyActivityTimelineUseCase(): ListMyActivityTimelineUseCase {
  if (!_listMyActivityTimeline) {
    _listMyActivityTimeline = new ListMyActivityTimelineUseCase(getStatsRepo());
  }
  return _listMyActivityTimeline;
}

export function getDismissFirstPostNudgeUseCase(): DismissFirstPostNudgeUseCase {
  if (!_dismissFirstPostNudge) {
    _dismissFirstPostNudge = new DismissFirstPostNudgeUseCase(getUserRepo());
  }
  return _dismissFirstPostNudge;
}

export function getListPostActorIdentityUseCase(): ListPostActorIdentityUseCase {
  if (!_listPostActorIdentity) {
    _listPostActorIdentity = new ListPostActorIdentityUseCase(getRepo());
  }
  return _listPostActorIdentity;
}

export function getUpsertPostActorIdentityUseCase(): UpsertPostActorIdentityUseCase {
  if (!_upsertPostActorIdentity) {
    _upsertPostActorIdentity = new UpsertPostActorIdentityUseCase(getRepo());
  }
  return _upsertPostActorIdentity;
}

// ── Translation (FR-TRANSLATE-003) ────────────────────────────────────────────
export function getTranslatedPostsUseCase(): GetTranslatedPostsUseCase {
  if (!_getTranslatedPosts) {
    _getTranslatedPosts = new GetTranslatedPostsUseCase(
      new SupabasePostTranslationReader(getSupabaseClient({ storage: pickAuthStorage() })),
    );
  }
  return _getTranslatedPosts;
}

export function materializePostTranslationsUseCase(): MaterializePostTranslationsUseCase {
  if (!_materializePostTranslations) {
    _materializePostTranslations = new MaterializePostTranslationsUseCase(
      new EdgeFnTranslationService(getSupabaseClient({ storage: pickAuthStorage() })),
    );
  }
  return _materializePostTranslations;
}
