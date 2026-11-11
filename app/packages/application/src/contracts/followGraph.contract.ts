// Follow-graph contract (G39) — the follow and follow-request slice of
// IUserRepository, the behaviour every implementation must honour. Mapped to
// docs/spec/requirements/03_following.md: FR-FOLLOW-001 (follow a Public profile),
// FR-FOLLOW-002 (unfollow), FR-FOLLOW-003 (request a Private profile),
// FR-FOLLOW-004 (cancel), FR-FOLLOW-005 (approve), FR-FOLLOW-006 / 008 (reject
// and the 14-day cooldown), FR-FOLLOW-011 (the raw follow state) and
// FR-FOLLOW-012 AC2 (a Private profile is followed only through approval, at the
// data layer).
//
// The contract types its actors with `FollowGraph`, a pick of the port, so a fake
// implements exactly what the cases exercise. Profile, onboarding and auth
// methods of IUserRepository stay with their own tests.

import type { PrivacyMode } from '@kc/domain';
import type { IUserRepository } from '../ports/IUserRepository';
import type { ContractCase } from './types';
import { assertEqual, assertRejects, assertRejectsWithCode, assertSameList, assertTrue } from './assert';

/** The follow and follow-request methods of IUserRepository. */
export type FollowGraph = Pick<
  IUserRepository,
  | 'follow'
  | 'unfollow'
  | 'isFollowing'
  | 'getFollowers'
  | 'getFollowing'
  | 'sendFollowRequest'
  | 'acceptFollowRequest'
  | 'rejectFollowRequest'
  | 'cancelFollowRequest'
  | 'getPendingFollowRequests'
  | 'getFollowStateRaw'
>;

/** FR-FOLLOW-006 AC1: a rejection blocks a new request for 14 days. */
export const FOLLOW_REQUEST_COOLDOWN_DAYS = 14;

export interface FollowActor {
  readonly userId: string;
  /** Repository acting as `userId` (for the Supabase adapter: that user's signed-in client). */
  readonly users: FollowGraph;
}

export interface FollowGraphContractContext {
  /** A new active member with no follows, Public unless asked otherwise. */
  newActor(privacyMode?: PrivacyMode): Promise<FollowActor>;
}

type Ctx = FollowGraphContractContext;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 50;

async function followerIds(of: FollowActor, viewer: FollowActor = of): Promise<string[]> {
  return (await viewer.users.getFollowers(of.userId, PAGE)).map((u) => u.userId);
}

async function followingIds(of: FollowActor): Promise<string[]> {
  return (await of.users.getFollowing(of.userId, PAGE)).map((u) => u.userId);
}

async function pendingRequesters(target: FollowActor): Promise<string[]> {
  return (await target.users.getPendingFollowRequests(target.userId)).map((r) => r.requesterId);
}

const followPublic: ContractCase<Ctx> = {
  name: 'follow: a Public profile is followed at once and both lists show it (FR-FOLLOW-001 AC1)',
  async run(ctx) {
    const fan = await ctx.newActor();
    const star = await ctx.newActor();
    const edge = await fan.users.follow(fan.userId, star.userId);
    assertEqual(edge.followerId, fan.userId, 'edge follower');
    assertEqual(edge.followedId, star.userId, 'edge followed');
    assertEqual(await fan.users.isFollowing(fan.userId, star.userId), true, 'isFollowing after follow');
    assertSameList(await followerIds(star), [fan.userId], "the followed profile's followers");
    assertSameList(await followingIds(fan), [star.userId], "the follower's following list");
  },
};

const followTwiceIsIdempotent: ContractCase<Ctx> = {
  name: 'follow: repeating a follow changes nothing and succeeds (follow_user is idempotent)',
  async run(ctx) {
    const fan = await ctx.newActor();
    const star = await ctx.newActor();
    await fan.users.follow(fan.userId, star.userId);
    const again = await fan.users.follow(fan.userId, star.userId);
    assertEqual(again.followedId, star.userId, 'the second follow answers with the same edge');
    assertSameList(await followerIds(star), [fan.userId], 'still one follower');
  },
};

