// What a `post_card` leaves out and the screens still show, loaded for a whole page at once:
// the approximate map point, the street the poster chose to show (migration 0029), the detected
// language, the status an admin removal will restore, the
// challenge a post belongs to, the restore window of a deleted post, and the recipient of a
// delivered post. One query per source for the page (never one per post); a source is skipped
// when no card of the page can use it.
//
// All reads run with the caller's rights: the recipient is visible only to the two members of the
// handoff, the restore window only to the owner, and nobody else gets a value (the card then
// simply shows no recipient, which is the baseline's privacy rule, not a gap).

import type { SupabaseClient } from '@supabase/supabase-js';
import { toVerificationLevel } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import type { CardExtras, CardRecipient, PostCardRow } from './mapPostRow';

type Client = SupabaseClient<Database>;

const idsWhere = (cards: readonly PostCardRow[], keep: (card: PostCardRow) => boolean): string[] =>
  cards.flatMap((card) => (card.id !== null && keep(card) ? [card.id] : []));

async function loadPostColumns(client: Client, ids: string[]) {
  const rows = unwrapCall(
    'table:posts',
    await client
      .from('posts')
      .select('id, geo_approx, source_language, status_before_removal, shown_street, shown_street_number')
      .in('id', ids),
  );
  return new Map((rows ?? []).map((row) => [row.id, row]));
}

async function loadChallengeIds(client: Client, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = unwrapCall('table:challenges', await client.from('challenges').select('id, post_id').in('post_id', ids));
  return new Map((rows ?? []).map((row) => [row.post_id, row.id]));
}

async function loadPurgeDeadlines(client: Client, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = unwrapCall(
    'table:post_closures',
    await client.from('post_closures').select('post_id, purge_after').in('post_id', ids),
  );
  const deadlines = new Map<string, string>();
  for (const row of rows ?? []) if (row.purge_after) deadlines.set(row.post_id, row.purge_after);
  return deadlines;
}

async function loadRecipients(client: Client, ids: string[]): Promise<Map<string, CardRecipient>> {
  if (ids.length === 0) return new Map();
  const handoffs = unwrapCall(
    'table:post_handoffs',
    await client
      .from('post_handoffs')
      .select('post_id, recipient_id, handed_over_at, updated_at')
      .eq('status', 'handed_over')
      .in('post_id', ids),
  );
  if (!handoffs || handoffs.length === 0) return new Map();
  const users = unwrapCall(
    'table:users',
    await client
      .from('users')
      .select('id, display_name, avatar_url, share_handle, verification_level')
      .in('id', [...new Set(handoffs.map((handoff) => handoff.recipient_id))]),
  );
  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const out = new Map<string, CardRecipient>();
  for (const handoff of handoffs) {
    const user = userById.get(handoff.recipient_id);
    if (!user) continue;
    out.set(handoff.post_id, {
      recipient: {
        postId: handoff.post_id,
        recipientUserId: handoff.recipient_id,
        markedAt: handoff.handed_over_at ?? handoff.updated_at,
      },
      user: {
        userId: user.id,
        displayName: user.display_name,
        shareHandle: user.share_handle,
        avatarUrl: user.avatar_url,
        verificationLevel: toVerificationLevel(user.verification_level),
      },
    });
  }
  return out;
}

/** The extras of every card of a page, keyed by post id. */
export async function loadCardExtras(
  client: Client,
  cards: readonly PostCardRow[],
): Promise<Map<string, CardExtras>> {
  const ids = idsWhere(cards, () => true);
  if (ids.length === 0) return new Map();
  const [columns, challenges, deadlines, recipients] = await Promise.all([
    loadPostColumns(client, ids),
    loadChallengeIds(client, idsWhere(cards, (card) => card.post_type === 'challenge')),
    loadPurgeDeadlines(client, idsWhere(cards, (card) => card.status === 'deleted_no_recipient')),
    loadRecipients(client, idsWhere(cards, (card) => card.status === 'closed_delivered')),
  ]);
  return new Map(
    ids.map((id) => [
      id,
      {
        geo: columns.get(id)?.geo_approx ?? null,
        shownStreet: columns.get(id)?.shown_street ?? null,
        shownStreetNumber: columns.get(id)?.shown_street_number ?? null,
        sourceLanguage: columns.get(id)?.source_language ?? null,
        statusBeforeRemoval: columns.get(id)?.status_before_removal ?? null,
        challengeId: challenges.get(id) ?? null,
        purgeAfter: deadlines.get(id) ?? null,
        recipient: recipients.get(id) ?? null,
      },
    ]),
  );
}
