// Behavioural in-memory FollowGraph (G39 contract fake). Unlike the spy
// FollowFakeUserRepository (call capture + stubbed results), it implements the
// follow and follow-request rules of the baseline social graph and must pass the same
// followGraphContract cases as SupabaseUserRepository. One store plays the
// database; each actor's instance plays an RLS-scoped client.

import type { FollowEdge, FollowRequest, PrivacyMode, User } from '@kc/domain';
import { FOLLOW_REQUEST_COOLDOWN_DAYS, type FollowGraph } from '../../contracts/followGraph.contract';
import type { FollowOutcome, FollowStateRaw } from '../../ports/IUserRepository';
import { FollowError } from '../errors';

const DAY_MS = 24 * 60 * 60 * 1000;

interface StoredMember {
  readonly userId: string;
  readonly privacyMode: PrivacyMode;
  readonly createdAt: string;
}

export class InMemoryFollowStore {
  readonly members = new Map<string, StoredMember>();
  readonly edges: FollowEdge[] = [];
  readonly requests: FollowRequest[] = [];
  private lastTickMs = 0;

  addMember(privacyMode: PrivacyMode = 'Public'): StoredMember {
    const member = { userId: crypto.randomUUID(), privacyMode, createdAt: this.now() };
    this.members.set(member.userId, member);
    return member;
  }

  /** Strictly increasing timestamps, so `created_at` ordering is total. */
  now(): string {
    this.lastTickMs = Math.max(Date.now(), this.lastTickMs + 1);
    return new Date(this.lastTickMs).toISOString();
  }

  edgeOf(followerId: string, followedId: string): FollowEdge | undefined {
    return this.edges.find((e) => e.followerId === followerId && e.followedId === followedId);
  }

  pendingOf(requesterId: string, targetId: string): FollowRequest | undefined {
    return this.requests.find((r) => r.requesterId === requesterId && r.targetId === targetId && r.status === 'pending');
  }

  /** The latest cooldown of a rejection that has not ended yet, else null. */
  activeCooldown(requesterId: string, targetId: string): string | null {
    const nowIso = new Date().toISOString();
    const ends = this.requests
      .filter((r) => r.requesterId === requesterId && r.targetId === targetId && r.status === 'rejected')
      .map((r) => r.cooldownUntil)
      .filter((until): until is string => until !== null && until > nowIso)
      .sort();
    return ends.at(-1) ?? null;
  }

  /** The public profile the adapter returns in follower lists. */
  toUser(userId: string): User {
    const member = this.members.get(userId);
    return {
      userId,
      shareHandle: `u_${userId.slice(0, 8)}`,
      displayName: `member ${userId.slice(0, 6)}`,
      city: null,
      cityName: null,
      profileStreet: null,
      profileStreetNumber: null,
      contactPhone: null,
      dateOfBirth: null,
      biography: null,
      avatarUrl: null,
      privacyMode: member?.privacyMode ?? 'Public',
      privacyChangedAt: null,
      accountStatus: 'active',
      onboardingState: 'completed',
      notificationPreferences: { critical: true, social: true },
      isSuperAdmin: false,
      closureExplainerDismissed: false,
      firstPostNudgeDismissed: false,
      itemsGivenCount: 0,
      itemsReceivedCount: 0,
      activePostsCountInternal: 0,
      followersCount: this.edges.filter((e) => e.followedId === userId).length,
      followingCount: this.edges.filter((e) => e.followerId === userId).length,
      karmaPoints: 0,
      verificationLevel: 0,
      createdAt: member?.createdAt ?? this.now(),
      updatedAt: member?.createdAt ?? this.now(),
      preferredLanguage: null,
    };
  }
}

export class InMemoryFollowGraph implements FollowGraph {
  constructor(
    private readonly store: InMemoryFollowStore,
    private readonly actorId: string,
  ) {}

