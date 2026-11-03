// G39 — the shared IPostRepository contract, run against the in-memory fake.
// The same cases run against SupabasePostRepository on the local stack in
// infrastructure-supabase (SupabasePostRepository.contract.integration.test.ts).

import { describe, it } from 'vitest';
import { postRepositoryContract, type PostRepositoryContractContext } from '../../contracts';
import { InMemoryPostRepository } from './InMemoryPostRepository';
import { InMemoryPostStore } from './inMemoryPostStore';

const store = new InMemoryPostStore({ cities: ['tel-aviv'] });

const ctx: PostRepositoryContractContext = {
  address: { city: 'tel-aviv', cityName: 'תל אביב', street: 'Contract St', streetNumber: '1' },
  newActor: async () => {
    const user = store.addUser();
    return { userId: user.userId, repo: new InMemoryPostRepository(store, user.userId) };
  },
};

describe('IPostRepository contract — InMemoryPostRepository', () => {
  for (const contractCase of postRepositoryContract()) {
    it(contractCase.name, () => contractCase.run(ctx));
  }
});
