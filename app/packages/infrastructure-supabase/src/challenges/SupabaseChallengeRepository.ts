import type { SupabaseClient } from '@supabase/supabase-js';
import type { IChallengeRepository } from '@kc/application';
import {
  BackendUnavailableError,
  ChallengeError,
  type ChallengeDraft,
  type ChallengeEntry,
  type ChallengeErrorCode,
  type ChallengeLeaderboardRow,
  type ChallengeListCursor,
  type ChallengeListView,
  type ChallengePage,
  type ChallengeProgressResult,
  type ChallengeSummary,
} from '@kc/domain';
import type { Database, Json } from '../database.types';
import { unwrapCall, type CallResult } from '../rpc/mapRpcError';
import { refusalReason } from '../admin/refusalReason';

type SummaryRow = Database['public']['CompositeTypes']['challenge_summary'];
type EntryRow = Pick<
  Database['public']['Tables']['challenge_progress_entries']['Row'],
  'cycle_start' | 'value' | 'note' | 'goal_met' | 'reported_at'
>;
type LeaderboardRow = Database['public']['Functions']['list_challenge_leaderboard']['Returns'][number];

/**
 * Stable refusals of the challenge RPCs (supabase/schemas/74_challenges) that are a
 * `ChallengeError` code as they are. `unauthenticated` is the signed-out refusal of every RPC.
 */
const SERVER_ERROR_CODES: ReadonlySet<string> = new Set<ChallengeErrorCode>([
  'invalid_input',
  'city_required',
  'challenge_world_not_configured',
  'challenge_not_found',
  'challenge_not_active',
  'not_participant',
  'already_joined',
  'creator_cannot_leave',
  'report_date_out_of_window',
]);

/** The goal-shape CHECK is the database backstop of the domain's goal rules. */
const GOAL_SHAPE_CONSTRAINT = 'challenges_goal_shape';

/**
 * Turns a failed call into a `ChallengeError` when the server refused with one of the codes
 * above; a missing backend object stays a `BackendUnavailableError`, anything else is kept.
 */
function toChallengeError(error: unknown): unknown {
  if (error instanceof BackendUnavailableError) return error;
  const reason = refusalReason(error);
  if (reason === 'unauthenticated') return new ChallengeError('auth_required');
  if (reason !== null && SERVER_ERROR_CODES.has(reason)) return new ChallengeError(reason as ChallengeErrorCode);
  if (error instanceof Error && error.message.includes(GOAL_SHAPE_CONSTRAINT)) {
    return new ChallengeError('goal_value_invalid');
  }
  return error;
}

function mapSummary(row: SummaryRow): ChallengeSummary {
  return {
    challengeId: row.id ?? '',
    postId: row.post_id ?? '',
    creatorId: row.creator_id ?? '',
    creatorDisplayName: row.creator_display_name ?? '',
    title: row.title ?? '',
    description: row.description ?? null,
    scope: row.scope as ChallengeSummary['scope'],
    measurement: row.measurement as ChallengeSummary['measurement'],
    cadence: row.cadence as ChallengeSummary['cadence'],
    goalValue: row.goal_value ?? null,
    goalDirection: (row.goal_direction ?? null) as ChallengeSummary['goalDirection'],
    difficulty: (row.difficulty ?? null) as ChallengeSummary['difficulty'],
    topicLabel: row.topic_label ?? null,
    endsAt: row.ends_at ?? null,
    targetCycles: row.target_cycles ?? null,
    status: row.status as ChallengeSummary['status'],
    participantsCount: row.participants_count ?? 0,
    createdAt: row.created_at ?? '',
    joined: row.joined === true,
    myCurrentStreak: row.my_current_streak ?? 0,
    myBestStreak: row.my_best_streak ?? 0,
    mySuccessfulCycles: row.my_successful_cycles ?? 0,
    myCompleted: row.my_completed === true,
  };
}

function mapEntry(row: EntryRow): ChallengeEntry {
  return {
    cycleStart: row.cycle_start,
    value: Number(row.value),
    note: row.note ?? null,
    goalMet: row.goal_met,
    reportedAt: row.reported_at,
  };
}

function mapLeaderboardRow(row: LeaderboardRow): ChallengeLeaderboardRow {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
    successfulCycles: row.successful_cycles,
    completed: row.completed,
    isMe: row.is_me,
  };
}

