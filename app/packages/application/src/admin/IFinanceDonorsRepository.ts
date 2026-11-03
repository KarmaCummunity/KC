// FR-FIN-023 — port for the admin-only donors overview.
import type { FinanceDonorSummary } from '@kc/domain';

export interface IFinanceDonorsRepository {
  summary(limit?: number): Promise<readonly FinanceDonorSummary[]>;
}
