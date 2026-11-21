import { followGraphContract, type FollowGraphContractContext } from '@kc/application';
import { SupabaseUserRepository } from '@kc/infrastructure-supabase';
import { afterAll, describe, it } from 'vitest';
import { KC_DATABASE_URL, KcTestDatabase } from '../support/kcDatabase';

/**
 * The shared follow-graph contract, run against the unchanged Supabase adapter
 * on top of the compatibility engine and a real KC schema.
 */
describe.skipIf(!KC_DATABASE_URL)('Follow-graph contract: SupabaseUserRepository on the compatibility engine', () => {
  const database = new KcTestDatabase();
  const ctx: FollowGraphContractContext = {
    newActor: async (privacyMode = 'Public') => {
      const member = await database.newMember();
      if (privacyMode !== 'Public') {
        await database.admin.query('update public.users set privacy_mode = $2 where id = $1', [member.userId, privacyMode]);
      }
      return { userId: member.userId, users: new SupabaseUserRepository(database.clientFor(member.caller)) };
    },
  };

  afterAll(async () => {
    await database.close();
  });

  for (const contractCase of followGraphContract()) {
    it(contractCase.name, () => contractCase.run(ctx));
  }
});
