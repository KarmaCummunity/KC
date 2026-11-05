import type {
  ChallengeCadence,
  ChallengeGoalDirection,
  ChallengeMeasurement,
} from './ChallengeTypes';

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses `YYYY-MM-DD` as a UTC midnight; null when malformed or not a real calendar date. */
function parseIsoDate(isoDate: string): Date | null {
  if (!ISO_DATE.test(isoDate)) return null;
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate ? null : date;
}

export function isValidIsoDate(isoDate: string): boolean {
  return parseIsoDate(isoDate) !== null;
}

/**
 * First day of the cycle a report date belongs to. Daily and flexible challenges count every day
 * as its own cycle; weekly ones count Sunday-to-Saturday weeks (the Israeli week). Mirrors the
 * `challenge_cycle_start` SQL function of migration 0594, which is the authority.
 */
export function challengeCycleStart(isoDate: string, cadence: ChallengeCadence): string {
  const date = parseIsoDate(isoDate);
  if (!date) throw new RangeError(`Invalid ISO date: ${isoDate}`);
  if (cadence !== 'weekly') return isoDate;
  return new Date(date.getTime() - date.getUTCDay() * DAY_MS).toISOString().slice(0, 10);
}

/** The slice of a challenge that decides whether a reported value counts as success. */
export interface ChallengeGoal {
  readonly measurement: ChallengeMeasurement;
  readonly goalValue: number | null;
  readonly goalDirection: ChallengeGoalDirection | null;
}

/**
 * Whether one reported value is a success for its cycle: a yes/no report must be "yes", a
 * numeric one must satisfy the goal when there is one (any report counts when there is none).
 * Mirrors `challenge_goal_met` in migration 0594.
 */
export function isChallengeGoalMet(goal: ChallengeGoal, value: number): boolean {
  if (goal.measurement === 'yes_no') return value >= 1;
  if (goal.goalValue === null || goal.goalDirection === null) return true;
  return goal.goalDirection === 'at_least' ? value >= goal.goalValue : value <= goal.goalValue;
}
