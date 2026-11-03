// IPostRepository contract (G39) — the owner-side lifecycle every implementation
// must honour: create → read → update → list/page → count → close → reopen → delete.
// Mapped to FR-POST-001..004, FR-POST-008, FR-CLOSURE-001/002/004, FR-PROFILE-001 AC4.
//
// Each case starts from a fresh actor (a user plus a repository bound to that
// user's identity), so counts and listings are isolated and cases can run in
// any order. Viewer-dependent behaviour (visibility to other users, admin
// flows, feed ranking) is out of this contract and stays in per-adapter tests.

import type { Address } from '@kc/domain';
import type { CreatePostInput, IPostRepository } from '../ports/IPostRepository';
import type { ContractCase } from './types';
import { assertDefined, assertEqual, assertRejectsWithCode, assertSameList, assertTrue } from './assert';

export interface PostRepositoryActor {
  readonly userId: string;
  /** Repository acting as `userId` (for the Supabase adapter: a client signed in as that user). */
  readonly repo: IPostRepository;
}

export interface PostRepositoryContractContext {
  /** A new user that owns nothing yet. */
  newActor(): Promise<PostRepositoryActor>;
  /** An address whose city the implementation knows (cities are a lookup table). */
  readonly address: Address;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal valid Give post for `ownerId`; override what a case is about. */
export function newPostInput(
  ownerId: string,
  address: Address,
  overrides: Partial<CreatePostInput> = {},
): CreatePostInput {
  return {
    ownerId,
    type: 'Give',
    visibility: 'Public',
    title: `contract ${crypto.randomUUID().slice(0, 8)}`,
    description: null,
    category: 'Other',
    address,
    locationDisplayLevel: 'CityOnly',
    itemCondition: 'Good',
    urgency: null,
    mediaAssets: [],
    ...overrides,
  };
}

type Ctx = PostRepositoryContractContext;

async function createFor(actor: PostRepositoryActor, ctx: Ctx, overrides?: Partial<CreatePostInput>) {
  return actor.repo.create(newPostInput(actor.userId, ctx.address, overrides));
}

const createReturnsOpenPost: ContractCase<Ctx> = {
  name: 'create: returns an open post that carries the input and a stable id',
  async run(ctx) {
    const actor = await ctx.newActor();
    const input = newPostInput(actor.userId, ctx.address, { description: 'two chairs' });
    const post = await actor.repo.create(input);
    assertTrue(UUID.test(post.postId), `postId is a uuid (got ${post.postId})`);
    assertEqual(post.ownerId, actor.userId, 'ownerId');
    assertEqual(post.status, 'open', 'status of a new post');
    assertEqual(post.title, input.title, 'title');
    assertEqual(post.description, 'two chairs', 'description');
    assertEqual(post.category, 'Other', 'category');
    assertEqual(post.visibility, 'Public', 'visibility');
    assertEqual(post.itemCondition, 'Good', 'itemCondition');
    assertEqual(post.address.city, ctx.address.city, 'address.city');
    assertEqual(post.mediaAssets.length, 0, 'mediaAssets of a post created without media');
    assertEqual(post.recipient, null, 'recipient of a new post');
    assertEqual(post.reopenCount, 0, 'reopenCount of a new post');
    assertEqual(post.deleteAfter, null, 'deleteAfter of a new post');
    assertTrue(Number.isFinite(Date.parse(post.createdAt)), 'createdAt is a timestamp');
  },
};

const findByIdRoundTrip: ContractCase<Ctx> = {
  name: 'findById: returns the created post with its owner; an unknown id → null',
  async run(ctx) {
    const actor = await ctx.newActor();
    const created = await createFor(actor, ctx);
    const found = await actor.repo.findById(created.postId, actor.userId);
    assertDefined(found, 'findById of a post just created');
    assertEqual(found.postId, created.postId, 'postId');
    assertEqual(found.ownerId, actor.userId, 'ownerId');
    assertEqual(found.title, created.title, 'title');
    assertEqual(typeof found.ownerHandle, 'string', 'ownerHandle is joined from the owner');
    assertEqual(await actor.repo.findById(crypto.randomUUID(), actor.userId), null, 'findById of an unknown id');
  },
};

const updatePatchesFields: ContractCase<Ctx> = {
  name: 'update: patches title and description and never moves updatedAt backwards',
  async run(ctx) {
    const actor = await ctx.newActor();
    const created = await createFor(actor, ctx);
    const updated = await actor.repo.update(created.postId, { title: 'renamed', description: 'now with text' });
    assertEqual(updated.postId, created.postId, 'postId after update');
    assertEqual(updated.title, 'renamed', 'title after update');
    assertEqual(updated.description, 'now with text', 'description after update');
    assertEqual(updated.status, 'open', 'status is untouched by an edit');
    assertTrue(Date.parse(updated.updatedAt) >= Date.parse(created.updatedAt), 'updatedAt moved forward');
    const reread = await actor.repo.findById(created.postId, actor.userId);
    assertEqual(reread?.title, 'renamed', 'title read back after update');
  },
};

const myPostsNewestFirstPaged: ContractCase<Ctx> = {
  name: 'getMyPosts: newest first, paged with an opaque cursor',
  async run(ctx) {
    const actor = await ctx.newActor();
    const first = await createFor(actor, ctx);
    const second = await createFor(actor, ctx);
    const third = await createFor(actor, ctx);
    const page1 = await actor.repo.getMyPosts(actor.userId, ['open'], 2);
    assertSameList(page1.posts.map((p) => p.postId), [third.postId, second.postId], 'first page');
    assertDefined(page1.nextCursor, 'nextCursor when more posts remain');
    const page2 = await actor.repo.getMyPosts(actor.userId, ['open'], 2, page1.nextCursor);
    assertSameList(page2.posts.map((p) => p.postId), [first.postId], 'second page');
    assertEqual(page2.nextCursor, null, 'nextCursor on the last page');
    assertEqual((await actor.repo.getMyPosts(actor.userId, [], 10)).posts.length, 0, 'no statuses → no posts');
  },
};

const myPostsFilters: ContractCase<Ctx> = {
  name: 'getMyPosts: filters by status and by visibility (include / exclude)',
  async run(ctx) {
    const actor = await ctx.newActor();
    const publicPost = await createFor(actor, ctx);
    const onlyMe = await createFor(actor, ctx, { visibility: 'OnlyMe' });
    await actor.repo.close(publicPost.postId, null);
    const closed = await actor.repo.getMyPosts(actor.userId, ['deleted_no_recipient'], 10);
    assertSameList(closed.posts.map((p) => p.postId), [publicPost.postId], 'status filter');
    const onlyMeOnly = await actor.repo.getMyPosts(actor.userId, ['open'], 10, undefined, 'OnlyMe');
    assertSameList(onlyMeOnly.posts.map((p) => p.postId), [onlyMe.postId], 'visibility filter');
    const withoutOnlyMe = await actor.repo.getMyPosts(actor.userId, ['open'], 10, undefined, undefined, 'OnlyMe');
    assertEqual(withoutOnlyMe.posts.length, 0, 'excludeVisibility removes the OnlyMe post');
  },
};

const countsFollowLifecycle: ContractCase<Ctx> = {
  name: 'countOpenByUser / countProfileOpenPosts follow creates, closes and the OnlyMe exclusion',
  async run(ctx) {
    const actor = await ctx.newActor();
    assertEqual(await actor.repo.countOpenByUser(actor.userId), 0, 'open count of a new user');
    const publicPost = await createFor(actor, ctx);
    await createFor(actor, ctx, { visibility: 'OnlyMe' });
    assertEqual(await actor.repo.countOpenByUser(actor.userId), 2, 'open count after two creates');
    assertEqual(await actor.repo.countProfileOpenPosts(actor.userId), 2, 'profile open count');
    assertEqual(
      await actor.repo.countProfileOpenPosts(actor.userId, { excludeOnlyMe: true }),
      1,
      'profile open count without OnlyMe',
    );
    await actor.repo.close(publicPost.postId, null);
    assertEqual(await actor.repo.countOpenByUser(actor.userId), 1, 'open count after a close');
  },
};

const closeWithoutRecipient: ContractCase<Ctx> = {
  name: 'close without recipient: deleted_no_recipient with a 7-day delete window; closing twice → closure_wrong_status',
  async run(ctx) {
    const actor = await ctx.newActor();
    const created = await createFor(actor, ctx);
    const closed = await actor.repo.close(created.postId, null);
    assertEqual(closed.status, 'deleted_no_recipient', 'status after close');
    assertDefined(closed.deleteAfter, 'deleteAfter after close');
    const windowMs = Date.parse(closed.deleteAfter) - Date.now();
    assertTrue(windowMs > 6 * DAY_MS && windowMs < 8 * DAY_MS, `delete window is 7 days (got ${windowMs} ms)`);
    assertEqual(closed.recipient, null, 'no recipient on a no-recipient close');
    await assertRejectsWithCode(actor.repo.close(created.postId, null), 'closure_wrong_status', 'second close');
  },
};

const reopenAfterClose: ContractCase<Ctx> = {
  name: 'reopen after a no-recipient close: open again, reopenCount incremented, delete window cleared',
  async run(ctx) {
    const actor = await ctx.newActor();
    const created = await createFor(actor, ctx);
    await actor.repo.close(created.postId, null);
    const reopened = await actor.repo.reopen(created.postId);
    assertEqual(reopened.status, 'open', 'status after reopen');
    assertEqual(reopened.reopenCount, 1, 'reopenCount after one reopen');
    assertEqual(reopened.deleteAfter, null, 'deleteAfter after reopen');
    await assertRejectsWithCode(actor.repo.reopen(created.postId), 'closure_wrong_status', 'reopen of an open post');
  },
};

// Policy `posts_delete_self_unlinked` (migration 0053, FR-POST-010 + D-18): the owner may
// delete an open post, or a closed one that has no recipient row. The first run of this
// contract against the stack corrected an older "open only" reading of that rule.
const deleteUnlinkedOwnPost: ContractCase<Ctx> = {
  name: 'delete: removes an open or closed-without-recipient post of its owner; a missing post → post_owner_delete_forbidden',
  async run(ctx) {
    const actor = await ctx.newActor();
    const open = await createFor(actor, ctx);
    await actor.repo.delete(open.postId);
    assertEqual(await actor.repo.findById(open.postId, actor.userId), null, 'findById after delete');
    await assertRejectsWithCode(actor.repo.delete(open.postId), 'post_owner_delete_forbidden', 'delete twice');
    const closed = await createFor(actor, ctx);
    await actor.repo.close(closed.postId, null);
    await actor.repo.delete(closed.postId);
    assertEqual(await actor.repo.findById(closed.postId, actor.userId), null, 'findById after deleting a closed post');
  },
};

/** Every case an IPostRepository implementation must pass. */
export function postRepositoryContract(): ContractCase<PostRepositoryContractContext>[] {
  return [
    createReturnsOpenPost,
    findByIdRoundTrip,
    updatePatchesFields,
    myPostsNewestFirstPaged,
    myPostsFilters,
    countsFollowLifecycle,
    closeWithoutRecipient,
    reopenAfterClose,
    deleteUnlinkedOwnPost,
  ];
}
