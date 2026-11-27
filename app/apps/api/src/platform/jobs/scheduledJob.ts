import type { Provider, Type } from '@nestjs/common';

/** What a run did, as counters and flags for the scheduler's log. Never personal data. */
export type JobReport = Readonly<Record<string, unknown>>;

/**
 * Work that runs on a schedule, not for a caller (ADR-009 phase 8): a
 * scheduler calls `POST /v1/jobs/<name>` and the job does one bounded batch.
 * A job must be safe to run twice at once and to run again after a failure:
 * the database functions it calls hand out each piece of work once.
 */
export interface ScheduledJob {
  /** The name the scheduler calls. Unique across the server. */
  readonly name: string;
  /**
   * @param input The JSON object the scheduler sent (often empty); a job reads only the options it knows.
   * @returns What the run did. Rejects when the run failed as a whole; the scheduler then sees a 500.
   */
  run(input: Readonly<Record<string, unknown>>): Promise<JobReport>;
}

/** Injection token of every `ScheduledJob` this server runs. */
export const SCHEDULED_JOBS = Symbol('SCHEDULED_JOBS');

/** The jobs a server runs, with the providers they need beyond the platform's own. */
export interface ScheduledJobSet {
  readonly jobs: readonly Type<ScheduledJob>[];
  readonly providers: readonly Provider[];
}

/**
 * The batch size a scheduler asked for, kept within what one run may take.
 * @returns `fallback` when `asked` is absent or not a number of at least 1; never more than `max`.
 */
export function batchLimit(asked: unknown, fallback: number, max: number): number {
  const limit = Number(asked);
  return Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), max) : fallback;
}
