// G39 — the shared IChatRepository contract, run against SupabaseChatRepository on
// the local Supabase stack. vitest.config.ts collects this file only when the stack
// credentials are in the environment (ci-backend exports them after `supabase
// start`). The same cases run against the in-memory fake in @kc/application, so the
// fake and the adapter cannot drift apart unnoticed.

import { afterAll, describe, it } from 'vitest';
import { chatRepositoryContract, type ChatContractContext } from '@kc/application';
import { ContractUsers } from '../../__tests__/contractUsers';
import { SupabaseChatRepository } from '../SupabaseChatRepository';

// Cases seed up to four users and sign each in; the stack takes a few hundred ms per step.
const CASE_TIMEOUT_MS = 60_000;

describe('IChatRepository contract — SupabaseChatRepository (local stack)', () => {
  const users = new ContractUsers();
  const ctx: ChatContractContext = {
    newActor: async () => {
      const { userId, displayName, client } = await users.signInNewUser();
      return { userId, displayName, chats: new SupabaseChatRepository(client) };
    },
  };

  afterAll(async () => {
    await users.teardown();
  });

  for (const contractCase of chatRepositoryContract()) {
    it(contractCase.name, () => contractCase.run(ctx), CASE_TIMEOUT_MS);
  }
});
