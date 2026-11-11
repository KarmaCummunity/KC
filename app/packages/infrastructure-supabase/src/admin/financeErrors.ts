// Shared error mapping of every finance adapter, so no raw database text ever reaches the UI: a
// missing backend object becomes `BackendUnavailableError` (degrade rule), every other refusal a
// `FinanceLedgerError` the admin money screens map to copy.
import { FinanceLedgerError, type FinanceLedgerErrorCode } from '@kc/domain';
import { toBackendUnavailable, type BackendErrorLike } from '../rpc/backendUnavailable';
import type { CallResult } from '../rpc/mapRpcError';

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
  // The baseline finance RPCs (supabase/schemas/85_billing/060, 100, 140).
  forbidden: 'forbidden',
  unauthenticated: 'forbidden',
  account_not_active: 'forbidden',
  illegal_transition: 'invalid_status',
  entry_voided: 'invalid_status',
  entry_reconciled: 'invalid_status',
  entry_locked_by_source: 'invalid_status',
};

export function toFinanceError(err: BackendErrorLike | null): FinanceLedgerError {
  const msg = err?.message ?? '';
  const mapped = BY_MESSAGE[msg];
  if (mapped) return new FinanceLedgerError(mapped);
  // P0002 is raised for every "not found" in the finance RPCs; entries are the common case.
  if (err?.code === 'P0002') return new FinanceLedgerError('entry_not_found');
  if (err?.code === '42501') return new FinanceLedgerError('forbidden');
  return new FinanceLedgerError('unknown', msg);
}

/** `data` of a successful finance call; otherwise throws the mapped error. */
export function unwrapFinance<T>(object: string, result: CallResult<T>): T {
  if (!result.error) return result.data;
  throw toBackendUnavailable(object, result.error) ?? toFinanceError(result.error);
}
