// process-post-media · processing profiles.
//
// PRODUCTION_CANDIDATE is the default and the only profile meant for real use; its caps are NOT yet
// qualified on the platform (see OPERATOR_RUNBOOK.md "Post photo derivatives", open blockers).
//
// DEV_EXPERIMENT_1024 is a labelled resource experiment, opted into with
// PROCESS_POST_MEDIA_PROFILE=dev-experiment-1024 and accepted ONLY when the function runs in the
// kc-dev project (its ref, from SUPABASE_URL, must equal DEV_PROJECT_REF). Resolution fails closed:
// an unknown or misspelled profile, or the experiment anywhere but kc-dev, is an error and the
// worker refuses every run; nothing falls back silently to another profile. It is NOT a quality decision and must never be
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

/** The kc-dev project (AGENTS.md §13, docs/SSOT/ENVIRONMENTS.md): the only place the experiment may run. */
export const DEV_PROJECT_REF = 'enbqriuxvvuontiwslun';

/** The profile configuration is not acceptable: the worker must not run. */
export class ProfileConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileConfigError';
  }
}

/** `https://<ref>.supabase.co` → `<ref>`; null for anything else. */
function projectRef(supabaseUrl: string | undefined): string | null {
  try {
    const host = new URL(supabaseUrl ?? '').hostname;
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * The profile for `PROCESS_POST_MEDIA_PROFILE` in the project at `supabaseUrl`. Unset or empty:
 * the production candidate. The exact experiment name in kc-dev: the experiment. Anything else
 * throws ProfileConfigError.
 */
export function resolveProfile(value: string | undefined, supabaseUrl: string | undefined): ProcessingProfile {
  if (value === undefined || value === '') return PRODUCTION_CANDIDATE;
  if (value === DEV_EXPERIMENT_1024.name) {
    if (projectRef(supabaseUrl) !== DEV_PROJECT_REF) {
      throw new ProfileConfigError('dev-experiment-1024 is bound to the kc-dev project only');
    }
    return DEV_EXPERIMENT_1024;
  }
  throw new ProfileConfigError(`unknown PROCESS_POST_MEDIA_PROFILE '${value.slice(0, 40)}'`);
}
