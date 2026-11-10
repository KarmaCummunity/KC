import type { TFunction } from 'i18next';
import type { ChallengeGoal } from '@kc/domain';

/** "Goal: at least 10,000" / "Goal: at most 5 min"; null when the challenge has no numeric goal. */
export function challengeGoalLabel(t: TFunction, goal: ChallengeGoal): string | null {
  if (goal.goalValue === null || goal.goalDirection === null || goal.measurement === 'yes_no') return null;
  const value = t(`challenges.unit.${goal.measurement}`, { value: goal.goalValue });
  return t(`challenges.goal.${goal.goalDirection}`, { value });
}