  /**
   * `follow_user` (15_social_graph/040_follow_rpcs.sql): an edge at once on a Public profile, a
   * pending request on a Private one; repeating the call changes nothing. Only the actor acts.
   */
  private followUser(requesterId: string, targetId: string): FollowOutcome {
    if (requesterId === targetId) throw new FollowError('self_follow', 'self_follow_forbidden');
    if (requesterId !== this.actorId) throw new FollowError('blocked_relationship', 'forbidden');
    if (this.store.edgeOf(requesterId, targetId)) return 'following';
    if (this.store.members.get(targetId)?.privacyMode !== 'Private') {
      this.store.edges.push({ followerId: requesterId, followedId: targetId, createdAt: this.store.now() });
      return 'following';
    }
    if (this.store.pendingOf(requesterId, targetId)) return 'requested';
    const cooldownUntil = this.store.activeCooldown(requesterId, targetId);
    if (cooldownUntil) throw new FollowError('cooldown_active', 'follow_request_cooldown_active', { cooldownUntil });
    this.store.requests.push({ requesterId, targetId, createdAt: this.store.now(), status: 'pending', cooldownUntil: null });
    return 'requested';
  }

  async follow(followerId: string, followedId: string): Promise<FollowEdge> {
    // A direct follow of a Private profile is refused (FR-FOLLOW-012 AC2); the server has filed a request.
    if (this.followUser(followerId, followedId) === 'requested') {
      throw new FollowError('request_required', 'the profile is private; a follow request was filed');
    }
    return this.store.edgeOf(followerId, followedId) as FollowEdge;
  }

  async unfollow(followerId: string, followedId: string): Promise<void> {
    const edge = this.store.edgeOf(followerId, followedId);
    const mayDelete = this.actorId === followerId || this.actorId === followedId;
    if (edge && mayDelete) this.store.edges.splice(this.store.edges.indexOf(edge), 1);
  }

  async isFollowing(followerId: string, followedId: string): Promise<boolean> {
    return this.store.edgeOf(followerId, followedId) !== undefined;
  }

  async getFollowers(userId: string, limit: number): Promise<User[]> {
    return this.newestFirst(this.store.edges.filter((e) => e.followedId === userId))
      .slice(0, limit)
      .map((e) => this.store.toUser(e.followerId));
  }

  async getFollowing(userId: string, limit: number): Promise<User[]> {
    return this.newestFirst(this.store.edges.filter((e) => e.followerId === userId))
      .slice(0, limit)
      .map((e) => this.store.toUser(e.followedId));
  }

  async sendFollowRequest(requesterId: string, targetId: string): Promise<FollowRequest> {
    if (this.followUser(requesterId, targetId) === 'following') {
      return { requesterId, targetId, createdAt: this.store.now(), status: 'accepted', cooldownUntil: null };
    }
    return this.store.pendingOf(requesterId, targetId) as FollowRequest;
  }

  async acceptFollowRequest(requesterId: string, targetId: string): Promise<void> {
    // follow_requests_update_target: only the target resolves; the accept trigger adds the edge.
    const request = this.actorId === targetId ? this.store.pendingOf(requesterId, targetId) : undefined;
    if (!request) return;
    request.status = 'accepted';
    if (!this.store.edgeOf(requesterId, targetId)) {
      this.store.edges.push({ followerId: requesterId, followedId: targetId, createdAt: this.store.now() });
    }
  }

  async rejectFollowRequest(requesterId: string, targetId: string): Promise<void> {
    const request = this.actorId === targetId ? this.store.pendingOf(requesterId, targetId) : undefined;
    if (!request) return;
    request.status = 'rejected';
    request.cooldownUntil = new Date(Date.now() + FOLLOW_REQUEST_COOLDOWN_DAYS * DAY_MS).toISOString();
  }

  async cancelFollowRequest(requesterId: string, targetId: string): Promise<void> {
    // follow_requests_update_requester: only the requester cancels.
    const request = this.actorId === requesterId ? this.store.pendingOf(requesterId, targetId) : undefined;
    if (request) request.status = 'cancelled';
  }

  async getPendingFollowRequests(userId: string): Promise<FollowRequest[]> {
    return this.newestFirst(this.store.requests.filter((r) => r.targetId === userId && r.status === 'pending'));
  }

  async getFollowStateRaw(viewerId: string, targetUserId: string): Promise<FollowStateRaw> {
    const target = this.store.members.get(targetUserId);
    return {
      target: target ? { userId: target.userId, privacyMode: target.privacyMode, accountStatus: 'active' } : null,
      followingExists: this.store.edgeOf(viewerId, targetUserId) !== undefined,
      pendingRequestExists: this.store.pendingOf(viewerId, targetUserId) !== undefined,
      cooldownUntil: this.store.activeCooldown(viewerId, targetUserId),
    };
  }

  private newestFirst<T extends { createdAt: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
