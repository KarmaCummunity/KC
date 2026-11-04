import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { IChallengeRepository } from '@kc/application';
import {
  ChallengeError,
  type ChallengeDraft,
  type ChallengeEntry,
  type ChallengeErrorCode,
  type ChallengeLeaderboardRow,
  type ChallengeProgressResult,
  type ChallengeSummary,
} from '@kc/domain';
import type { Database } from '../database.types';

type SummaryRow = Database['public']['Functions']['list_challenges']['Returns'][number];
type EntryRow = Database['public']['Functions']['list_my_challenge_entries']['Returns'][number];
type LeaderboardRow = Database['public']['Functions']['list_challenge_leaderboard']['Returns'][number];

/** Error messages the challenge RPCs raise on purpose (migration 0594); each is a stable code. */
const SERVER_ERROR_CODES: ReadonlySet<string> = new Set<ChallengeErrorCode>([
  'auth_required',
  'challenge_not_found',
  'challenge_not_active',
  'challenge_ended',
  'not_participant',
  'already_joined',
  'creator_cannot_leave',
  'not_challenge_creator',
  'report_date_out_of_window',
  'ends_at_invalid',
  'value_invalid',
]);

/** Turns a PostgREST failure into a `ChallengeError` when it is one of ours; otherwise keeps it. */
function toChallengeError(error: PostgrestError): Error {
  if (SERVER_ERROR_CODES.has(error.message)) {
    return new ChallengeError(error.message as ChallengeErrorCode);
  }
  // The goal-shape CHECK is the database backstop of the domain's goal rules.
  if (error.message.includes('challenges_goal_shape')) return new ChallengeError('goal_value_invalid');
  return error;
}

function mapSummary(row: SummaryRow): ChallengeSummary {
  return {
    challengeId: row.challenge_id,
    creatorId: row.creator_id,
    creatorDisplayName: row.creator_display_name,
    title: row.title,
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
    participantsCount: row.participants_count,
    createdAt: row.created_at,
    joined: row.joined,
    myCurrentStreak: row.my_current_streak,
    myBestStreak: row.my_best_streak,
    mySuccessfulCycles: row.my_successful_cycles,
    myCompleted: row.my_completed,
  };
}

function mapEntry(row: EntryRow): ChallengeEntry {
  return {
    cycleStart: row.cycle_start,
    value: row.value,
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
    karmaPoints: Number(o.karma_points ?? 0),
  };
}

export class SupabaseChallengeRepository implements IChallengeRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async createChallenge(draft: ChallengeDraft): Promise<string> {
    const { data, error } = await this.client.rpc('create_challenge', {
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
    });
    if (error || !data) throw error ? toChallengeError(error) : new Error('create_challenge failed');
    return String(data);
  }

  async listChallenges(view: Parameters<IChallengeRepository['listChallenges']>[0], limit = 30, offset = 0) {
    const { data, error } = await this.client.rpc('list_challenges', {
      p_view: view,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw toChallengeError(error);
    return (data ?? []).map(mapSummary);
  }

  async getChallenge(challengeId: string) {
    const { data, error } = await this.client.rpc('get_challenge', { p_challenge_id: challengeId });
    if (error) throw toChallengeError(error);
    const row = data?.[0];
    return row ? mapSummary(row) : null;
  }

  async joinChallenge(challengeId: string) {
    const { error } = await this.client.rpc('join_challenge', { p_challenge_id: challengeId });
    if (error) throw toChallengeError(error);
  }

  async leaveChallenge(challengeId: string) {
    const { error } = await this.client.rpc('leave_challenge', { p_challenge_id: challengeId });
    if (error) throw toChallengeError(error);
  }

  async endChallenge(challengeId: string) {
    const { error } = await this.client.rpc('end_challenge', { p_challenge_id: challengeId });
    if (error) throw toChallengeError(error);
  }

  async reportProgress(challengeId: string, value: number, note: string | null, reportDate: string | null) {
    const { data, error } = await this.client.rpc('report_challenge_progress', {
      p_challenge_id: challengeId,
      p_value: value,
      p_note: note ?? undefined,
      p_report_date: reportDate ?? undefined,
    });
    if (error) throw toChallengeError(error);
    return parseProgressResult(data);
  }

  async listMyEntries(challengeId: string, limit = 60) {
    const { data, error } = await this.client.rpc('list_my_challenge_entries', {
      p_challenge_id: challengeId,
      p_limit: limit,
    });
    if (error) throw toChallengeError(error);
    return (data ?? []).map(mapEntry);
  }

  async listLeaderboard(challengeId: string, limit = 20) {
    const { data, error } = await this.client.rpc('list_challenge_leaderboard', {
      p_challenge_id: challengeId,
      p_limit: limit,
    });
    if (error) throw toChallengeError(error);
    return (data ?? []).map(mapLeaderboardRow);
  }
}
