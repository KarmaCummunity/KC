// The member's WhatsApp bot link (#1090, D143) and match-alert opt-in (FR-NOTIF-017 AC4).
import {
  canRequestWhatsAppLinkCode,
  WhatsAppLinkError,
  type WhatsAppLinkCode,
  type WhatsAppLinkStatus,
} from '@kc/domain';
import type { IWhatsAppLinkRepository } from './IWhatsAppLinkRepository';

export class GetWhatsAppLinkStatusUseCase {
  constructor(private readonly repo: IWhatsAppLinkRepository) {}
  execute(): Promise<WhatsAppLinkStatus> { return this.repo.getMyStatus(); }
}

/**
 * Issues a link code. With a known status that is not Pro it refuses before the call; the
 * server checks Pro again either way.
 */
export class CreateWhatsAppLinkCodeUseCase {
  constructor(private readonly repo: IWhatsAppLinkRepository) {}
  execute(known?: WhatsAppLinkStatus): Promise<WhatsAppLinkCode> {
    if (known && !canRequestWhatsAppLinkCode(known)) {
      return Promise.reject(new WhatsAppLinkError('pro_required'));
    }
    return this.repo.createLinkCode();
  }
}

export class UnlinkWhatsAppUseCase {
  constructor(private readonly repo: IWhatsAppLinkRepository) {}
  execute(): Promise<void> { return this.repo.unlink(); }
}

export class SetWhatsAppMatchConsentUseCase {
  constructor(private readonly repo: IWhatsAppLinkRepository) {}
  execute(optedIn: boolean): Promise<WhatsAppLinkStatus> {
    if (typeof optedIn !== 'boolean') return Promise.reject(new WhatsAppLinkError('invalid_input'));
    return this.repo.setMatchConsent(optedIn);
  }
}
