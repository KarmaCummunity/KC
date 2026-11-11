// G39 — the shared profile-editing contract, run against SupabaseUserRepository on
// the local Supabase stack. vitest.config.ts collects this file only when the stack
// credentials are in the environment (ci-backend exports them after `supabase
// start`). The same cases run against the in-memory fake in @kc/application, so the
// fake and the adapter cannot drift apart unnoticed.

import { afterAll, describe, it } from 'vitest';
import { profileEditingContract, type ProfileEditingContractContext } from '@kc/application';
import { ContractUsers } from '../../__tests__/contractUsers';
import { SupabaseUserRepository } from '../SupabaseUserRepository';

// Cases seed up to two users and sign each in; the stack takes a few hundred ms per step.
const CASE_TIMEOUT_MS = 60_000;

describe('Profile-editing contract — SupabaseUserRepository (local stack)', () => {
  const users = new ContractUsers();
  const ctx: ProfileEditingContractContext = {
    // Rows of public.cities loaded from supabase/seed/reference/data/cities.csv.
    cities: [
      { id: '5000', name: 'תל אביב - יפו' },
      { id: '3000', name: 'ירושלים' },
    ],
    newActor: async () => {
      const { userId, client } = await users.signInNewUser();
      return { userId, users: new SupabaseUserRepository(client) };
    },
  };

  afterAll(async () => {
    await users.teardown();
  });

  for (const contractCase of profileEditingContract()) {
    it(contractCase.name, () => contractCase.run(ctx), CASE_TIMEOUT_MS);
  }
});
