// ISavedPostsRepository contract (G39) — the bookmark behaviour every
// implementation must honour. Mapped to FR-POST-022 AC2, AC4–AC6 and
// FR-PROFILE-016 AC3 (D-29: a bookmark outlives the post's readability).
//
// Bookmarks are inherently two-sided — a user saves another user's post, and
// the post's readability decides whether the bookmark lists — so unlike the
// IPostRepository contract these cases do involve a second actor. Each case
// still starts from fresh actors, so it is isolated and order-independent.

import type { Address } from '@kc/domain';
import type { IPostRepository } from '../ports/IPostRepository';
import type { ISavedPostsRepository } from '../ports/ISavedPostsRepository';
import type { ContractCase } from './types';
import { assertDefined, assertEqual, assertRejects, assertSameList, assertTrue } from './assert';
import { newPostInput } from './postRepository.contract';

export interface SavedPostsActor {
  readonly userId: string;
  /** Post repository acting as `userId` — the contract needs posts to bookmark. */
  readonly posts: IPostRepository;
  /** Saved-posts repository acting as `userId` (for the Supabase adapter: the same signed-in client). */
  readonly saved: ISavedPostsRepository;
}

export interface SavedPostsContractContext {
  /** A new user that owns and has saved nothing yet. */
  newActor(): Promise<SavedPostsActor>;
  /** An address whose city the implementation knows (cities are a lookup table). */
  readonly address: Address;
}

type Ctx = SavedPostsContractContext;

/** A new open Public post owned by `actor`; returns its id. */
async function publicPostOf(actor: SavedPostsActor, ctx: Ctx): Promise<string> {
  const post = await actor.posts.create(newPostInput(actor.userId, ctx.address));
  return post.postId;
}

async function savedIds(actor: SavedPostsActor, limit = 10): Promise<string[]> {
  const page = await actor.saved.listSavedPosts(limit);
  return page.posts.map((p) => p.postId);
}

const saveThenRead: ContractCase<Ctx> = {
  name: 'savePost / isPostSaved: a readable post becomes saved; unsaved and unknown posts read false',
  async run(ctx) {
    const actor = await ctx.newActor();
    const saved = await publicPostOf(actor, ctx);
    const notSaved = await publicPostOf(actor, ctx);
    await actor.saved.savePost(saved);
    assertEqual(await actor.saved.isPostSaved(saved), true, 'isPostSaved after savePost');
    assertEqual(await actor.saved.isPostSaved(notSaved), false, 'isPostSaved of a post never saved');
    assertEqual(await actor.saved.isPostSaved(crypto.randomUUID()), false, 'isPostSaved of an unknown id');
  },
};

const saveIsIdempotent: ContractCase<Ctx> = {
  name: 'savePost: idempotent — saving twice keeps a single bookmark (FR-POST-022 AC4)',
  async run(ctx) {
    const actor = await ctx.newActor();
    const postId = await publicPostOf(actor, ctx);
    await actor.saved.savePost(postId);
    await actor.saved.savePost(postId);
    assertSameList(await savedIds(actor), [postId], 'saved list after a duplicate save');
  },
};

const unsaveRemovesBookmark: ContractCase<Ctx> = {
  name: 'unsavePost: removes the bookmark; unsaving a post that is not saved is a no-op (FR-POST-022 AC5)',
  async run(ctx) {
    const actor = await ctx.newActor();
    const postId = await publicPostOf(actor, ctx);
    await actor.saved.savePost(postId);
    await actor.saved.unsavePost(postId);
    assertEqual(await actor.saved.isPostSaved(postId), false, 'isPostSaved after unsavePost');
    assertSameList(await savedIds(actor), [], 'saved list after unsavePost');
    await actor.saved.unsavePost(postId);
    await actor.saved.unsavePost(crypto.randomUUID());
  },
};

