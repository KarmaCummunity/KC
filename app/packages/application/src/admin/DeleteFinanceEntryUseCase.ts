import { FinanceLedgerError, isValidVoidReason } from '@kc/domain';
import type { IFinanceLedgerRepository } from './IFinanceLedgerRepository';

/**
 * Takes an entry out of the books (FR-FIN-005 AC2): it is voided with the admin's reason,
 * never erased. A reason under 3 or over 500 characters (trimmed) is refused here with
 * `void_reason_required`, as the server (`finance_ledger_mark`) does.
 */
export class DeleteFinanceEntryUseCase {
  constructor(private readonly repo: IFinanceLedgerRepository) {}

  async execute(entryId: string, reason: string): Promise<void> {
    if (!isValidVoidReason(reason)) {
      throw new FinanceLedgerError('void_reason_required', 'a void needs a reason of 3 to 500 characters');
    }
    await this.repo.delete(entryId, reason.trim());
  }
}
