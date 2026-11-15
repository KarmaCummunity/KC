// The closed tab of a profile (FR-PROFILE-001 AC4, FR-PROFILE-002 AC2, FR-POST-017 AC1, FR-POST-021).
//
// Standard list: `profile_posts_page(tab => 'closed')` — the member's delivered posts and, on their own
// profile, the posts they deleted without a recipient. Row-level security narrows it to what the
// viewer may read and the server masks a poster who asked to stay anonymous. The baseline lists a
// member's own posts only, so every item is a `publisher` item.
// Hidden screen (`owner_only_me`): the owner's "only me" posts that were delivered or deleted.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfileClosedPostsPage } from '@kc/application';
import type { ProfileClosedPostsListMode } from '@kc/domain';
import type { Database } from '../database.types';
import { listOwnerPostsPage } from './getMyPostsPage';
import { fetchProfileTabPage, type PostsPage } from './postCardPages';

function toClosedPage(page: PostsPage): ProfileClosedPostsPage {
  return {
    items: page.posts.map((post) => ({ post, identityRole: 'publisher', closedAt: post.createdAt })),
    nextCursor: page.nextCursor,
  };
}

export async function getProfileClosedPostsHelper(
  client: SupabaseClient<Database>,
  profileUserId: string,
  limit: number,
  cursor?: string,
  listMode: ProfileClosedPostsListMode = 'standard',
): Promise<ProfileClosedPostsPage> {
  if (listMode === 'owner_only_me') {
    const filter = { statuses: ['closed_delivered', 'deleted_no_recipient'], visibility: 'OnlyMe' } as const;
    return toClosedPage(await listOwnerPostsPage(client, profileUserId, filter, limit, cursor));
  }
  return toClosedPage(await fetchProfileTabPage(client, profileUserId, 'closed', limit, cursor));
}
