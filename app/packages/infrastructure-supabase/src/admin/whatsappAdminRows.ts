// Row mapping and errors of the admin WhatsApp console (api_whatsapp_admin_*, the migration
// `whatsapp_admin_console`). The server masks every phone number; nullable columns are read
// defensively because the generated types mark them non-null.
import {
  WHATSAPP_ADMIN_ERROR_CODES,
  WHATSAPP_SEND_LIMIT_FIELDS,
  WhatsAppAdminError,
  type WhatsAppAdminErrorCode,
  type WhatsAppAdminOverview,
  type WhatsAppChannelConfig,
  type WhatsAppConsentRow,
  type WhatsAppOutboundRow,
  type WhatsAppReviewItem,
  type WhatsAppSendLimitField,
  type WhatsAppSendLimits,
  type WhatsAppSendLimitsPatch,
  type WhatsAppTemplateRow,
} from '@kc/domain';
import type { Database, Json } from '../database.types';
import type { BackendErrorLike } from '../rpc/backendUnavailable';
import { asRecord } from './backOfficePaging';

type Fn = Database['public']['Functions'];
export type ConsentDbRow = Fn['api_whatsapp_admin_list_consent']['Returns'][number];
export type OutboundDbRow = Fn['api_whatsapp_admin_list_outbound']['Returns'][number];
export type ReviewDbRow = Fn['api_whatsapp_admin_review_list']['Returns'][number];
export type TemplateDbRow = Fn['api_whatsapp_admin_list_templates']['Returns'][number];

const KNOWN: ReadonlySet<string> = new Set(WHATSAPP_ADMIN_ERROR_CODES);

/** A refusal of a console RPC as the domain error its stable message names. */
export function toWhatsAppAdminError(err: BackendErrorLike): WhatsAppAdminError {
  const message = (err.message ?? '').trim();
  if (KNOWN.has(message)) return new WhatsAppAdminError(message as WhatsAppAdminErrorCode);
  if (err.code === '42501') return new WhatsAppAdminError('forbidden');
  return new WhatsAppAdminError('unknown', message || 'whatsapp admin call failed');
}

/** A timestamp column as a Date, or null. */
export function at(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0) || 0);

export function mapChannel(data: Json): WhatsAppChannelConfig {
  const r = asRecord(data) ?? {};
  return {
    isEnabled: r.is_enabled === true,
    phoneNumberId: text(r.phone_number_id),
    graphApiVersion: text(r.graph_api_version),
    updatedAt: at(text(r.updated_at)),
    updatedBy: text(r.updated_by),
  };
}

export function mapOverview(data: Json): WhatsAppAdminOverview {
  const r = asRecord(data) ?? {};
  return {
    channelEnabled: r.channel_enabled === true,
    since: at(text(r.since)) ?? new Date(0),
    outboundQueued: num(r.outbound_queued),
    outboundSent: num(r.outbound_sent),
    outboundFailed: num(r.outbound_failed),
    outboundSkipped: num(r.outbound_skipped),
    consentOptedIn: num(r.consent_opted_in),
    consentOptedOut: num(r.consent_opted_out),
    sessions7d: num(r.sessions_7d),
    matchesSent7d: num(r.matches_sent_7d),
    rateHits7d: num(r.rate_hits_7d),
    reviewPending: num(r.review_pending),
  };
}

export function mapConsent(r: ConsentDbRow): WhatsAppConsentRow {
  return {
    identityId: r.identity_id,
    userId: r.user_id ?? null,
    waIdMasked: r.wa_id_masked ?? null,
    consentStatus: r.consent_status ?? 'unknown',
    optedIn: r.opted_in === true,
    optedInAt: at(r.opted_in_at),
    optedOutAt: at(r.opted_out_at),
    preferredLanguage: r.preferred_language ?? null,
    lastInboundAt: at(r.last_inbound_at),
    updatedAt: at(r.updated_at) ?? new Date(0),
  };
}

export function mapOutbound(r: OutboundDbRow): WhatsAppOutboundRow {
  return {
    outboundId: r.outbound_id,
    userId: r.user_id ?? null,
    waIdMasked: r.wa_id_masked ?? null,
    kind: r.kind ?? 'template',
    templateName: r.template_name ?? null,
    language: r.language ?? 'he',
    status: r.status,
    attempts: num(r.attempts),
    lastError: r.last_error ?? null,
    createdAt: at(r.created_at) ?? new Date(0),
    sentAt: at(r.sent_at),
    nextAttemptAt: at(r.next_attempt_at),
  };
}

export function mapReview(r: ReviewDbRow): WhatsAppReviewItem {
  return {
    reviewId: r.review_id,
    sessionId: r.session_id ?? null,
    postId: r.post_id ?? null,
    postTitle: r.post_title ?? null,
    postStatus: r.post_status ?? null,
    ownerId: r.owner_id ?? null,
    reason: r.reason,
    status: r.status,
    confidence: r.confidence ?? null,
    reviewerId: r.reviewer_id ?? null,
    createdAt: at(r.created_at) ?? new Date(0),
    resolvedAt: at(r.resolved_at),
  };
}

export function mapTemplate(r: TemplateDbRow): WhatsAppTemplateRow {
  const params = Array.isArray(r.params) ? r.params.filter((p): p is string => typeof p === 'string') : [];
  return {
    templateName: r.template_name,
    languageCode: r.language_code,
    category: r.category,
    bodyPreview: r.body_preview,
    params,
    registryVersion: num(r.registry_version),
    isApproved: r.is_approved === true,
    metaStatus: r.meta_status,
    metaTemplateId: r.meta_template_id ?? null,
    updatedAt: at(r.updated_at) ?? new Date(0),
  };
}

/** camelCase limit → the table column. */
const snake = (field: WhatsAppSendLimitField): string => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** The patch as the JSON object `api_whatsapp_admin_set_send_limits` reads (only given fields). */
export function sendLimitsToDb(patch: WhatsAppSendLimitsPatch): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of WHATSAPP_SEND_LIMIT_FIELDS) {
    const value = patch[field];
    if (value !== undefined) out[snake(field)] = value;
  }
  return out;
}

export function mapSendLimits(data: Json): WhatsAppSendLimits {
  const r = asRecord(data) ?? {};
  const limits = Object.fromEntries(WHATSAPP_SEND_LIMIT_FIELDS.map((f) => [f, num(r[snake(f)])])) as
    Record<WhatsAppSendLimitField, number>;
  return { ...limits, updatedAt: at(text(r.updated_at)), updatedBy: text(r.updated_by) };
}
