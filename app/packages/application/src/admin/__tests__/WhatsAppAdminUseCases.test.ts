import { describe, expect, it, vi } from 'vitest';
import { WhatsAppAdminError } from '@kc/domain';
import {
  BlockWhatsAppUserUseCase,
  GetWhatsAppAdminOverviewUseCase,
  GetWhatsAppChannelUseCase,
  ListWhatsAppConsentUseCase,
  ListWhatsAppConversationsUseCase,
  ListWhatsAppOutboundUseCase,
  ListWhatsAppRateHitsUseCase,
  ListWhatsAppRecentMatchesUseCase,
  ListWhatsAppReviewsUseCase,
  ListWhatsAppTemplatesUseCase,
  ResendWhatsAppOutboundUseCase,
  ResolveWhatsAppReviewUseCase,
  SetWhatsAppChannelEnabledUseCase,
  SetWhatsAppSendLimitsUseCase,
  SetWhatsAppTemplateStatusUseCase,
} from '../WhatsAppAdminUseCases';
import type { IWhatsAppAdminRepository } from '../IWhatsAppAdminRepository';

const emptyPage = { rows: [], nextCursor: null };

function makeRepo() {
  return {
    getChannel: vi.fn(async () => ({ isEnabled: false, phoneNumberId: null, graphApiVersion: null, updatedAt: null, updatedBy: null })),
    setChannelEnabled: vi.fn(async (enabled: boolean) => ({
      isEnabled: enabled, phoneNumberId: null, graphApiVersion: 'v21.0', updatedAt: new Date(), updatedBy: 'a1',
    })),
    overview: vi.fn(async () => ({
      channelEnabled: false, since: new Date(), outboundQueued: 0, outboundSent: 0,
      outboundFailed: 0, outboundSkipped: 0, consentOptedIn: 1, consentOptedOut: 0,
      sessions7d: 0, matchesSent7d: 0, rateHits7d: 0, reviewPending: 2,
    })),
    listConsent: vi.fn(async () => emptyPage),
    listOutbound: vi.fn(async () => emptyPage),
    listRateHits: vi.fn(async () => []),
    listRecentMatches: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    resend: vi.fn(async () => 'queued'),
    blockUser: vi.fn(async () => undefined),
    listReviews: vi.fn(async () => emptyPage),
    resolveReview: vi.fn(async (_id: string, decision: 'approved' | 'rejected') => decision),
    listTemplates: vi.fn(async () => []),
    setSendLimits: vi.fn(async () => ({
      perUserHour: 5, perUserDay: 20, replyPerPhoneHour: 30, globalPerMinute: 60, globalTemplateRecipientsDay: 1000,
      inboundPerPhoneMinute: 20, llmPerPhoneDay: 30, llmGlobalDay: 2000, maxAttempts: 5, backoffBaseSeconds: 30,
      updatedAt: null, updatedBy: null,
    })),
    setTemplateStatus: vi.fn(async () => undefined),
  } satisfies IWhatsAppAdminRepository;
}

describe('WhatsApp admin use cases', () => {
  it('overview and list consent pass through with the cursor', async () => {
    const repo = makeRepo();
    expect((await new GetWhatsAppAdminOverviewUseCase(repo).execute()).reviewPending).toBe(2);
    await new ListWhatsAppConsentUseCase(repo).execute({ cursor: 'c1', limit: 10 });
    await new ListWhatsAppConsentUseCase(repo).execute();
    expect(repo.listConsent).toHaveBeenNthCalledWith(1, { cursor: 'c1', limit: 10 });
    expect(repo.listConsent).toHaveBeenNthCalledWith(2, {});
  });

  it('list outbound forwards status, cursor and limit', async () => {
    const repo = makeRepo();
    await new ListWhatsAppOutboundUseCase(repo).execute({ status: 'failed', cursor: 'c', limit: 5 });
    expect(repo.listOutbound).toHaveBeenCalledWith({ status: 'failed', cursor: 'c', limit: 5 });
  });

  it('channel get / set, resend, block and the small lists pass through', async () => {
    const repo = makeRepo();
    await new GetWhatsAppChannelUseCase(repo).execute();
    expect((await new SetWhatsAppChannelEnabledUseCase(repo).execute(true)).isEnabled).toBe(true);
    expect(await new ResendWhatsAppOutboundUseCase(repo).execute('o1')).toBe('queued');
    await new BlockWhatsAppUserUseCase(repo).execute('u1');
    await new ListWhatsAppRateHitsUseCase(repo).execute(10);
    await new ListWhatsAppRecentMatchesUseCase(repo).execute(10);
    await new ListWhatsAppConversationsUseCase(repo).execute(10);
    await new ListWhatsAppTemplatesUseCase(repo).execute();
    expect(repo.setChannelEnabled).toHaveBeenCalledWith(true);
    expect(repo.resend).toHaveBeenCalledWith('o1');
    expect(repo.blockUser).toHaveBeenCalledWith('u1');
    expect(repo.listRateHits).toHaveBeenCalledWith(10);
    expect(repo.listTemplates).toHaveBeenCalled();
  });

  it('review list forwards its filters and resolve takes a decision', async () => {
    const repo = makeRepo();
    await new ListWhatsAppReviewsUseCase(repo).execute({ status: 'pending', cursor: 'c' });
    expect(repo.listReviews).toHaveBeenCalledWith({ status: 'pending', cursor: 'c' });
    expect(await new ResolveWhatsAppReviewUseCase(repo).execute('r1', 'approved')).toBe('approved');
    expect(repo.resolveReview).toHaveBeenCalledWith('r1', 'approved');
  });

  it('resolve refuses a decision that is not approve or reject, without a call', async () => {
    const repo = makeRepo();
    await expect(new ResolveWhatsAppReviewUseCase(repo).execute('r1', 'pending' as never))
      .rejects.toMatchObject({ code: 'invalid_decision' });
    expect(repo.resolveReview).not.toHaveBeenCalled();
  });

  it('send limits: forwards a valid patch, refuses an empty or out-of-range one', async () => {
    const repo = makeRepo();
    await new SetWhatsAppSendLimitsUseCase(repo).execute({ perUserHour: 6 });
    expect(repo.setSendLimits).toHaveBeenCalledWith({ perUserHour: 6 });
    const useCase = new SetWhatsAppSendLimitsUseCase(repo);
    await expect(useCase.execute({})).rejects.toBeInstanceOf(WhatsAppAdminError);
    await expect(useCase.execute({ maxAttempts: 99 })).rejects.toMatchObject({ code: 'invalid_limits', message: 'maxAttempts' });
    expect(repo.setSendLimits).toHaveBeenCalledTimes(1);
  });

  it('template status: forwards a Meta state, refuses an unknown one', async () => {
    const repo = makeRepo();
    const input = { templateName: 'match_found_v1', languageCode: 'he', metaStatus: 'approved' as const };
    await new SetWhatsAppTemplateStatusUseCase(repo).execute(input);
    expect(repo.setTemplateStatus).toHaveBeenCalledWith(input);
    await expect(new SetWhatsAppTemplateStatusUseCase(repo).execute({ ...input, metaStatus: 'live' as never }))
      .rejects.toMatchObject({ code: 'invalid_status' });
    expect(repo.setTemplateStatus).toHaveBeenCalledTimes(1);
  });
});
