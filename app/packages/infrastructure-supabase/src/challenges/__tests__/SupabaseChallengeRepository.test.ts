import { describe, expect, it } from 'vitest';
import { BackendUnavailableError, ChallengeError, type ChallengeDraft } from '@kc/domain';
import { callsTo, createFakeClient, type FakeClientConfig } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseChallengeRepository } from '../SupabaseChallengeRepository';

function makeRepo(config: FakeClientConfig) {
  const { client, calls } = createFakeClient(config);
  return { repo: new SupabaseChallengeRepository(client), calls };
}

const summary = {
  id: 'c1',
  post_id: 'p1',
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
const cursor = { n: 4, t: '2026-11-03T10:00:00Z', id: 'c1' };

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

describe('SupabaseChallengeRepository · reads', () => {
  it('maps a keyset page of challenges and hands back the cursor of a full page', async () => {
    const { repo, calls } = makeRepo({ rpc: { list_challenges: ok([{ challenge: summary, next_cursor: cursor }]) } });
    const page = await repo.listChallenges('discover', null, 1);
    expect(callsTo(calls, 'list_challenges')[0]?.args).toEqual({ p_view: 'discover', p_cursor: undefined, p_limit: 1 });
    expect(page.challenges[0]).toMatchObject({
      challengeId: 'c1',
      postId: 'p1',
      creatorDisplayName: 'Dana',
      goalValue: 10,
      goalDirection: 'at_least',
      difficulty: null,
      myCurrentStreak: 3,
      joined: true,
    });
    expect(page.nextCursor).toBe(JSON.stringify(cursor));
  });

  it('sends the previous cursor back and ends on a short page', async () => {
    const { repo, calls } = makeRepo({ rpc: { list_challenges: ok([{ challenge: summary, next_cursor: cursor }]) } });
    const page = await repo.listChallenges('joined', JSON.stringify(cursor), 20);
    expect(callsTo(calls, 'list_challenges')[0]?.args).toEqual({ p_view: 'joined', p_cursor: cursor, p_limit: 20 });
    expect(page.nextCursor).toBeNull();
  });

  it('returns null for a challenge the caller cannot see', async () => {
    const { repo } = makeRepo({ rpc: { get_challenge: ok([]) } });
    await expect(repo.getChallenge('missing')).resolves.toBeNull();
  });

  it('reads the caller\'s own reports from the table, newest cycle first', async () => {
    const entry = { cycle_start: '2026-11-04', value: '12.00', note: null, goal_met: true, reported_at: '2026-11-04T08:00:00Z' };
    const { repo, calls } = makeRepo({ tables: { challenge_progress_entries: ok([entry]) } });
    await expect(repo.listMyEntries('c1', 14)).resolves.toEqual([
      { cycleStart: '2026-11-04', value: 12, note: null, goalMet: true, reportedAt: '2026-11-04T08:00:00Z' },
    ]);
    expect(callsTo(calls, 'challenge_progress_entries')[0]?.filters).toEqual([
      ['eq', 'challenge_id', 'c1'],
      ['order', 'cycle_start', { ascending: false }],
      ['limit', 14],
    ]);
  });

  it('maps the leaderboard without any karma field', async () => {
    const row = {
      user_id: 'u1', display_name: 'Dana', avatar_url: null, current_streak: 3, best_streak: 5,
      successful_cycles: 8, completed: false, is_me: true,
    };
    const { repo } = makeRepo({ rpc: { list_challenge_leaderboard: ok([row]) } });
    await expect(repo.listLeaderboard('c1')).resolves.toEqual([
      { userId: 'u1', displayName: 'Dana', currentStreak: 3, bestStreak: 5, successfulCycles: 8, completed: false, isMe: true },
    ]);
  });
});

describe('SupabaseChallengeRepository · writes', () => {
  it('sends the draft to create_challenge with undefined for empty optionals', async () => {
    const { repo, calls } = makeRepo({ rpc: { create_challenge: ok('new-id') } });
    await expect(repo.createChallenge(draft)).resolves.toBe('new-id');
    expect(callsTo(calls, 'create_challenge')[0]?.args).toMatchObject({
      p_title: '10 pages',
      p_scope: 'community',
      p_goal_value: 10,
      p_goal_direction: 'at_least',
      p_description: undefined,
      p_ends_at: undefined,
    });
  });

  it('joins with the challenge id only', async () => {
    const { repo, calls } = makeRepo({ rpc: { join_challenge: ok(null) } });
    await repo.joinChallenge('c1');
    expect(callsTo(calls, 'join_challenge')[0]?.args).toEqual({ p_challenge_id: 'c1' });
  });

  it('parses the progress report document', async () => {
    const report = { cycle_start: '2026-11-04', goal_met: true, current_streak: 2, best_streak: 4, successful_cycles: 6, completed: true };
    const { repo } = makeRepo({ rpc: { report_challenge_progress: ok(report) } });
    await expect(repo.reportProgress('c1', 12, null, null)).resolves.toEqual({
      cycleStart: '2026-11-04', goalMet: true, currentStreak: 2, bestStreak: 4, successfulCycles: 6, completed: true, karmaPoints: 0,
    });
  });
});

describe('SupabaseChallengeRepository · errors', () => {
  it('turns the server\'s stable refusals into ChallengeError codes', async () => {
    const { repo } = makeRepo({ rpc: { join_challenge: fail('P0001', 'already_joined'), create_challenge: fail('P0001', 'city_required') } });
    await expect(repo.joinChallenge('c1')).rejects.toMatchObject({ constructor: ChallengeError, code: 'already_joined' });
    await expect(repo.createChallenge(draft)).rejects.toMatchObject({ code: 'city_required' });
  });

  it('maps a signed-out caller to auth_required', async () => {
    const { repo } = makeRepo({ rpc: { leave_challenge: fail('42501', 'unauthenticated') } });
    await expect(repo.leaveChallenge('c1')).rejects.toMatchObject({ code: 'auth_required' });
  });

  it('maps the goal-shape CHECK violation and keeps unknown errors as errors', async () => {
    const message = 'new row for relation "challenges" violates check constraint "challenges_goal_shape_chk"';
    const { repo: shape } = makeRepo({ rpc: { create_challenge: fail('23514', message) } });
    await expect(shape.createChallenge(draft)).rejects.toMatchObject({ code: 'goal_value_invalid' });

    const { repo: other } = makeRepo({ rpc: { end_challenge: fail('XX000', 'boom') } });
    const error = await other.endChallenge('c1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ChallengeError);
  });

  it('reports a missing function as unavailable', async () => {
    const { repo } = makeRepo({ rpc: { get_challenge: fail('PGRST202', 'not found') } });
    await expect(repo.getChallenge('c1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
