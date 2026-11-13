// #939 — the admin WhatsApp console over the api_whatsapp_admin_* RPCs (M22 / L7, the
// migration `whatsapp_admin_console`). The tables live in `integrations`; every call goes
// through a definer RPC that checks the caller's staff role (moderator+, super admin for the
// send limits and template status). Consent, outbound and review lists are keyset-paged
// (`cursor`); refusals map to `WhatsAppAdminError` by their stable message.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IWhatsAppAdminRepository,
  SetWhatsAppTemplateStatusInput,
  WhatsAppOutboundListFilters,
  WhatsAppPageQuery,
  WhatsAppReviewListFilters,
} from '@kc/application';
import type {
  WhatsAppAdminOverview,
  WhatsAppChannelConfig,
  WhatsAppConsentRow,
  WhatsAppConversationRow,
  WhatsAppMatchSentRow,
  WhatsAppOutboundRow,
  WhatsAppPage,
  WhatsAppRateHit,
  WhatsAppReviewDecision,
  WhatsAppReviewItem,
  WhatsAppSendLimits,
  WhatsAppSendLimitsPatch,
  WhatsAppTemplateRow,
} from '@kc/domain';
import type { Database } from '../database.types';
import { toBackendUnavailable } from '../rpc/backendUnavailable';
import type { CallResult } from '../rpc/mapRpcError';
import { asRecord, decodeCursor, readPage } from './backOfficePaging';
import {
  at,
  mapChannel,
  mapConsent,
  mapOutbound,
  mapOverview,
  mapReview,
  mapSendLimits,
  mapTemplate,
  sendLimitsToDb,
  toWhatsAppAdminError,
} from './whatsappAdminRows';

type Client = SupabaseClient<Database>;

const DEFAULT_PAGE = 50;

function unwrap<T>(rpc: string, result: CallResult<T>): T {
  if (!result.error) return result.data;
  throw toBackendUnavailable(`rpc:${rpc}`, result.error) ?? toWhatsAppAdminError(result.error);
}

export class SupabaseWhatsAppAdminRepository implements IWhatsAppAdminRepository {
  constructor(private readonly client: Client) {}

  async getChannel(): Promise<WhatsAppChannelConfig> {
    return mapChannel(unwrap('api_whatsapp_admin_get_channel', await this.client.rpc('api_whatsapp_admin_get_channel')));
  }

  async setChannelEnabled(enabled: boolean): Promise<WhatsAppChannelConfig> {
    const data = unwrap('api_whatsapp_admin_set_channel_enabled',
      await this.client.rpc('api_whatsapp_admin_set_channel_enabled', { p_enabled: enabled }));
    return mapChannel(data);
  }

  async overview(): Promise<WhatsAppAdminOverview> {
    return mapOverview(unwrap('api_whatsapp_admin_overview', await this.client.rpc('api_whatsapp_admin_overview')));
  }

  async listConsent(query: WhatsAppPageQuery): Promise<WhatsAppPage<WhatsAppConsentRow>> {
    const limit = query.limit ?? DEFAULT_PAGE;
    const rows = unwrap('api_whatsapp_admin_list_consent', await this.client.rpc('api_whatsapp_admin_list_consent', {
      p_cursor: decodeCursor(query.cursor) ?? undefined,
      p_limit: limit,
    }));
    return readPage(rows, limit, mapConsent);
  }

  async listOutbound(filters: WhatsAppOutboundListFilters): Promise<WhatsAppPage<WhatsAppOutboundRow>> {
    const limit = filters.limit ?? DEFAULT_PAGE;
    const rows = unwrap('api_whatsapp_admin_list_outbound', await this.client.rpc('api_whatsapp_admin_list_outbound', {
      p_status: filters.status ?? undefined,
      p_cursor: decodeCursor(filters.cursor) ?? undefined,
      p_limit: limit,
    }));
    return readPage(rows, limit, mapOutbound);
  }

