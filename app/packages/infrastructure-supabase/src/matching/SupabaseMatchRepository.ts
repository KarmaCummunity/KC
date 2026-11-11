// "Matches for you" (matching v2): the caller's pairs + accept/decline. The engine runs inside the
// database (a post is matched when it is published or changed); the client only reads its own
// pairs, as the other member's post card, and answers them.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

export type MatchRole = 'offer' | 'request';
export type MatchStatus = 'suggested' | 'accepted';
export type MatchResponse = 'accepted' | 'declined';

export interface MatchSuggestion {
  readonly candidateId: string;
  readonly status: MatchStatus;
  /** 0..1 (LLM-blended when the re-rank flag is on). */
  readonly score: number;
  readonly distanceKm: number | null;
  readonly worldSlug: string;
  readonly myRole: MatchRole;
  readonly myListingId: string;
  readonly myListingTitle: string;
  readonly otherListingId: string;
  readonly otherListingTitle: string;
  readonly otherListingSummary: string | null;
  /** The other member; the ids are empty and the names null while the poster is masked (FR-POST-021). */
  readonly otherOwner: {
    readonly userId: string;
    readonly displayName: string | null;
    readonly avatarUrl: string | null;
    readonly shareHandle: string | null;
  };
  readonly myResponse: MatchResponse | null;
  readonly otherResponse: MatchResponse | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface MatchRespondResult {
  readonly status: string;
  readonly mutual: boolean;
}

/** KC#1122 / FR-ADMIN-029 — one world's match quality over the requested window. */
export interface MatchQualityByWorld {
  readonly worldSlug: string;
  readonly worldLabelHe: string;
  readonly worldLabelEn: string;
  readonly notifiedPairs: number;
  readonly responses: number;
  readonly accepted: number;
  /** accepted / responses; null when nobody answered yet. */
  readonly precisionProxy: number | null;
  readonly chatPairs: number;
  /** chat pairs / notified pairs; null when nothing was notified. */
  readonly chatRate: number | null;
  /** null for worlds that do not hand off through handoffs. */
  readonly completedPairs: number | null;
  readonly completionRate: number | null;
}

type Row = Database['public']['Functions']['my_matches']['Returns'][number];
type QualityRow = Database['public']['Functions']['admin_match_quality']['Returns'][number];

/** A rate column: PostgREST returns numerics as strings, and null when the denominator is zero. */
const rate = (value: number | string | null): number | null => (value === null ? null : Number(value));

/** One `admin_match_quality` row. */
export function mapQualityRow(r: QualityRow): MatchQualityByWorld {
  return {
    worldSlug: r.world_slug,
    worldLabelHe: r.world_label_he,
    worldLabelEn: r.world_label_en,
    notifiedPairs: r.notified_pairs,
    responses: r.responses,
    accepted: r.accepted,
    precisionProxy: rate(r.precision_proxy),
    chatPairs: r.chat_pairs,
    chatRate: rate(r.chat_rate),
    completedPairs: r.completed_pairs,
    completionRate: rate(r.completion_rate),
  };
}

const asResponse = (v: string | null): MatchResponse | null => (v === 'accepted' || v === 'declined' ? v : null);

/** One `my_matches` row; PostgREST returns numerics as strings, so the numbers are converted. */
export function mapMatchRow(r: Row): MatchSuggestion {
  const other = r.other_post;
  return {
    candidateId: r.match_id,
    status: r.status === 'accepted' ? 'accepted' : 'suggested',
    score: Number(r.score ?? 0),
    distanceKm: r.distance_km == null ? null : Number(r.distance_km),
    worldSlug: r.world_slug,
    myRole: r.my_role === 'offer' ? 'offer' : 'request',
    myListingId: r.my_post_id,
    myListingTitle: r.my_post_title,
    otherListingId: other.id ?? '',
    otherListingTitle: other.title ?? '',
    otherListingSummary: other.description ?? null,
    otherOwner: {
      userId: other.owner_id ?? '',
      displayName: other.owner_display_name ?? null,
      avatarUrl: other.owner_avatar_url ?? null,
      shareHandle: other.owner_share_handle ?? null,
    },
    myResponse: asResponse(r.my_response),
    otherResponse: asResponse(r.other_response),
    reason: r.llm_reason ?? null,
    createdAt: r.created_at,
  };
}

export class SupabaseMatchRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listMine(limit = 20): Promise<MatchSuggestion[]> {
    const rows = unwrapCall('rpc:my_matches', await this.client.rpc('my_matches', { p_limit: limit }));
    return (rows ?? []).map(mapMatchRow);
  }

  /** Answers a pair; `mutual` is true when both owners have now accepted. */
  async respond(candidateId: string, response: 'accept' | 'decline'): Promise<MatchRespondResult> {
    const status = unwrapCall(
      'rpc:match_respond',
      await this.client.rpc('match_respond', { p_match_id: candidateId, p_accept: response === 'accept' }),
    );
    return { status: status ?? '', mutual: status === 'accepted' };
  }

  /** Match quality per world over the last `days` (moderators and above; the server clamps 1..365). */
  async qualityByWorld(days = 30): Promise<MatchQualityByWorld[]> {
    const rows = unwrapCall('rpc:admin_match_quality', await this.client.rpc('admin_match_quality', { p_days: days }));
    return (rows ?? []).map(mapQualityRow);
  }
}
