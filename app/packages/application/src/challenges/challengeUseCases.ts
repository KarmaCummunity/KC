import {
  validateChallengeDraft,
  validateChallengeProgress,
  type ChallengeDraft,
  type ChallengeEntry,
  type ChallengeLeaderboardRow,
  type ChallengeListView,
  type ChallengeProgressInput,
  type ChallengeProgressResult,
  type ChallengeSummary,
} from '@kc/domain';
import type { IChallengeRepository } from '../ports/IChallengeRepository';

export class CreateChallengeUseCase {
  constructor(private readonly repo: IChallengeRepository) {}
  /** Validates the draft before any network call; returns the new challenge id. */
  async execute(draft: ChallengeDraft): Promise<string> {
    validateChallengeDraft(draft);
    return this.repo.createChallenge({ ...draft, title: draft.title.trim() });
  }
}

export class ListChallengesUseCase {
  constructor(private readonly repo: IChallengeRepository) {}
  execute(view: ChallengeListView, limit?: number, offset?: number): Promise<ChallengeSummary[]> {
    return this.repo.listChallenges(view, limit, offset);
  }
}

export class GetChallengeUseCase {
  constructor(private readonly repo: IChallengeRepository) {}
  execute(challengeId: string): Promise<ChallengeSummary | null> {
    return this.repo.getChallenge(challengeId);
  }
}

export class JoinChallengeUseCase {
  constructor(private readonly repo: IChallengeRepository) {}
  execute(challengeId: string): Promise<void> {
    return this.repo.joinChallenge(challengeId);
  }
}

export class LeaveChallengeUseCase {
  constructor(private readonly repo: IChallengeRepository) {}
  execute(challengeId: string): Promise<void> {
    return this.repo.leaveChallenge(challengeId);
  }
}

export class EndChallengeUseCase {
  constructor(private readonly repo: IChallengeRepository) {}
  execute(challengeId: string): Promise<void> {
    return this.repo.endChallenge(challengeId);
  }
}

export class ReportChallengeProgressUseCase {
  constructor(private readonly repo: IChallengeRepository) {}
  /** Validates the report before any network call; the server decides streak and karma. */
  async execute(input: ChallengeProgressInput): Promise<ChallengeProgressResult> {
    validateChallengeProgress(input);
    const note = input.note?.trim() ? input.note.trim() : null;
    return this.repo.reportProgress(input.challengeId, input.value, note, input.reportDate);
  }
}

export class ListMyChallengeEntriesUseCase {
  constructor(private readonly repo: IChallengeRepository) {}
  execute(challengeId: string, limit?: number): Promise<ChallengeEntry[]> {
    return this.repo.listMyEntries(challengeId, limit);
  }
}

export class ListChallengeLeaderboardUseCase {
  constructor(private readonly repo: IChallengeRepository) {}
  execute(challengeId: string, limit?: number): Promise<ChallengeLeaderboardRow[]> {
    return this.repo.listLeaderboard(challengeId, limit);
  }
}
