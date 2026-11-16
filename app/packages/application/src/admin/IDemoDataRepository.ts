// FR-ADMIN-031 — port of the kc-dev demo-data tools. A wipe and a restore are stepped: each
// call runs one phase on the server, so a step fits the request time limit; the use cases
// drive the steps. Every call refuses with DemoDataError (code `not_installed` where the
// database has no demo-data tools, e.g. kc-prod).
import type { DemoDataSeedResult, DemoDataStatus, DemoDataStep, DemoDataWipeResult } from '@kc/domain';

export interface IDemoDataRepository {
  /** What demo data exists and whether a restore is possible here. */
  getStatus(): Promise<DemoDataStatus>;
  /** Runs the next phase of "delete all demo data". */
  wipeStep(): Promise<DemoDataStep<DemoDataWipeResult>>;
  /**
   * Runs the next phase of "restore demo data". `password` (the demo members' login password)
   * is sent with the first step only, and only when the server has none saved.
   */
  seedStep(password?: string): Promise<DemoDataStep<DemoDataSeedResult>>;
}