const noSelfFollow: ContractCase<Ctx> = {
  name: 'follow: following oneself is refused (self_follow, FR-FOLLOW-001 AC5)',
  async run(ctx) {
    const member = await ctx.newActor();
    await assertRejectsWithCode(member.users.follow(member.userId, member.userId), 'self_follow', 'self-follow');
    await assertRejectsWithCode(
      member.users.sendFollowRequest(member.userId, member.userId),
      'self_follow',
      'self follow-request',
    );
  },
};

const unfollowRemovesEdge: ContractCase<Ctx> = {
  name: 'unfollow: removes the edge from both lists; unfollowing again is a no-op (FR-FOLLOW-002 AC2)',
  async run(ctx) {
    const fan = await ctx.newActor();
    const star = await ctx.newActor();
    await fan.users.follow(fan.userId, star.userId);
    await fan.users.unfollow(fan.userId, star.userId);
    assertEqual(await fan.users.isFollowing(fan.userId, star.userId), false, 'isFollowing after unfollow');
    assertSameList(await followerIds(star), [], 'followers after unfollow');
    assertSameList(await followingIds(fan), [], 'following after unfollow');
    await fan.users.unfollow(fan.userId, star.userId);
  },
};

const privateNeedsApproval: ContractCase<Ctx> = {
  name: 'follow: a Private profile cannot be followed directly, only through a request (FR-FOLLOW-003 AC4, FR-FOLLOW-012 AC2)',
  async run(ctx) {
    const fan = await ctx.newActor();
    const shy = await ctx.newActor('Private');
    await assertRejects(fan.users.follow(fan.userId, shy.userId), 'direct follow of a Private profile');
    assertEqual(await fan.users.isFollowing(fan.userId, shy.userId), false, 'no edge to the Private profile');
  },
};

const requestThenApprove: ContractCase<Ctx> = {
  name: 'follow request: pending gives no edge; approval creates it and clears the request (FR-FOLLOW-003 AC1/AC4, FR-FOLLOW-005 AC1)',
  async run(ctx) {
    const fan = await ctx.newActor();
    const shy = await ctx.newActor('Private');
    const request = await fan.users.sendFollowRequest(fan.userId, shy.userId);
    assertEqual(request.status, 'pending', 'a new request is pending');
    assertSameList(await pendingRequesters(shy), [fan.userId], "the target's pending requests");
    assertEqual(await fan.users.isFollowing(fan.userId, shy.userId), false, 'a pending request is not an edge');
    await shy.users.acceptFollowRequest(fan.userId, shy.userId);
    assertEqual(await fan.users.isFollowing(fan.userId, shy.userId), true, 'approval creates the edge');
    assertSameList(await pendingRequesters(shy), [], 'the approved request leaves the pending list');
    assertSameList(await followerIds(shy), [fan.userId], "the target's followers after approval");
  },
};

const onePendingPerPair: ContractCase<Ctx> = {
  name: 'follow request: repeating a request keeps one pending request; asking a followed profile files none',
  async run(ctx) {
    const fan = await ctx.newActor();
    const shy = await ctx.newActor('Private');
    const star = await ctx.newActor();
    await fan.users.sendFollowRequest(fan.userId, shy.userId);
    const repeated = await fan.users.sendFollowRequest(fan.userId, shy.userId);
    assertEqual(repeated.status, 'pending', 'the repeated request is still pending');
    assertSameList(await pendingRequesters(shy), [fan.userId], 'one pending request after asking twice');
    await fan.users.follow(fan.userId, star.userId);
    const followed = await fan.users.sendFollowRequest(fan.userId, star.userId);
    assertEqual(followed.status, 'accepted', 'a request to a profile already followed is an accepted follow');
    assertSameList(await pendingRequesters(star), [], 'no pending request for a followed profile');
  },
};