  async listRateHits(limit = DEFAULT_PAGE): Promise<WhatsAppRateHit[]> {
    const rows = unwrap('api_whatsapp_admin_list_rate_hits',
      await this.client.rpc('api_whatsapp_admin_list_rate_hits', { p_limit: limit }));
    return (rows ?? []).map((r) => ({
      bucket: r.bucket,
      windowStart: at(r.window_start) ?? new Date(0),
      expiresAt: at(r.expires_at),
      hits: r.hits ?? 0,
    }));
  }

  async listRecentMatches(limit = DEFAULT_PAGE): Promise<WhatsAppMatchSentRow[]> {
    const rows = unwrap('api_whatsapp_admin_list_recent_matches',
      await this.client.rpc('api_whatsapp_admin_list_recent_matches', { p_limit: limit }));
    return (rows ?? []).map((r) => ({
      outboundId: r.outbound_id,
      userId: r.user_id ?? null,
      waIdMasked: r.wa_id_masked ?? null,
      templateName: r.template_name ?? null,
      language: r.language ?? 'he',
      status: r.status,
      payload: asRecord(r.payload) ?? {},
      createdAt: at(r.created_at) ?? new Date(0),
      sentAt: at(r.sent_at),
    }));
  }

  async listConversations(limit = DEFAULT_PAGE): Promise<WhatsAppConversationRow[]> {
    const rows = unwrap('api_whatsapp_admin_list_conversations',
      await this.client.rpc('api_whatsapp_admin_list_conversations', { p_limit: limit }));
    return (rows ?? []).map((r) => ({
      sessionId: r.session_id,
      waIdMasked: r.wa_id_masked ?? null,
      userId: r.user_id ?? null,
      state: r.state,
      postId: r.post_id ?? null,
      confidence: r.confidence ?? null,
      updatedAt: at(r.updated_at) ?? new Date(0),
      createdAt: at(r.created_at) ?? new Date(0),
    }));
  }

  async resend(outboundId: string): Promise<string> {
    const data = unwrap('api_whatsapp_admin_resend',
      await this.client.rpc('api_whatsapp_admin_resend', { p_outbound_id: outboundId }));
    return data ?? 'queued';
  }

  async blockUser(userId: string): Promise<void> {
    unwrap('api_whatsapp_admin_block_user', await this.client.rpc('api_whatsapp_admin_block_user', { p_user_id: userId }));
  }

  async listReviews(filters: WhatsAppReviewListFilters): Promise<WhatsAppPage<WhatsAppReviewItem>> {
    const limit = filters.limit ?? DEFAULT_PAGE;
    const rows = unwrap('api_whatsapp_admin_review_list', await this.client.rpc('api_whatsapp_admin_review_list', {
      p_status: filters.status ?? undefined,
      p_cursor: decodeCursor(filters.cursor) ?? undefined,
      p_limit: limit,
    }));
    return readPage(rows, limit, mapReview);
  }

  async resolveReview(reviewId: string, decision: WhatsAppReviewDecision): Promise<WhatsAppReviewDecision> {
    const data = unwrap('api_whatsapp_admin_review_resolve', await this.client.rpc('api_whatsapp_admin_review_resolve', {
      p_review_id: reviewId,
      p_decision: decision,
    }));
    return data === 'rejected' ? 'rejected' : decision;
  }

  async listTemplates(): Promise<WhatsAppTemplateRow[]> {
    const rows = unwrap('api_whatsapp_admin_list_templates', await this.client.rpc('api_whatsapp_admin_list_templates'));
    return (rows ?? []).map(mapTemplate);
  }

  async setSendLimits(patch: WhatsAppSendLimitsPatch): Promise<WhatsAppSendLimits> {
    const data = unwrap('api_whatsapp_admin_set_send_limits',
      await this.client.rpc('api_whatsapp_admin_set_send_limits', { p_limits: sendLimitsToDb(patch) }));
    return mapSendLimits(data);
  }

  async setTemplateStatus(input: SetWhatsAppTemplateStatusInput): Promise<void> {
    unwrap('api_whatsapp_admin_set_template_status', await this.client.rpc('api_whatsapp_admin_set_template_status', {
      p_template_name: input.templateName,
      p_language_code: input.languageCode,
      p_meta_status: input.metaStatus,
      p_meta_template_id: input.metaTemplateId ?? undefined,
    }));
  }
}
