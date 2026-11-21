import {
  postRepositoryContract,
  type PostRepositoryContractContext,
  savedPostsRepositoryContract,
  type SavedPostsContractContext,
} from '@kc/application';
import type { Address } from '@kc/domain';
import { SupabasePostRepository, SupabaseSavedPostsRepository } from '@kc/infrastructure-supabase';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { KC_DATABASE_URL, KcTestDatabase } from '../support/kcDatabase';

describe.skipIf(!KC_DATABASE_URL)('Post contracts: Supabase adapters on the compatibility engine', () => {
  const database = new KcTestDatabase();
  // Filled before the cases run; the contexts read it lazily.
  const address = {} as Address;

  beforeAll(async () => {
    // The contracts only need an address the foreign key accepts: the first seeded city.
    const city = await database.admin.query<{ city_id: string; name_he: string }>('select city_id, name_he from public.cities limit 1');
    const row = city.rows[0];
    if (!row) throw new Error('the reference seed is not loaded: no city');
    Object.assign(address, { city: row.city_id, cityName: row.name_he, street: 'Contract St', streetNumber: '1' });
  });

  afterAll(async () => {
    await database.close();
  });

  const posts: PostRepositoryContractContext = {
    address,
    reopenCountReadable: false,
    deleteKeepsPostForReopen: true,
    newActor: async () => {
      const member = await database.newMember();
      return { userId: member.userId, repo: new SupabasePostRepository(database.clientFor(member.caller)) };
    },
  };
  for (const contractCase of postRepositoryContract()) {
    it(`IPostRepository: ${contractCase.name}`, () => contractCase.run(posts));
  }

  const saved: SavedPostsContractContext = {
    address,
    deleteKeepsPostForReopen: true,
    newActor: async () => {
      const member = await database.newMember();
      return {
        userId: member.userId,
        posts: new SupabasePostRepository(database.clientFor(member.caller)),
        saved: new SupabaseSavedPostsRepository(database.clientFor(member.caller)),
      };
    },
  };
  for (const contractCase of savedPostsRepositoryContract()) {
    it(`ISavedPostsRepository: ${contractCase.name}`, () => contractCase.run(saved));
  }
});
