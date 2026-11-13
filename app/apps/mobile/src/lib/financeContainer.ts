// Composition of the admin finance use cases (V2-ADMIN-MONEY-9, FR-FIN-003/022/023), kept out of
// container.ts for the 300-line cap; the container spreads the result, like the WhatsApp admin one.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type Database,
  SupabaseFinanceAccountsRepository,
  SupabaseFinanceDonorsRepository,
  SupabaseFinanceLedgerRepository,
  SupabaseTransparencySettingsRepository,
} from '@kc/infrastructure-supabase';
import {
  DeleteFinanceEntryUseCase,
  GetFinanceSummaryUseCase,
  GetTransparencySettingsUseCase,
  ListFinanceAccountsUseCase,
  ListFinanceDonorsUseCase,
  ListFinanceLedgerUseCase,
  SetTransparencySettingsUseCase,
  UpsertFinanceAccountUseCase,
  UpsertFinanceEntryUseCase,
} from '@kc/application';

export function createFinanceUseCases(supabase: SupabaseClient<Database>) {
  const ledger = new SupabaseFinanceLedgerRepository(supabase);
  const accounts = new SupabaseFinanceAccountsRepository(supabase);
  const donors = new SupabaseFinanceDonorsRepository(supabase);
  const transparencySettings = new SupabaseTransparencySettingsRepository(supabase);
  return {
    listFinanceLedger: new ListFinanceLedgerUseCase(ledger),
    getFinanceSummary: new GetFinanceSummaryUseCase(ledger),
    upsertFinanceEntry: new UpsertFinanceEntryUseCase(ledger),
    deleteFinanceEntry: new DeleteFinanceEntryUseCase(ledger),
    listFinanceAccounts: new ListFinanceAccountsUseCase(accounts),
    upsertFinanceAccount: new UpsertFinanceAccountUseCase(accounts),
    listFinanceDonors: new ListFinanceDonorsUseCase(donors),
    getTransparencySettings: new GetTransparencySettingsUseCase(transparencySettings),
    setTransparencySettings: new SetTransparencySettingsUseCase(transparencySettings),
  };
}
