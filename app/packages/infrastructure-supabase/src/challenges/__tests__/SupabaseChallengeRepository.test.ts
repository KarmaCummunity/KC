import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChallengeError, type ChallengeDraft } from '@kc/domain';
import { SupabaseChallengeRepository } from '../SupabaseChallengeRepository';

type Result = { data: unknown; error: { message: string } | null };

function makeRepo(results: Record<string, Result>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return results[fn] ?? { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { repo: new SupabaseChallengeRepository(client as never), calls };
}

const summaryRow = {
  challenge_id: 'c1',
  creator_id: 'u1',
  creator_display_name: 'Dana',
  title: '10 pages',
  description: null,
  scope: 'community',
  measurement: 'count',
  cadence: 'daily',
  goal_value: 10,
  goal_direction: 'at_least',
  difficulty: null,
  topic_label: 'learning',
  ends_at: null,
  target_cycles: 30,
  status: 'active',
  participants_count: 4,
  created_at: '2026-11-03T10:00:00Z',
  joined: true,
  my_current_streak: 3,
  my_best_streak: 5,
  my_successful_cycles: 8,
  my_completed: false,
};

const draft: ChallengeDraft = {
  title: '10 pages',
  description: null,
  scope: 'community',
  measurement: 'count',
  cadence: 'daily',
  goalValue: 10,
  goalDirection: 'at_least',
  difficulty: null,
  topicLabel: null,
  endsAt: null,
  targetCycles: null,
};

describe('SupabaseChallengeRepository', () => {
  it('maps a listed challenge to the domain summary and passes paging', async () => {
    const { repo, calls } = makeRepo({ list_challenges: { data: [summaryRow], error: null } });
    const [summary] = await repo.listChallenges('discover', 10, 20);
    expect(calls[0]).toEqual({ fn: 'list_challenges', args: { p_view: 'discover', p_limit: 10, p_offset: 20 } });
    expect(summary).toMatchObject({
      challengeId: 'c1',
      creatorDisplayName: 'Dana',
      goalValue: 10,
      goalDirection: 'at_least',
      difficulty: null,
      description: null,
      myCurrentStreak: 3,
      joined: true,
    });
  });

  it('returns null for a challenge the caller cannot see', async () => {
    const { repo } = makeRepo({ get_challenge: { data: [], error: null } });
    await expect(repo.getChallenge('missing')).resolves.toBeNull();
  });

  it('sends the draft to create_challenge with undefined for empty optionals', async () => {
    const { repo, calls } = makeRepo({ create_challenge: { data: 'new-id', error: null } });
    await expect(repo.createChallenge(draft)).resolves.toBe('new-id');
    expect(calls[0]?.args).toMatchObject({
      p_title: '10 pages',
      p_scope: 'community',
      p_goal_value: 10,
      p_goal_direction: 'at_least',
      p_description: undefined,
      p_ends_at: undefined,
    });
  });

  it('parses the progress report document', async () => {
    const { repo } = makeRepo({
      report_challenge_progress: {
        data: {
          cycle_start: '2026-11-04',
          goal_met: true,
          current_streak: 2,
          best_streak: 4,
          successful_cycles: 6,
          completed: true,
          karma_points: 17,
        },
        error: null,
      },
    });
    await expect(repo.reportProgress('c1', 12, null, null)).resolves.toEqual({
      cycleStart: '2026-11-04',
      goalMet: true,
      currentStreak: 2,
      bestStreak: 4,
      successfulCycles: 6,
      completed: true,
      karmaPoints: 17,
    });
  });

  it('maps the leaderboard without any karma field', async () => {
    const { repo } = makeRepo({
      list_challenge_leaderboard: {
        data: [
          {
            user_id: 'u1',
            display_name: 'Dana',
            current_streak: 3,
            best_streak: 5,
            successful_cycles: 8,
            completed: false,
            is_me: true,
          },
        ],
        error: null,
      },
    });
    const [row] = await repo.listLeaderboard('c1');
    expect(row).toEqual({
      userId: 'u1',
      displayName: 'Dana',
      currentStreak: 3,
      bestStreak: 5,
      successfulCycles: 8,
      completed: false,
      isMe: true,
    });
  });

  it('turns the server\'s stable error messages into ChallengeError codes', async () => {
    const { repo } = makeRepo({ join_challenge: { data: null, error: { message: 'already_joined' } } });
    await expect(repo.joinChallenge('c1')).rejects.toMatchObject({ code: 'already_joined' });
    await expect(repo.joinChallenge('c1')).rejects.toBeInstanceOf(ChallengeError);
  });

  it('maps the goal-shape CHECK violation and keeps unknown errors as they are', async () => {
    const { repo: shape } = makeRepo({
      create_challenge: {
        data: null,
        error: { message: 'new row for relation "challenges" violates check constraint "challenges_goal_shape"' },
      },
    });
    await expect(shape.createChallenge(draft)).rejects.toMatchObject({ code: 'goal_value_invalid' });

    const { repo: other } = makeRepo({ end_challenge: { data: null, error: { message: 'boom' } } });
    await expect(other.endChallenge('c1')).rejects.toEqual({ message: 'boom' });
  });
});
