import { describe, expect, it, vi } from 'vitest';
import {
  BackendRuleError,
  BackendUnavailableError,
  IDENTITY_VERIFICATION_CONSENT_VERSION,
  IdentityVerificationError,
} from '@kc/domain';
import { StartIdentityVerificationUseCase } from '../StartIdentityVerificationUseCase';
import type { IIdentityVerificationService } from '../../ports/IIdentityVerificationService';

const fakeService = (impl: Partial<IIdentityVerificationService> = {}): IIdentityVerificationService => ({
  getStatus: vi.fn(),
  acceptConsent: vi.fn().mockResolvedValue(undefined),
  startSession: vi.fn().mockResolvedValue({ hostedUrl: 'https://verify.example.test/s/1' }),
  ...impl,
});

/** Runs the use case and returns the error code it threw, or null when it succeeded. */
async function codeOf(service: IIdentityVerificationService, consentGiven = true): Promise<string | null> {
  try {
    await new StartIdentityVerificationUseCase(service).execute({ consentGiven });
    return null;
  } catch (error) {
    return error instanceof IdentityVerificationError ? error.code : 'not-a-verification-error';
  }
}

describe('StartIdentityVerificationUseCase', () => {
  it('records the current consent version, then returns the hosted session', async () => {
    const service = fakeService();
    const session = await new StartIdentityVerificationUseCase(service).execute({ consentGiven: true });

    expect(session).toEqual({ hostedUrl: 'https://verify.example.test/s/1' });
    expect(service.acceptConsent).toHaveBeenCalledWith(IDENTITY_VERIFICATION_CONSENT_VERSION);
    expect(service.startSession).toHaveBeenCalledTimes(1);
  });

  it('refuses without consent and calls nothing', async () => {
    const service = fakeService();
    expect(await codeOf(service, false)).toBe('consent_required');
    expect(service.acceptConsent).not.toHaveBeenCalled();
    expect(service.startSession).not.toHaveBeenCalled();
  });

  it.each([
    ['verification_attempts_exhausted', 'attempts_exhausted'],
    ['manual_review_only', 'manual_review_only'],
    ['already_verified', 'already_verified'],
    ['account_not_active', 'account_not_active'],
    ['something_new', 'unavailable'],
    ['provider_unavailable', 'unavailable'],
  ])('maps the server refusal %s to %s', async (reason, code) => {
    const service = fakeService({
      startSession: vi.fn().mockRejectedValue(new BackendRuleError(reason, 'edge:identity-verification-session')),
    });
    expect(await codeOf(service)).toBe(code);
  });

  it('treats a missing backend or an unexpected failure as unavailable', async () => {
    expect(await codeOf(fakeService({
      startSession: vi.fn().mockRejectedValue(new BackendUnavailableError('identity-verification-session', 'edge_function')),
    }))).toBe('unavailable');
    expect(await codeOf(fakeService({ acceptConsent: vi.fn().mockRejectedValue(new Error('network')) }))).toBe('unavailable');
  });
});
