// FR-FIN-003 (lean) — port for the organisation's financial accounts.
import type { FinanceAccount, FinanceAccountKind } from '@kc/domain';

export interface FinanceAccountUpsertInput {
  /** Omit to create; present to update. */
  readonly accountId?: string | null;
  readonly name?: string;
  readonly kind?: FinanceAccountKind;
  /** Empty string clears the stored value; undefined keeps it. */
  readonly last4?: string;
  readonly openingBalanceCents?: number;
  readonly openingBalanceAt?: Date;
  /** Accounts with history are deactivated, never deleted. */
  readonly isActive?: boolean;
  readonly sortOrder?: number;
}

export interface IFinanceAccountsRepository {
  list(): Promise<readonly FinanceAccount[]>;
  upsert(input: FinanceAccountUpsertInput): Promise<string>;
}
