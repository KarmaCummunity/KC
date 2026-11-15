import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminReportTargetType } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

export interface ReportTargetRef {
  readonly targetType: AdminReportTargetType;
  readonly targetId: string;
}

/** Preview of one target, shaped for the staff cards (snake_case keys, as the cards read them). */
export type TargetPreview = Readonly<Record<string, unknown>>;

/** Key of a target in the map `loadTargetPreviews` returns. */
export const previewKey = (ref: ReportTargetRef): string => `${ref.targetType}:${ref.targetId}`;

/** How many characters of a post or comment text a preview carries. */
const PREVIEW_CHARS = 140;

const clip = (text: string | null): string | null => {
  if (text === null) return null;
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
};

const idsOf = (refs: readonly ReportTargetRef[], type: AdminReportTargetType): string[] =>
  refs.filter((r) => r.targetType === type).map((r) => r.targetId);

type Client = SupabaseClient<Database>;

async function postPreviews(client: Client, ids: string[], out: Map<string, TargetPreview>): Promise<void> {
  if (ids.length === 0) return;
  // `posts_select_staff`: staff read posts in every status, removed ones included.
  const rows = unwrapCall(
    'table:posts',
    await client.from('posts').select('id, title, description, status, owner_id, created_at').in('id', ids),
  );
  for (const p of rows ?? []) {
    out.set(previewKey({ targetType: 'post', targetId: p.id }), {
      preview: clip(p.title ?? p.description),
      status: p.status,
      author_id: p.owner_id,
      created_at: p.created_at,
    });
  }
}

async function userPreviews(client: Client, ids: string[], out: Map<string, TargetPreview>): Promise<void> {
  if (ids.length === 0) return;
  // `users_select_staff` and `user_account_select_staff`: members in every account state.
  const users = unwrapCall(
    'table:users',
    await client.from('users').select('id, display_name, created_at').in('id', ids),
  );
  const accounts = unwrapCall(
    'table:user_account',
    await client.from('user_account').select('user_id, status').in('user_id', ids),
  );
  const statusOf = new Map((accounts ?? []).map((a) => [a.user_id, a.status]));
  for (const u of users ?? []) {
    out.set(previewKey({ targetType: 'user', targetId: u.id }), {
      display_name: u.display_name,
      status: statusOf.get(u.id) ?? null,
      created_at: u.created_at,
    });
  }
}

async function commentPreviews(client: Client, ids: string[], out: Map<string, TargetPreview>): Promise<void> {
  if (ids.length === 0) return;
  // `post_comments_select_staff`: deleted comments stay readable as evidence.
  const rows = unwrapCall(
    'table:post_comments',
    await client.from('post_comments').select('id, body, status, author_id, post_id, created_at').in('id', ids),
  );
  for (const c of rows ?? []) {
    out.set(previewKey({ targetType: 'comment', targetId: c.id }), {
      preview: clip(c.body),
      status: c.status,
      author_id: c.author_id,
      post_id: c.post_id,
      created_at: c.created_at,
    });
  }
}

async function chatPreviews(client: Client, ids: string[], out: Map<string, TargetPreview>): Promise<void> {
  if (ids.length === 0) return;
  // `chats_select_staff_reported` (0016): staff read the row of a reported chat, never its messages.
  const rows = unwrapCall(
    'table:chats',
    await client.from('chats').select('id, moderation_hidden_at, created_at').in('id', ids),
  );
  for (const c of rows ?? []) {
    out.set(previewKey({ targetType: 'chat', targetId: c.id }), {
      removed_at: c.moderation_hidden_at,
      created_at: c.created_at,
    });
  }
}

/**
 * Previews of the given targets under the staff read policies. A target with no readable row
 * (a purged post or chat) has no entry, and the caller falls back to an empty preview.
 */
export async function loadTargetPreviews(
  client: Client,
  refs: readonly ReportTargetRef[],
): Promise<Map<string, TargetPreview>> {
  const out = new Map<string, TargetPreview>();
  await Promise.all([
    postPreviews(client, idsOf(refs, 'post'), out),
    userPreviews(client, idsOf(refs, 'user'), out),
    commentPreviews(client, idsOf(refs, 'comment'), out),
    chatPreviews(client, idsOf(refs, 'chat'), out),
  ]);
  return out;
}

/** Display names of members by id, for reporter and actor labels. */
export async function loadDisplayNames(client: Client, ids: readonly string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = unwrapCall('table:users', await client.from('users').select('id, display_name').in('id', unique));
  return new Map((rows ?? []).map((u) => [u.id, u.display_name]));
}
