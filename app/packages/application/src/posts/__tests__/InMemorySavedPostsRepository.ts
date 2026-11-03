// Behavioural in-memory ISavedPostsRepository (G39). Shares the InMemoryPostStore
// with InMemoryPostRepository so bookmarks see the same posts, and is held to the
// Supabase adapter by the shared contract (`contracts/savedPostsRepository.contract.ts`).
// Unlike FakeSavedPostsRepository (a spy with canned results for use-case tests),
// this fake models the table's rules: save only a readable post (policy
// `saved_posts_insert_self_visible`), idempotent save (primary key + ignore
// duplicates), per-user rows, newest-first paging and the join that drops
// posts the viewer can no longer read.

import type { Post } from '@kc/domain';
import type { ISavedPostsRepository } from '../../ports/ISavedPostsRepository';
import { PostError } from '../errors';
import { clonePost, isPostVisibleTo, savedKey, type InMemoryPostStore } from './inMemoryPostStore';

const PAGE_MAX = 100;

export class InMemorySavedPostsRepository implements ISavedPostsRepository {
  /** `actorId` plays `auth.uid()`: every row is read and written as this user. */
  constructor(
    private readonly store: InMemoryPostStore,
    private readonly actorId: string,
  ) {}

  async savePost(postId: string): Promise<void> {
    const post = this.store.posts.get(postId);
    if (!post || !isPostVisibleTo(post, this.actorId)) {
      throw new PostError('forbidden', 'savePost: post is not readable by the actor');
    }
    const key = savedKey(this.actorId, postId);
    if (this.store.savedPosts.has(key)) return;
    this.store.savedPosts.set(key, { userId: this.actorId, postId, savedAt: this.store.now() });
  }

  async unsavePost(postId: string): Promise<void> {
    this.store.savedPosts.delete(savedKey(this.actorId, postId));
  }

  async isPostSaved(postId: string): Promise<boolean> {
    return this.store.savedPosts.has(savedKey(this.actorId, postId));
  }

  async listSavedPosts(limit: number, cursor?: string): Promise<{ posts: Post[]; nextCursor: string | null }> {
    const safeLimit = Math.max(1, Math.min(limit, PAGE_MAX));
    const rows = [...this.store.savedPosts.values()]
      .filter((row) => row.userId === this.actorId)
      .filter((row) => (cursor ? row.savedAt < cursor : true))
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
    const page = rows.slice(0, safeLimit);
    // The join to posts is RLS-filtered: an unreadable post leaves its bookmark without a payload.
    const posts = page
      .map((row) => this.store.posts.get(row.postId))
      .filter((post): post is Post => post !== undefined && isPostVisibleTo(post, this.actorId))
      .map(clonePost);
    const last = page[page.length - 1];
    // The adapter's cursor is opaque to callers; here it is the last savedAt.
    const nextCursor = rows.length > safeLimit && last ? last.savedAt : null;
    return { posts, nextCursor };
  }
}
