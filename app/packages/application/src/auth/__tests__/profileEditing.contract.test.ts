// G39 — the shared profile-editing contract, run against the in-memory fake.
// The same cases run against SupabaseUserRepository on the local stack in
// infrastructure-supabase (profileEditing.contract.integration.test.ts).

import { describe, it } from 'vitest';
import { profileEditingContract, type ProfileEditingContractContext } from '../../contracts';
import { InMemoryProfileEditing, InMemoryProfileStore } from './InMemoryProfileEditing';

const cities = [
  { id: '5000', name: 'תל אביב - יפו' },
  { id: '3000', name: 'ירושלים' },
] as const;
const store = new InMemoryProfileStore(cities);

const ctx: ProfileEditingContractContext = {
  cities,
  newActor: async () => {
    const { userId } = store.addMember(cities[0]);
    return { userId, users: new InMemoryProfileEditing(store, userId) };
  },
};

describe('Profile-editing contract — InMemoryProfileEditing', () => {
  for (const contractCase of profileEditingContract()) {
    it(contractCase.name, () => contractCase.run(ctx));
  }
});
