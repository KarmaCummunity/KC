// Rules of the admin WhatsApp console (M22 / L7): the statuses the RPCs accept, which rows an
// action applies to, the send limits a super admin may set, and the console's errors. The SQL
// copies are in the migrations `whatsapp_channel_schema` and `whatsapp_admin_console`.
import { hasEdge } from '../fsm/machine';
import { reviewDecisionMachine } from '../fsm/machines/reviewDecision';

/** Statuses of an outbound message (`api_whatsapp_admin_list_outbound` p_status). */
export const WHATSAPP_OUTBOUND_STATUSES = [
  'queued', 'sending', 'sent', 'failed', 'skipped_rate_limit', 'skipped_no_consent', 'skipped_outside_window',
  'skipped_template_unapproved', 'skipped_no_identity', 'skipped_global_cap', 'skipped_channel_disabled',
] as const;
export type WhatsAppOutboundStatus = (typeof WHATSAPP_OUTBOUND_STATUSES)[number];

/** What `api_whatsapp_admin_resend` queues again: a failure, or a skip that capacity caused. */
const RESENDABLE: ReadonlySet<string> = new Set(['failed', 'skipped_rate_limit', 'skipped_global_cap', 'skipped_outside_window']);

export function isWhatsAppOutboundResendable(status: string): boolean {
  return RESENDABLE.has(status);
}

export const WHATSAPP_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type WhatsAppReviewStatus = (typeof WHATSAPP_REVIEW_STATUSES)[number];
export type WhatsAppReviewDecision = Exclude<WhatsAppReviewStatus, 'pending'>;

/** Whether a review item in `status` can still take `decision` (the review_decision machine). */
export function canResolveWhatsAppReview(status: string, decision: WhatsAppReviewDecision): boolean {
  return hasEdge(reviewDecisionMachine, status, decision);
}

/** Meta states of a template (`api_whatsapp_admin_set_template_status` p_meta_status). */
export const WHATSAPP_TEMPLATE_META_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'paused', 'deprecated'] as const;
export type WhatsAppTemplateMetaStatus = (typeof WHATSAPP_TEMPLATE_META_STATUSES)[number];

export function isWhatsAppTemplateMetaStatus(value: string): value is WhatsAppTemplateMetaStatus {
  return (WHATSAPP_TEMPLATE_META_STATUSES as readonly string[]).includes(value);
}

/** The send limits and their allowed ranges (the table's check constraints). */
export const WHATSAPP_SEND_LIMIT_RANGES = {
  perUserHour: [1, 1000],
  perUserDay: [1, 10000],
  replyPerPhoneHour: [1, 10000],
  globalPerMinute: [1, 100000],
  globalTemplateRecipientsDay: [1, 1000000],
  inboundPerPhoneMinute: [1, 10000],
  llmPerPhoneDay: [1, 10000],
  llmGlobalDay: [1, 1000000],
  maxAttempts: [1, 20],
  backoffBaseSeconds: [1, 3600],
} as const satisfies Record<string, readonly [number, number]>;

export type WhatsAppSendLimitField = keyof typeof WHATSAPP_SEND_LIMIT_RANGES;
export const WHATSAPP_SEND_LIMIT_FIELDS = Object.keys(WHATSAPP_SEND_LIMIT_RANGES) as WhatsAppSendLimitField[];

export type WhatsAppSendLimits = Readonly<Record<WhatsAppSendLimitField, number>> & {
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
};

/** The limits to change; fields left out keep their value. */
export type WhatsAppSendLimitsPatch = Partial<Record<WhatsAppSendLimitField, number>>;

/** The fields of a patch that are not whole numbers inside their range. Empty = valid. */
export function invalidWhatsAppSendLimitFields(patch: WhatsAppSendLimitsPatch): WhatsAppSendLimitField[] {
  return WHATSAPP_SEND_LIMIT_FIELDS.filter((field) => {
    const value = patch[field];
    if (value === undefined) return false;
    const [min, max] = WHATSAPP_SEND_LIMIT_RANGES[field];
    return !Number.isInteger(value) || value < min || value > max;
  });
}

export type WhatsAppAdminErrorCode =
  | 'forbidden'
  | 'channel_missing'
  | 'outbound_not_found'
  | 'review_not_found'
  | 'template_not_found'
  | 'invalid_status'
  | 'not_resendable'
  | 'invalid_decision'
  | 'invalid_transition'
  | 'offer_photo_required'
  | 'invalid_limits'
  | 'unknown';

export const WHATSAPP_ADMIN_ERROR_CODES: readonly WhatsAppAdminErrorCode[] = [
  'forbidden', 'channel_missing', 'outbound_not_found', 'review_not_found', 'template_not_found', 'invalid_status',
  'not_resendable', 'invalid_decision', 'invalid_transition', 'offer_photo_required', 'invalid_limits', 'unknown',
];

export class WhatsAppAdminError extends Error {
  constructor(
    public readonly code: WhatsAppAdminErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'WhatsAppAdminError';
  }
}

export function isWhatsAppAdminError(e: unknown): e is WhatsAppAdminError {
  return e instanceof WhatsAppAdminError;
}
