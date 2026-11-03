// G39 — the shared follow-graph contract, run against the in-memory fake.
// The same cases run against SupabaseUserRepository on the local stack in
// infrastructure-supabase (followGraph.contract.integration.test.ts).

import { describe, it } from 'vitest';
import { followGraphContract, type FollowGraphContractContext } from '../../contracts';
import { InMemoryFollowGraph, InMemoryFollowStore } from './InMemoryFollowGraph';

const store = new InMemoryFollowStore();

const ctx: FollowGraphContractContext = {
  newActor: async (privacyMode) => {
    const { userId } = store.addMember(privacyMode);
    return { userId, users: new InMemoryFollowGraph(store, userId) };
  },
};

describe('Follow-graph contract — InMemoryFollowGraph', () => {
  for (const contractCase of followGraphContract()) {
    it(contractCase.name, () => contractCase.run(ctx));
  }
});
