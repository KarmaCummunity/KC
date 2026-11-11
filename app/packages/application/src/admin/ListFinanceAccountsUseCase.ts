import type { FinanceAccount } from '@kc/domain';
import type { IFinanceAccountsRepository } from './IFinanceAccountsRepository';

export class ListFinanceAccountsUseCase {
  constructor(private readonly repo: IFinanceAccountsRepository) {}

  execute(): Promise<readonly FinanceAccount[]> {
    return this.repo.list();
  }
}
