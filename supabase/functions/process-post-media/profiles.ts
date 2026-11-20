// process-post-media · processing profiles.
//
// PRODUCTION_CANDIDATE is the default and the only profile meant for real use; its caps are NOT yet
// qualified on the platform (see OPERATOR_RUNBOOK.md "Post photo derivatives", open blockers).
//
// DEV_EXPERIMENT_1024 is a labelled resource experiment for a DEV project only, opted into with
// PROCESS_POST_MEDIA_PROFILE=dev-experiment-1024. It is NOT a quality decision and must never be
// the production default: it exists to sample platform time/memory with small inputs. It takes
// one job per run, accepts sources up to 1024 px and makes copies of at most 1024 px. A larger
// source is released back to the queue untouched (no attempt spent, no failure recorded), so the
// experiment never fails real rows that the production profile would process.

export interface ProcessingProfile {
  readonly name: 'production-candidate' | 'dev-experiment-1024';
  /** Jobs claimed per run at most (one at a time). */
  readonly maxJobsPerRun: number;
  /** Default jobs per run when the request names none. */
  readonly defaultJobsPerRun: number;
  readonly maxSourceEdge: number;
  readonly maxSourcePixels: number;
  /** Longest edge of the copy the post page shows. */
  readonly derivativeMaxEdge: number;
  /** Longest edge of the feed-card copy. */
  readonly thumbMaxEdge: number;
  /** What a source over the caps gets: a final failure, or released back (experiment). */
  readonly overCap: 'fail' | 'release';
}

export const PRODUCTION_CANDIDATE: ProcessingProfile = {
  name: 'production-candidate',
  maxJobsPerRun: 5,
  defaultJobsPerRun: 3,
  maxSourceEdge: 4096,
  maxSourcePixels: 4096 * 4096,
  derivativeMaxEdge: 2048,
  thumbMaxEdge: 400,
  overCap: 'fail',
};

export const DEV_EXPERIMENT_1024: ProcessingProfile = {
  name: 'dev-experiment-1024',
  maxJobsPerRun: 1,
  defaultJobsPerRun: 1,
  maxSourceEdge: 1024,
  maxSourcePixels: 1024 * 1024,
  derivativeMaxEdge: 1024,
  thumbMaxEdge: 400,
  overCap: 'release',
};

/** The profile for the env value: the experiment only for its exact name, else the default. */
export function resolveProfile(value: string | undefined): ProcessingProfile {
  return value === DEV_EXPERIMENT_1024.name ? DEV_EXPERIMENT_1024 : PRODUCTION_CANDIDATE;
}
