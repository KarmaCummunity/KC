import type { DependencyProbe } from './dependencyProbe';

export type DependencyStatus = 'up' | 'down';

/** Outcome of probing every dependency once. */
export interface ReadinessReport {
  readonly ready: boolean;
  readonly checks: Readonly<Record<string, DependencyStatus>>;
  /** Why each failed probe failed. For server logs only, never for a response. */
  readonly failures: ReadonlyArray<{ readonly name: string; readonly cause: unknown }>;
}

/** Thrown when a probe does not answer within the allowed time. */
export class ProbeTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`${name} did not answer within ${timeoutMs} ms`);
    this.name = 'ProbeTimeoutError';
  }
}

/** Runs one probe, rejecting when it takes longer than `timeoutMs`. */
async function pingWithin(probe: DependencyProbe, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeoutError(probe.name, timeoutMs)), timeoutMs);
  });
  try {
    await Promise.race([probe.ping(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes every dependency in parallel. A probe that is slow counts as down:
 * an instance that cannot reach its database quickly should not take traffic.
 */
export async function checkDependencies(probes: readonly DependencyProbe[], timeoutMs: number): Promise<ReadinessReport> {
  const results = await Promise.allSettled(probes.map((probe) => pingWithin(probe, timeoutMs)));

  const checks: Record<string, DependencyStatus> = {};
  const failures: Array<{ name: string; cause: unknown }> = [];
  results.forEach((result, index) => {
    const name = probes[index]?.name ?? `dependency_${index}`;
    checks[name] = result.status === 'fulfilled' ? 'up' : 'down';
    if (result.status === 'rejected') failures.push({ name, cause: result.reason });
  });

  return { ready: failures.length === 0, checks, failures };
}
