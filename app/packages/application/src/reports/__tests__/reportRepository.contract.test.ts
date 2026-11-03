// G39 — the shared IReportRepository contract, run against the in-memory fake.
// The same cases run against SupabaseReportRepository on the local stack in
// infrastructure-supabase (SupabaseReportRepository.contract.integration.test.ts).

import { describe, it } from 'vitest';
import { reportRepositoryContract, type ReportContractContext } from '../../contracts';
import { InMemoryChatRepository } from '../../chat/__tests__/InMemoryChatRepository';
import { InMemoryChatStore } from '../../chat/__tests__/inMemoryChatStore';
import { InMemoryReportRepository, type StoredReport } from './InMemoryReportRepository';

const store = new InMemoryChatStore();
const reports: StoredReport[] = [];

const ctx: ReportContractContext = {
  newActor: async () => {
    const { userId } = store.addUser();
    return {
      userId,
      reports: new InMemoryReportRepository(store, reports, userId),
      chats: new InMemoryChatRepository(store, userId),
    };
  },
};

describe('IReportRepository contract — InMemoryReportRepository', () => {
  for (const contractCase of reportRepositoryContract()) {
    it(contractCase.name, () => contractCase.run(ctx));
  }
});
