// G39 — the shared IPostRepository contract, run against SupabasePostRepository
// on the local Supabase stack. vitest.config.ts collects this file only when the
// stack credentials are in the environment (ci-backend exports them after
// `supabase start`). The same cases run against the in-memory fake in
// @kc/application, so the fake and the adapter cannot drift apart unnoticed.

import { afterAll, beforeAll, describe, it } from 'vitest';
import { postRepositoryContract, type PostRepositoryContractContext } from '@kc/application';
import { PostContractHarness } from './postContractHarness';

// Each case seeds a user and signs in; the stack takes a few hundred ms per step.
const CASE_TIMEOUT_MS = 30_000;

describe('IPostRepository contract — SupabasePostRepository (local stack)', () => {
  let harness: PostContractHarness;
  let ctx: PostRepositoryContractContext;

  beforeAll(async () => {
    harness = new PostContractHarness();
    const address = await harness.anyAddress();
    ctx = { address, newActor: () => harness.newActor() };
  }, CASE_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.teardown();
  });

  for (const contractCase of postRepositoryContract()) {
    it(contractCase.name, () => contractCase.run(ctx), CASE_TIMEOUT_MS);
  }
});
