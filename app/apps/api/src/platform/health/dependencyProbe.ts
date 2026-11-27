/** A service the API cannot take traffic without (database, cache). */
export interface DependencyProbe {
  /** Name shown in the readiness report, e.g. `database`. */
  readonly name: string;
  /** Resolves when the dependency answers; rejects otherwise. */
  ping(): Promise<void>;
}

/** Injection token of the `DependencyProbe[]` the readiness endpoint runs. */
export const DEPENDENCY_PROBES = Symbol('DEPENDENCY_PROBES');
