import type { WhatsAppLinkCode, WhatsAppLinkStatus } from '@kc/domain';

/** The signed-in member's own WhatsApp link (#1090) and match-alert switch (FR-NOTIF-017 AC4). */
export interface IWhatsAppLinkRepository {
  getMyStatus(): Promise<WhatsAppLinkStatus>;
  /** A fresh one-time code (10 minutes); `pro_required` for a member without Pro. */
  createLinkCode(): Promise<WhatsAppLinkCode>;
  /** Unlinks the member's number; its consent history stays. */
  unlink(): Promise<void>;
  /** Turns WhatsApp match alerts on or off; returns the new status. */
  setMatchConsent(optedIn: boolean): Promise<WhatsAppLinkStatus>;
}
