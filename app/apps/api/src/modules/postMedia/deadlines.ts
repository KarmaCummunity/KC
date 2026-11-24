// Finite deadlines for the photo worker's database calls, downloads and uploads: each operation
// is ABORTED at its deadline (the request, not only the wait).

/** Per-operation deadlines (ms). Every operation is aborted when its deadline passes. */
export interface Deadlines {
  readonly rpcMs: number;
  readonly downloadMs: number;
  readonly uploadMs: number;
  readonly cleanupMs: number;
}

/** Defaults: not measured on the platform; chosen so one job fits well inside a lease. */
export const DEFAULT_DEADLINES: Deadlines = { rpcMs: 5_000, downloadMs: 15_000, uploadMs: 15_000, cleanupMs: 10_000 };

/** An operation did not finish before its deadline; it was aborted. */
export class DeadlineExceeded extends Error {
  constructor(label: string) {
    super(`deadline_exceeded: ${label}`);
    this.name = 'DeadlineExceeded';
  }
}

/** Runs `op` with an AbortSignal that fires after `ms`; rejects with DeadlineExceeded at that point. */
export async function withDeadline<T>(ms: number, label: string, op: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Settle with the deadline first, then abort: the aborted operation's own rejection must not
      // win the race and hide that this was a deadline.
      reject(new DeadlineExceeded(label));
      controller.abort();
    }, Math.max(0, ms));
  });
  try {
    return await Promise.race([op(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}
