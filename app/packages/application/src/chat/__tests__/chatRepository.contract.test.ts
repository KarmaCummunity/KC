// G39 — the shared IChatRepository contract, run against the in-memory fake.
// The same cases run against SupabaseChatRepository on the local stack in
// infrastructure-supabase (SupabaseChatRepository.contract.integration.test.ts).

import { describe, it } from 'vitest';
import { chatRepositoryContract, type ChatContractContext } from '../../contracts';
import { InMemoryChatRepository } from './InMemoryChatRepository';
import { InMemoryChatStore } from './inMemoryChatStore';

const store = new InMemoryChatStore();

const ctx: ChatContractContext = {
  newActor: async () => {
    const user = store.addUser();
    return { userId: user.userId, displayName: user.displayName, chats: new InMemoryChatRepository(store, user.userId) };
  },
};

describe('IChatRepository contract — InMemoryChatRepository', () => {
  for (const contractCase of chatRepositoryContract()) {
    it(contractCase.name, () => contractCase.run(ctx));
  }
});
