// G39 — the shared ISavedPostsRepository contract, run against the in-memory fake.
// The same cases run against SupabaseSavedPostsRepository on the local stack in
// infrastructure-supabase (SupabaseSavedPostsRepository.contract.integration.test.ts).

import { describe, it } from 'vitest';
import { savedPostsRepositoryContract, type SavedPostsContractContext } from '../../contracts';
import { InMemoryPostRepository } from './InMemoryPostRepository';
import { InMemorySavedPostsRepository } from './InMemorySavedPostsRepository';
import { InMemoryPostStore } from './inMemoryPostStore';

const store = new InMemoryPostStore({ cities: ['tel-aviv'] });

const ctx: SavedPostsContractContext = {
  address: { city: 'tel-aviv', cityName: 'תל אביב', street: 'Contract St', streetNumber: '1' },
  newActor: async () => {
    const user = store.addUser();
    return {
      userId: user.userId,
      posts: new InMemoryPostRepository(store, user.userId),
      saved: new InMemorySavedPostsRepository(store, user.userId),
    };
  },
};

describe('ISavedPostsRepository contract — InMemorySavedPostsRepository', () => {
  for (const contractCase of savedPostsRepositoryContract()) {
    it(contractCase.name, () => contractCase.run(ctx));
  }
});