/** `report_challenge_progress` returns a jsonb document; read it defensively. */
function parseProgressResult(data: unknown): ChallengeProgressResult {
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    cycleStart: String(o.cycle_start),
    goalMet: o.goal_met === true,
    currentStreak: Number(o.current_streak ?? 0),
    bestStreak: Number(o.best_streak ?? 0),
    successfulCycles: Number(o.successful_cycles ?? 0),
    completed: o.completed === true,
    // The baseline pays challenge karma asynchronously (outbox); the report does not carry it.
    karmaPoints: Number(o.karma_points ?? 0),
  };
}

/** A page of `list_challenges` rows: each carries the cursor that continues after it. */
function toPage(rows: readonly { challenge: SummaryRow; next_cursor: Json }[], limit: number): ChallengePage {
  const last = rows[rows.length - 1];
  return {
    challenges: rows.map((row) => mapSummary(row.challenge)),
    nextCursor: last && rows.length >= limit ? JSON.stringify(last.next_cursor) : null,
  };
}

/** Challenge engine on the baseline (docs/spec/10_challenges.md, supabase/schemas/74_challenges). */
export class SupabaseChallengeRepository implements IChallengeRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** Runs one call and maps every failure with {@link toChallengeError}. */
  private async call<T>(object: string, run: () => PromiseLike<CallResult<T>>): Promise<T> {
    try {
      return unwrapCall(object, await run());
    } catch (error) {
      throw toChallengeError(error);
    }
  }

  async createChallenge(draft: ChallengeDraft): Promise<string> {
    const id = await this.call('rpc:create_challenge', () =>
      this.client.rpc('create_challenge', {
        p_title: draft.title,
        p_description: draft.description ?? undefined,
        p_scope: draft.scope,
        p_measurement: draft.measurement,
        p_cadence: draft.cadence,
        p_goal_value: draft.goalValue ?? undefined,
        p_goal_direction: draft.goalDirection ?? undefined,
        p_difficulty: draft.difficulty ?? undefined,
        p_topic_label: draft.topicLabel ?? undefined,
        p_ends_at: draft.endsAt ?? undefined,
        p_target_cycles: draft.targetCycles ?? undefined,
      }),
    );
    return String(id);
  }

  async listChallenges(view: ChallengeListView, cursor: ChallengeListCursor | null = null, limit = 20) {
    const rows = await this.call('rpc:list_challenges', () =>
      this.client.rpc('list_challenges', {
        p_view: view,
        p_cursor: cursor ? (JSON.parse(cursor) as Json) : undefined,
        p_limit: limit,
      }),
    );
    return toPage(rows ?? [], limit);
  }

  async getChallenge(challengeId: string) {
    const rows = await this.call('rpc:get_challenge', () =>
      this.client.rpc('get_challenge', { p_challenge_id: challengeId }),
    );
    const row = rows?.[0];
    return row ? mapSummary(row) : null;
  }

  async joinChallenge(challengeId: string) {
    await this.call('rpc:join_challenge', () => this.client.rpc('join_challenge', { p_challenge_id: challengeId }));
  }

  async leaveChallenge(challengeId: string) {
    await this.call('rpc:leave_challenge', () => this.client.rpc('leave_challenge', { p_challenge_id: challengeId }));
  }

  async endChallenge(challengeId: string) {
    await this.call('rpc:end_challenge', () => this.client.rpc('end_challenge', { p_challenge_id: challengeId }));
  }

  async reportProgress(challengeId: string, value: number, note: string | null, reportDate: string | null) {
    const data = await this.call('rpc:report_challenge_progress', () =>
      this.client.rpc('report_challenge_progress', {
        p_challenge_id: challengeId,
        p_value: value,
        p_note: note ?? undefined,
        p_report_date: reportDate ?? undefined,
      }),
    );
    return parseProgressResult(data);
  }

  /**
   * The caller's own reports, newest cycle first. Row level security returns only the caller's
   * rows (policy `challenge_progress_entries_select_own`), so no member filter is needed.
   */
  async listMyEntries(challengeId: string, limit = 60) {
    const rows = await this.call('table:challenge_progress_entries', () =>
      this.client
        .from('challenge_progress_entries')
        .select('cycle_start, value, note, goal_met, reported_at')
        .eq('challenge_id', challengeId)
        .order('cycle_start', { ascending: false })
        .limit(limit),
    );
    return (rows ?? []).map(mapEntry);
  }

  async listLeaderboard(challengeId: string, limit = 20) {
    const rows = await this.call('rpc:list_challenge_leaderboard', () =>
      this.client.rpc('list_challenge_leaderboard', { p_challenge_id: challengeId, p_limit: limit }),
    );
    return (rows ?? []).map(mapLeaderboardRow);
  }
}
