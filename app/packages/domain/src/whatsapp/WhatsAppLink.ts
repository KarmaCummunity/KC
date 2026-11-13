// A member's link to the WhatsApp bot (#1090, D143: Pro only) and their match-alert opt-in
// (FR-NOTIF-017 AC4). The member asks the app for a one-time code and sends it to the KC
// number from WhatsApp; the webhook redeems it. SQL: api_whatsapp_my_link_status,
// api_whatsapp_create_link_code, api_whatsapp_unlink_me, api_whatsapp_set_match_consent.

export interface WhatsAppLinkStatus {
  readonly linked: boolean;
  /** The linked number with all but its last four digits hidden; null when not linked. */
  readonly waIdMasked: string | null;
  readonly isPro: boolean;
  /** The member's own switch for WhatsApp match alerts. */
  readonly consentOptedIn: boolean;
  /** The linked phone sent STOP; only START from the phone lifts it, not the app switch. */
  readonly phoneOptedOut: boolean;
}

export interface WhatsAppLinkCode {
  /** Six digits, shown once; the server keeps only its hash. */
  readonly code: string;
  readonly expiresAt: Date;
}

/** Whether the screen offers a link code: the bot is for Pro members (D143). */
export function canRequestWhatsAppLinkCode(status: WhatsAppLinkStatus): boolean {
  return status.isPro;
}

/** Whether the match-alert switch is offered: it needs a linked number. */
export function canToggleWhatsAppMatchAlerts(status: WhatsAppLinkStatus): boolean {
  return status.linked;
}

/** Whether a code shown earlier still works at `now`. */
export function isWhatsAppLinkCodeValid(code: WhatsAppLinkCode, now: Date): boolean {
  return code.expiresAt.getTime() > now.getTime();
}

export type WhatsAppLinkErrorCode =
  | 'pro_required'
  | 'rate_limited'
  | 'account_not_active'
  | 'unauthenticated'
  | 'invalid_input'
  | 'unknown';

export const WHATSAPP_LINK_ERROR_CODES: readonly WhatsAppLinkErrorCode[] = [
  'pro_required', 'rate_limited', 'account_not_active', 'unauthenticated', 'invalid_input', 'unknown',
];

export class WhatsAppLinkError extends Error {
  constructor(
    public readonly code: WhatsAppLinkErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'WhatsAppLinkError';
  }
}

export function isWhatsAppLinkError(e: unknown): e is WhatsAppLinkError {
  return e instanceof WhatsAppLinkError;
}
