import {
  FINANCE_ACCOUNT_LAST4_RE, FINANCE_ACCOUNT_NAME_MAX, FinanceLedgerError,
} from '@kc/domain';
import type {
  FinanceAccountUpsertInput, IFinanceAccountsRepository,
} from './IFinanceAccountsRepository';

export class UpsertFinanceAccountUseCase {
  constructor(private readonly repo: IFinanceAccountsRepository) {}

  /** Validates what the server would reject anyway, so the form can show a precise error offline. */
  async execute(input: FinanceAccountUpsertInput): Promise<string> {
    const name = input.name?.trim();
    if (input.name !== undefined && (!name || name.length > FINANCE_ACCOUNT_NAME_MAX)) {
      throw new FinanceLedgerError('invalid_name', `name must be 1..${FINANCE_ACCOUNT_NAME_MAX} chars`);
    }
    if (!input.accountId && (!name || !input.kind)) {
      throw new FinanceLedgerError('missing_required_fields', 'name and kind required');
    }
    if (input.last4 && !FINANCE_ACCOUNT_LAST4_RE.test(input.last4)) {
      throw new FinanceLedgerError('invalid_last4', 'last4 must be exactly four digits');
    }
    return this.repo.upsert({ ...input, ...(name !== undefined ? { name } : {}) });
  }
}
