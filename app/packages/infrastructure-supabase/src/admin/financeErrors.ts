// Shared SQLSTATE / message → FinanceLedgerError mapping for every finance adapter, so no
// raw database text ever reaches the UI.
import { FinanceLedgerError, type FinanceLedgerErrorCode } from '@kc/domain';

const BY_MESSAGE: Readonly<Record<string, FinanceLedgerErrorCode>> = {
  invalid_kind: 'invalid_kind',
  invalid_status: 'invalid_status',
  invalid_amount: 'invalid_amount',
  invalid_direction: 'invalid_direction',
  missing_required_fields: 'missing_required_fields',
  entry_not_found: 'entry_not_found',
  account_not_found: 'account_not_found',
  account_name_taken: 'account_name_taken',
  invalid_name: 'invalid_name',
  invalid_last4: 'invalid_last4',
  invalid_settings: 'invalid_settings',
  org_not_found: 'org_not_found',
};

export function toFinanceError(err: { message?: string; code?: string } | null): FinanceLedgerError {
  const msg = err?.message ?? '';
  const mapped = BY_MESSAGE[msg];
  if (mapped) return new FinanceLedgerError(mapped);
  // P0002 is raised for every "not found" in the finance RPCs; entries are the common case.
  if (err?.code === 'P0002') return new FinanceLedgerError('entry_not_found');
  if (err?.code === '42501') return new FinanceLedgerError('forbidden');
  return new FinanceLedgerError('unknown', msg);
}
