import {
  type ChatContractContext,
  chatRepositoryContract,
  type ReportContractContext,
  reportRepositoryContract,
} from '@kc/application';
import { SupabaseChatRepository, SupabaseReportRepository } from '@kc/infrastructure-supabase';
import { afterAll, describe, it } from 'vitest';
import { KC_DATABASE_URL, KcTestDatabase } from '../support/kcDatabase';

describe.skipIf(!KC_DATABASE_URL)('Chat and report contracts: Supabase adapters on the compatibility engine', () => {
  const database = new KcTestDatabase();

  afterAll(async () => {
    await database.close();
  });

  const chat: ChatContractContext = {
    reopenAfterHide: 'same-thread',
    newActor: async () => {
      const member = await database.newMember();
      return {
        userId: member.userId,
        displayName: member.displayName,
        chats: new SupabaseChatRepository(database.clientFor(member.caller)),
      };
    },
  };
  for (const contractCase of chatRepositoryContract()) {
    it(`IChatRepository: ${contractCase.name}`, () => contractCase.run(chat));
  }

  const reports: ReportContractContext = {
    newActor: async () => {
      const member = await database.newMember();
      return { userId: member.userId, reports: new SupabaseReportRepository(database.clientFor(member.caller)) };
    },
  };
  for (const contractCase of reportRepositoryContract()) {
    it(`IReportRepository: ${contractCase.name}`, () => contractCase.run(reports));
  }
});
