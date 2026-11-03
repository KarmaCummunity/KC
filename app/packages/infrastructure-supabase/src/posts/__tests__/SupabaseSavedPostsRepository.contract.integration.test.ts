// G39 — the shared ISavedPostsRepository contract, run against
// SupabaseSavedPostsRepository on the local Supabase stack. vitest.config.ts
// collects this file only when the stack credentials are in the environment
// (ci-backend exports them after `supabase start`). The same cases run against
// the in-memory fake in @kc/application, so the fake and the adapter cannot
// drift apart unnoticed.

import { afterAll, beforeAll, describe, it } from 'vitest';
import { savedPostsRepositoryContract, type SavedPostsContractContext } from '@kc/application';
import { PostContractHarness } from './postContractHarness';

// Most cases seed two users and sign both in; the stack takes a few hundred ms per step.
const CASE_TIMEOUT_MS = 45_000;

describe('ISavedPostsRepository contract — SupabaseSavedPostsRepository (local stack)', () => {
  let harness: PostContractHarness;
  let ctx: SavedPostsContractContext;

  beforeAll(async () => {
    harness = new PostContractHarness();
    const address = await harness.anyAddress();
    ctx = { address, newActor: () => harness.newSavedPostsActor() };
  }, CASE_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.teardown();
  });

  for (const contractCase of savedPostsRepositoryContract()) {
    it(contractCase.name, () => contractCase.run(ctx), CASE_TIMEOUT_MS);
  }
});
