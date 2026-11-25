import { profileEditingContract, type ProfileEditingContractContext } from '@kc/application';
import { SupabaseUserRepository } from '@kc/infrastructure-supabase';
import { afterAll, describe, it } from 'vitest';
import { KcTestDatabase } from '../support/kcDatabase';

describe('Profile-editing contract: SupabaseUserRepository on the compatibility engine', () => {
  const database = new KcTestDatabase();
  const ctx: ProfileEditingContractContext = {
    // Two cities of the reference seed.
    cities: [
      { id: '5000', name: 'תל אביב - יפו' },
      { id: '3000', name: 'ירושלים' },
    ],
    newActor: async () => {
      const member = await database.newMember();
      return { userId: member.userId, users: new SupabaseUserRepository(database.clientFor(member.caller)) };
    },
  };

  afterAll(async () => {
    await database.close();
  });

  for (const contractCase of profileEditingContract()) {
    it(contractCase.name, () => contractCase.run(ctx));
  }
});
