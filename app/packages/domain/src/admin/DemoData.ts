// FR-ADMIN-031 — the kc-dev demo data the admin portal can delete and restore: what exists,
// what a wipe or a restore reports, one step of a stepped operation, and the refusals.

/** What demo data exists right now, and what the database allows (admin_demo_data_status). */
export interface DemoDataStatus {
  readonly demoUsers: number;
  readonly demoOrganizations: number;
  /** Give / request posts of the demo members outside the rides world. */
  readonly demoItemPosts: number;
  /** Ride offers and requests of the demo members. */
  readonly demoRidePosts: number;
  readonly demoFollows: number;
  readonly demoChats: number;
  /** Team rows (org memberships) on the [DEMO] nonprofits. */
  readonly demoOrgMemberships: number;
  /** True only where a restore may run: the database carries the kc-dev marker. */
  readonly canSeed: boolean;
  /** True once a password was given, so a restore needs none. */
  readonly hasSavedPassword: boolean;
}

/** What a completed wipe deleted (AC2, AC4). */
export interface DemoDataWipeResult {
  readonly usersDeleted: number;
  readonly postsDeleted: number;
  readonly chatsDeleted: number;
  readonly organizationsDeleted: number;
  /** Demo nonprofits left in place because they have payment history. */
  readonly organizationsKept: number;
}

/** What exists after a completed restore (AC7). */
export interface DemoDataSeedResult {
  readonly users: number;
  readonly itemPosts: number;
  readonly ridePosts: number;
  readonly follows: number;
  readonly chats: number;
  readonly organizations: number;
  readonly orgMemberships: number;
}

/**
 * The answer to one step of a wipe or a restore. `progressKey` names the phase that runs next
 * (or `done`); `result` is set on the last step only.
 */
export interface DemoDataStep<R> {
  readonly done: boolean;
  readonly progressKey: string | null;
  readonly result: R | null;
}

/** Most phases an operation has: a restore wipes (2) then creates (6). */
export const DEMO_DATA_MAX_STEPS = 8;

/** Mirrors the server rule of admin_seed_demo_data_step (AC9). */
export const MIN_DEMO_PASSWORD_LENGTH = 8;

export type DemoDataErrorCode =
  | 'forbidden'
  | 'not_dev_environment'
  | 'cannot_wipe_self'
  | 'password_required'
  | 'password_too_short'
  | 'demo_operation_busy'
  /** The database has no demo-data tools (kc-prod, or kc-dev before the seed workflow ran). */
  | 'not_installed'
  /** A step ran into the request time limit. */
  | 'timeout'
  /** The operation did not finish within the expected number of steps. */
  | 'incomplete'
  | 'unknown';

/** Refusals the server names by message; the rest are decided by the adapter. */
export const DEMO_DATA_SERVER_ERROR_CODES: readonly DemoDataErrorCode[] = [
  'forbidden', 'not_dev_environment', 'cannot_wipe_self', 'password_required', 'password_too_short',
  'demo_operation_busy',
];

export class DemoDataError extends Error {
  constructor(
    public readonly code: DemoDataErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DemoDataError';
  }
}

export function isDemoDataError(e: unknown): e is DemoDataError {
  return e instanceof DemoDataError;
}

/** True when any demo data exists, so the screen offers the wipe. */
export function hasDemoData(status: DemoDataStatus): boolean {
  return status.demoUsers + status.demoOrganizations > 0;
}
