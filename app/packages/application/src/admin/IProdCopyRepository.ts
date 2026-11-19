// FR-ADMIN-037 — port of the "Copied from production" card. Every call refuses with
// DemoDataError (code `not_installed` where the database has no production-copy tools, e.g.
// kc-prod, where the card is not shown).
import type { ProdCopyDeleteResult, ProdCopyStatus } from '@kc/domain';

export interface IProdCopyRepository {
  /** What the copy holds and when it last ran. */
  getStatus(): Promise<ProdCopyStatus>;
  /** Deletes every copied member and organization; the next weekly copy creates them again. */
  deleteAll(): Promise<ProdCopyDeleteResult>;
}
