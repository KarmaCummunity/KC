import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppLinkStatus } from '@kc/domain';
import {
  CreateWhatsAppLinkCodeUseCase,
  GetWhatsAppLinkStatusUseCase,
  SetWhatsAppMatchConsentUseCase,
  UnlinkWhatsAppUseCase,
} from '../WhatsAppLinkUseCases';
import type { IWhatsAppLinkRepository } from '../IWhatsAppLinkRepository';

const status: WhatsAppLinkStatus = {
  linked: true, waIdMasked: '•••1234', isPro: true, consentOptedIn: false, phoneOptedOut: false,
};

function makeRepo() {
  return {
    getMyStatus: vi.fn(async () => status),
    createLinkCode: vi.fn(async () => ({ code: '123456', expiresAt: new Date('2026-11-13T10:10:00Z') })),
    unlink: vi.fn(async () => undefined),
    setMatchConsent: vi.fn(async (optedIn: boolean) => ({ ...status, consentOptedIn: optedIn })),
  } satisfies IWhatsAppLinkRepository;
}

describe('WhatsApp link use cases', () => {
  it('reads the status and unlinks', async () => {
    const repo = makeRepo();
    expect(await new GetWhatsAppLinkStatusUseCase(repo).execute()).toEqual(status);
    await new UnlinkWhatsAppUseCase(repo).execute();
    expect(repo.unlink).toHaveBeenCalledTimes(1);
  });

  it('issues a code for a Pro member, or when the status is not known yet', async () => {
    const repo = makeRepo();
    expect((await new CreateWhatsAppLinkCodeUseCase(repo).execute(status)).code).toBe('123456');
    await new CreateWhatsAppLinkCodeUseCase(repo).execute();
    expect(repo.createLinkCode).toHaveBeenCalledTimes(2);
  });

  it('refuses a code to a member known not to be Pro, without a call', async () => {
    const repo = makeRepo();
    await expect(new CreateWhatsAppLinkCodeUseCase(repo).execute({ ...status, isPro: false }))
      .rejects.toMatchObject({ code: 'pro_required' });
    expect(repo.createLinkCode).not.toHaveBeenCalled();
  });

  it('sets the match-alert consent and returns the new status', async () => {
    const repo = makeRepo();
    expect((await new SetWhatsAppMatchConsentUseCase(repo).execute(true)).consentOptedIn).toBe(true);
    expect(repo.setMatchConsent).toHaveBeenCalledWith(true);
    await expect(new SetWhatsAppMatchConsentUseCase(repo).execute('yes' as never))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(repo.setMatchConsent).toHaveBeenCalledTimes(1);
  });
});