const cancelAllowsRetry: ContractCase<Ctx> = {
  name: 'cancelFollowRequest: leaves the pending list and the requester may ask again at once (FR-FOLLOW-004 AC1/AC2)',
  async run(ctx) {
    const fan = await ctx.newActor();
    const shy = await ctx.newActor('Private');
    await fan.users.sendFollowRequest(fan.userId, shy.userId);
    await fan.users.cancelFollowRequest(fan.userId, shy.userId);
    assertSameList(await pendingRequesters(shy), [], 'pending list after cancel');
    await fan.users.sendFollowRequest(fan.userId, shy.userId);
    assertSameList(await pendingRequesters(shy), [fan.userId], 'pending list after asking again');
  },
};

const rejectStartsCooldown: ContractCase<Ctx> = {
  name: `rejectFollowRequest: no edge, and a new request waits ${FOLLOW_REQUEST_COOLDOWN_DAYS} days (cooldown_active, FR-FOLLOW-006 AC1, FR-FOLLOW-008)`,
  async run(ctx) {
    const fan = await ctx.newActor();
    const shy = await ctx.newActor('Private');
    await fan.users.sendFollowRequest(fan.userId, shy.userId);
    await shy.users.rejectFollowRequest(fan.userId, shy.userId);
    assertEqual(await fan.users.isFollowing(fan.userId, shy.userId), false, 'a rejection creates no edge');
    assertSameList(await pendingRequesters(shy), [], 'the rejected request leaves the pending list');
    await assertRejectsWithCode(
      fan.users.sendFollowRequest(fan.userId, shy.userId),
      'cooldown_active',
      'a new request during the cooldown',
    );
    const { cooldownUntil } = await fan.users.getFollowStateRaw(fan.userId, shy.userId);
    const daysLeft = cooldownUntil ? (Date.parse(cooldownUntil) - Date.now()) / DAY_MS : 0;
    assertTrue(
      daysLeft > FOLLOW_REQUEST_COOLDOWN_DAYS - 1 && daysLeft <= FOLLOW_REQUEST_COOLDOWN_DAYS,
      `cooldown ends about ${FOLLOW_REQUEST_COOLDOWN_DAYS} days ahead, got ${cooldownUntil}`,
    );
  },
};

const followStateRaw: ContractCase<Ctx> = {
  name: "getFollowStateRaw: the target's privacy and the viewer's edge / pending request (FR-FOLLOW-011)",
  async run(ctx) {
    const fan = await ctx.newActor();
    const star = await ctx.newActor();
    const shy = await ctx.newActor('Private');
    const before = await fan.users.getFollowStateRaw(fan.userId, shy.userId);
    assertEqual(before.target?.privacyMode, 'Private', "the target's privacy mode");
    assertEqual(before.followingExists || before.pendingRequestExists, false, 'nothing between them yet');
    await fan.users.sendFollowRequest(fan.userId, shy.userId);
    assertEqual((await fan.users.getFollowStateRaw(fan.userId, shy.userId)).pendingRequestExists, true, 'pending request');
    await fan.users.follow(fan.userId, star.userId);
    const following = await fan.users.getFollowStateRaw(fan.userId, star.userId);
    assertEqual(following.target?.privacyMode, 'Public', 'a Public target');
    assertEqual(following.followingExists, true, 'following a Public target');
    assertEqual(following.cooldownUntil, null, 'no cooldown without a rejection');
  },
};

/** Every case a follow-graph implementation must pass. */
export function followGraphContract(): ContractCase<FollowGraphContractContext>[] {
  return [
    followPublic,
    followTwiceIsIdempotent,
    noSelfFollow,
    unfollowRemovesEdge,
    privateNeedsApproval,
    requestThenApprove,
    onePendingPerPair,
    cancelAllowsRetry,
    rejectStartsCooldown,
    followStateRaw,
  ];
}
