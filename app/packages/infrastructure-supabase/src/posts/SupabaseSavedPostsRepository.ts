// FR-POST-022 — adapter for ISavedPostsRepository.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ISavedPostsRepository } from '@kc/application';
import type { Post } from '@kc/domain';
import type { Database } from '../database.types';
import {
  isPostSavedRow,
  listSavedPostsPage,
  savePostRow,
  unsavePostRow,
} from './savedPostsMethods';

export class SupabaseSavedPostsRepository implements ISavedPostsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  savePost(postId: string): Promise<void> {
    return savePostRow(this.client, postId);
  }

  unsavePost(postId: string): Promise<void> {
    return unsavePostRow(this.client, postId);
  }

  isPostSaved(postId: string): Promise<boolean> {
    return isPostSavedRow(this.client, postId);
  }

  listSavedPosts(
    limit: number,
    cursor?: string,
  ): Promise<{ posts: Post[]; nextCursor: string | null }> {
    return listSavedPostsPage(this.client, limit, cursor);
  }
}
