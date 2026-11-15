import { describe, expect, it, vi } from 'vitest';
import { ChallengeError, type ChallengeDraft, type ChallengeProgressInput } from '@kc/domain';
import type { IChallengeRepository } from '../../ports/IChallengeRepository';
import {
  CreateChallengeUseCase,
  ListChallengesUseCase,
  ReportChallengeProgressUseCase,
} from '../challengeUseCases';

const progressResult = {
  cycleStart: '2026-11-04',
  goalMet: true,
  currentStreak: 1,
  bestStreak: 1,
  successfulCycles: 1,
  completed: false,
  karmaPoints: 2,
};

function makeRepo(): IChallengeRepository {
  return {
    createChallenge: vi.fn(async () => 'challenge-1'),
    listChallenges: vi.fn(async () => ({ challenges: [], nextCursor: null })),
    getChallenge: vi.fn(async () => null),
    joinChallenge: vi.fn(async () => undefined),
    leaveChallenge: vi.fn(async () => undefined),
    endChallenge: vi.fn(async () => undefined),
    reportProgress: vi.fn(async () => progressResult),
    listMyEntries: vi.fn(async () => []),
    listLeaderboard: vi.fn(async () => []),
  };
}

const draft: ChallengeDraft = {
  title: '  Read 10 pages  ',
  description: null,
  scope: 'personal',
  measurement: 'count',
  cadence: 'daily',
  goalValue: 10,
  goalDirection: 'at_least',
  difficulty: null,
  topicLabel: null,
  endsAt: null,
  targetCycles: null,
};

describe('CreateChallengeUseCase', () => {
  it('sends the draft with a trimmed title and returns the new id', async () => {
    const repo = makeRepo();
    await expect(new CreateChallengeUseCase(repo).execute(draft)).resolves.toBe('challenge-1');
    expect(repo.createChallenge).toHaveBeenCalledWith({ ...draft, title: 'Read 10 pages' });
  });

  it('rejects an invalid draft without reaching the repository', async () => {
    const repo = makeRepo();
    await expect(new CreateChallengeUseCase(repo).execute({ ...draft, title: 'ab' })).rejects.toBeInstanceOf(
      ChallengeError,
    );
    expect(repo.createChallenge).not.toHaveBeenCalled();
  });
});

describe('ReportChallengeProgressUseCase', () => {
  const input: ChallengeProgressInput = {
    challengeId: 'challenge-1',
    measurement: 'count',
    value: 12,
    note: '   ',
    reportDate: null,
  };

  it('normalizes a blank note to null and returns the server result', async () => {
    const repo = makeRepo();
    await expect(new ReportChallengeProgressUseCase(repo).execute(input)).resolves.toEqual(progressResult);
    expect(repo.reportProgress).toHaveBeenCalledWith('challenge-1', 12, null, null);
  });

  it('rejects a malformed report without reaching the repository', async () => {
    const repo = makeRepo();
    const useCase = new ReportChallengeProgressUseCase(repo);
    await expect(useCase.execute({ ...input, measurement: 'yes_no', value: 5 })).rejects.toBeInstanceOf(ChallengeError);
    expect(repo.reportProgress).not.toHaveBeenCalled();
  });
});

describe('ListChallengesUseCase', () => {
  it('forwards the view and paging to the repository', async () => {
    const repo = makeRepo();
    await new ListChallengesUseCase(repo).execute('joined', 'cursor-1', 20);
    expect(repo.listChallenges).toHaveBeenCalledWith('joined', 'cursor-1', 20);
  });
});
