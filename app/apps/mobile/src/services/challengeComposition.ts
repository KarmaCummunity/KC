// Composition root of the challenges world (docs/spec/10_challenges.md): wires the Supabase
// adapter into the application use cases.
import { SupabaseChallengeRepository, getSupabaseClient } from '@kc/infrastructure-supabase';
import {
  CreateChallengeUseCase,
  EndChallengeUseCase,
  GetChallengeUseCase,
  JoinChallengeUseCase,
  LeaveChallengeUseCase,
  ListChallengeLeaderboardUseCase,
  ListChallengesUseCase,
  ListMyChallengeEntriesUseCase,
  ReportChallengeProgressUseCase,
} from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let _repo: SupabaseChallengeRepository | null = null;

function repo() {
  _repo ??= new SupabaseChallengeRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  return _repo;
}

export const challengeUseCases = {
  create: () => new CreateChallengeUseCase(repo()),
  list: () => new ListChallengesUseCase(repo()),
  get: () => new GetChallengeUseCase(repo()),
  join: () => new JoinChallengeUseCase(repo()),
  leave: () => new LeaveChallengeUseCase(repo()),
  end: () => new EndChallengeUseCase(repo()),
  report: () => new ReportChallengeProgressUseCase(repo()),
  listEntries: () => new ListMyChallengeEntriesUseCase(repo()),
  listLeaderboard: () => new ListChallengeLeaderboardUseCase(repo()),
};

/** React Query key root; invalidating it refreshes every challenge list and detail. */
export const CHALLENGES_QUERY_KEY = 'challenges';