const listNewestFirstPaged: ContractCase<Ctx> = {
  name: 'listSavedPosts: most recently saved first, paged with an opaque cursor, carrying the saved post',
  async run(ctx) {
    const actor = await ctx.newActor();
    const first = await publicPostOf(actor, ctx);
    const second = await publicPostOf(actor, ctx);
    const third = await publicPostOf(actor, ctx);
    // Saved in creation order, so the newest bookmark is the newest post here.
    for (const postId of [first, second, third]) await actor.saved.savePost(postId);
    const page1 = await actor.saved.listSavedPosts(2);
    assertSameList(page1.posts.map((p) => p.postId), [third, second], 'first page');
    assertEqual(page1.posts[0]?.ownerId, actor.userId, 'listed post carries its owner');
    assertEqual(page1.posts[0]?.status, 'open', 'listed post carries its status');
    assertDefined(page1.nextCursor, 'nextCursor when more bookmarks remain');
    const page2 = await actor.saved.listSavedPosts(2, page1.nextCursor);
    assertSameList(page2.posts.map((p) => p.postId), [first], 'second page');
    assertEqual(page2.nextCursor, null, 'nextCursor on the last page');
  },
};

const bookmarksArePerUser: ContractCase<Ctx> = {
  name: 'bookmarks are per user: a post saved by another user is not saved for me',
  async run(ctx) {
    const owner = await ctx.newActor();
    const reader = await ctx.newActor();
    const postId = await publicPostOf(owner, ctx);
    await reader.saved.savePost(postId);
    assertEqual(await reader.saved.isPostSaved(postId), true, "reader's isPostSaved");
    assertSameList(await savedIds(reader), [postId], "reader's saved list");
    assertEqual(await owner.saved.isPostSaved(postId), false, "owner's isPostSaved of a post only the reader saved");
    assertSameList(await savedIds(owner), [], "owner's saved list");
  },
};

const unreadablePostRefused: ContractCase<Ctx> = {
  name: "savePost: refused for a post the actor cannot read — another user's OnlyMe post or an unknown id (FR-POST-022 AC2)",
  async run(ctx) {
    const owner = await ctx.newActor();
    const reader = await ctx.newActor();
    const onlyMe = await owner.posts.create(newPostInput(owner.userId, ctx.address, { visibility: 'OnlyMe' }));
    await assertRejects(reader.saved.savePost(onlyMe.postId), "save of another user's OnlyMe post");
    assertEqual(await reader.saved.isPostSaved(onlyMe.postId), false, 'isPostSaved after the refused save');
    await assertRejects(reader.saved.savePost(crypto.randomUUID()), 'save of an unknown post id');
    // The owner reads their own OnlyMe post, so the owner may bookmark it.
    await owner.saved.savePost(onlyMe.postId);
    assertEqual(await owner.saved.isPostSaved(onlyMe.postId), true, "owner's save of their OnlyMe post");
  },
};

const unreadableOmittedBookmarkKept: ContractCase<Ctx> = {
  name: 'listSavedPosts: omits a post that became unreadable, keeps the bookmark, lists it again once readable (FR-PROFILE-016 AC3, D-29)',
  async run(ctx) {
    const owner = await ctx.newActor();
    const reader = await ctx.newActor();
    const postId = await publicPostOf(owner, ctx);
    await reader.saved.savePost(postId);
    // A no-recipient close hides the post from everyone but its owner.
    await owner.posts.close(postId, null);
    assertSameList(await savedIds(reader), [], 'saved list while the post is unreadable');
    assertEqual(await reader.saved.isPostSaved(postId), true, 'bookmark survives the post becoming unreadable');
    await owner.posts.reopen(postId);
    assertSameList(await savedIds(reader), [postId], 'saved list once the post is readable again');
  },
};

const postDeleteCascades: ContractCase<Ctx> = {
  name: 'deleting the post removes its bookmarks (FR-POST-022 AC6)',
  async run(ctx) {
    const owner = await ctx.newActor();
    const reader = await ctx.newActor();
    const postId = await publicPostOf(owner, ctx);
    await owner.saved.savePost(postId);
    await reader.saved.savePost(postId);
    await owner.posts.delete(postId);
    assertEqual(await owner.saved.isPostSaved(postId), false, "owner's isPostSaved after the post is deleted");
    assertEqual(await reader.saved.isPostSaved(postId), false, "reader's isPostSaved after the post is deleted");
    assertTrue((await savedIds(reader)).length === 0, "reader's saved list after the post is deleted");
  },
};

/** Every case an ISavedPostsRepository implementation must pass. */
export function savedPostsRepositoryContract(): ContractCase<SavedPostsContractContext>[] {
  return [
    saveThenRead,
    saveIsIdempotent,
    unsaveRemovesBookmark,
    listNewestFirstPaged,
    bookmarksArePerUser,
    unreadablePostRefused,
    unreadableOmittedBookmarkKept,
    postDeleteCascades,
  ];
}
