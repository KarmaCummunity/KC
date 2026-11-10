import type { FinanceDonorSummary } from '@kc/domain';
import type { IFinanceDonorsRepository } from './IFinanceDonorsRepository';

export class ListFinanceDonorsUseCase {
  constructor(private readonly repo: IFinanceDonorsRepository) {}

  execute(limit?: number): Promise<readonly FinanceDonorSummary[]> {
    return this.repo.summary(limit);
  }
}
