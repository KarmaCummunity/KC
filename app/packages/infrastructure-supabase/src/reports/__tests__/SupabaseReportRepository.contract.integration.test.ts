// G39 — the shared IReportRepository contract, run against SupabaseReportRepository
// on the local Supabase stack. vitest.config.ts collects this file only when the
// stack credentials are in the environment (ci-backend exports them after
// `supabase start`). The same cases run against the in-memory fake in
// @kc/application, so the fake and the adapter cannot drift apart unnoticed.

import { afterAll, describe, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reportRepositoryContract, type ReportContractContext } from '@kc/application';
import { ContractUsers } from '../../__tests__/contractUsers';
import type { Database } from '../../database.types';
import { SupabaseReportRepository } from '../SupabaseReportRepository';

// Cases seed up to three users and sign each in; the stack takes a few hundred ms per step.
const CASE_TIMEOUT_MS = 60_000;

describe('IReportRepository contract — SupabaseReportRepository (local stack)', () => {
  const users = new ContractUsers();
  const ctx: ReportContractContext = {
    newActor: async () => {
      const { userId, client } = await users.signInNewUser();
      // ContractUsers (owned by P1) still types its client against the legacy schema; it is the
      // same connection, so only the type is converted.
      return { userId, reports: new SupabaseReportRepository(client as unknown as SupabaseClient<Database>) };
    },
  };

  afterAll(async () => {
    await users.teardown();
  });

  for (const contractCase of reportRepositoryContract()) {
    it(contractCase.name, () => contractCase.run(ctx), CASE_TIMEOUT_MS);
  }
});
