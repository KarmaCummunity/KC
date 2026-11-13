// #939 — the admin WhatsApp console adapter: argument shapes of the api_whatsapp_admin_* RPCs,
// keyset paging, row mapping and error mapping by stable message.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendUnavailableError, WhatsAppAdminError } from '@kc/domain';
import type { Database } from '../../database.types';
import { SupabaseWhatsAppAdminRepository } from '../SupabaseWhatsAppAdminRepository';

type Rpc = (name: string, args?: unknown) => unknown;

function repoWith(rpc: Rpc) {
  const spy = vi.fn(async (name: string, args?: unknown) => rpc(name, args));
  const client = { rpc: spy } as unknown as SupabaseClient<Database>;
  return { repo: new SupabaseWhatsAppAdminRepository(client), rpc: spy };
}
const ok = (data: unknown) => () => ({ data, error: null });
const refuse = (message: string, code = 'P0001') => () => ({ data: null, error: { code, message } });

const OUT_CURSOR = { created_at: '2026-11-10T10:00:00+00:00', id: 'o1' };
const OUTBOUND = {
  outbound_id: 'o1', user_id: 'u1', wa_id_masked: '•••1234', kind: 'template', template_name: 'match_found_v1',
  language: 'he', status: 'failed', attempts: 2, last_error: 'meta 500', created_at: '2026-11-10T10:00:00Z',
  sent_at: null, next_attempt_at: null, cursor: OUT_CURSOR,
};
const CONSENT = {
  identity_id: 'i1', user_id: null, wa_id_masked: '•••9876', consent_status: 'opted_out', opted_in: false,
  opted_in_at: null, opted_out_at: '2026-11-09T00:00:00Z', preferred_language: 'he', last_inbound_at: null,
  updated_at: '2026-11-09T00:00:00Z', cursor: { at: '2026-11-09T00:00:00+00:00', id: 'i1' },
};
const REVIEW = {
  review_id: 'r1', session_id: 's1', post_id: 'p1', post_title: 'Sofa', post_status: 'draft', owner_id: 'u1',
  reason: 'low_confidence_extraction', status: 'pending', confidence: 0.6, reviewer_id: null,
  created_at: '2026-11-11T00:00:00Z', resolved_at: null, cursor: { created_at: '2026-11-11T00:00:00+00:00', id: 'r1' },
};

describe('SupabaseWhatsAppAdminRepository lists', () => {
  it('pages the outbound list by status and cursor and maps its rows', async () => {
    const { repo, rpc } = repoWith(ok([OUTBOUND]));
    const page = await repo.listOutbound({ status: 'failed', limit: 1 });
    expect(rpc).toHaveBeenCalledWith('api_whatsapp_admin_list_outbound', { p_status: 'failed', p_cursor: undefined, p_limit: 1 });
    expect(page.rows[0]).toMatchObject({ outboundId: 'o1', status: 'failed', attempts: 2, lastError: 'meta 500', sentAt: null });
    expect(page.rows[0]?.createdAt).toEqual(new Date('2026-11-10T10:00:00Z'));
    expect(page.nextCursor).toBe(JSON.stringify(OUT_CURSOR));
    await repo.listOutbound({ cursor: page.nextCursor!, limit: 50 });
    expect(rpc.mock.calls[1]?.[1]).toEqual({ p_status: undefined, p_cursor: OUT_CURSOR, p_limit: 50 });
  });

  it('pages consent with no total and keeps the identity of an unlinked number', async () => {
    const { repo, rpc } = repoWith(ok([CONSENT]));
    const page = await repo.listConsent({});
    expect(rpc).toHaveBeenCalledWith('api_whatsapp_admin_list_consent', { p_cursor: undefined, p_limit: 50 });
    expect(page).toEqual({ rows: [expect.objectContaining({ identityId: 'i1', userId: null, optedIn: false })], nextCursor: null });
    expect(page).not.toHaveProperty('totalCount');
  });

  it('pages the review queue and resolves an item', async () => {
    const { repo, rpc } = repoWith((name) => (name === 'api_whatsapp_admin_review_resolve'
      ? { data: 'approved', error: null } : { data: [REVIEW], error: null }));
    const page = await repo.listReviews({ status: 'pending' });
    expect(rpc).toHaveBeenCalledWith('api_whatsapp_admin_review_list', { p_status: 'pending', p_cursor: undefined, p_limit: 50 });
    expect(page.rows[0]).toMatchObject({ reviewId: 'r1', postTitle: 'Sofa', confidence: 0.6, resolvedAt: null });
    expect(await repo.resolveReview('r1', 'approved')).toBe('approved');
    expect(rpc).toHaveBeenLastCalledWith('api_whatsapp_admin_review_resolve', { p_review_id: 'r1', p_decision: 'approved' });
  });

  it('maps the short lists: rate hits, matches, conversations, templates', async () => {
    const { repo } = repoWith((name) => {
      if (name === 'api_whatsapp_admin_list_rate_hits') return { data: [{ bucket: 'wa_in:•••1234', window_start: '2026-11-10T10:00:00Z', expires_at: null, hits: 21 }], error: null };
      if (name === 'api_whatsapp_admin_list_recent_matches') return { data: [{ outbound_id: 'o2', user_id: 'u1', wa_id_masked: null, template_name: 'match_found_v1', language: 'en', status: 'sent', payload: { world_label_en: 'Items' }, created_at: '2026-11-10T10:00:00Z', sent_at: '2026-11-10T10:01:00Z' }], error: null };
      if (name === 'api_whatsapp_admin_list_conversations') return { data: [{ session_id: 's1', wa_id_masked: '•••1', user_id: 'u1', state: 'published', post_id: 'p1', confidence: 0.9, updated_at: '2026-11-10T10:00:00Z', created_at: '2026-11-10T09:00:00Z' }], error: null };
      return { data: [{ template_name: 'match_found_v1', language_code: 'he', category: 'utility', body_preview: 'x', params: ['world_label'], registry_version: 1, is_approved: false, meta_status: 'draft', meta_template_id: null, updated_at: '2026-11-01T00:00:00Z' }], error: null };
    });
    expect((await repo.listRateHits(10))[0]).toMatchObject({ bucket: 'wa_in:•••1234', hits: 21, expiresAt: null });
    expect((await repo.listRecentMatches())[0]).toMatchObject({ templateName: 'match_found_v1', payload: { world_label_en: 'Items' } });
    expect((await repo.listConversations())[0]).toMatchObject({ postId: 'p1', confidence: 0.9, state: 'published' });
    expect((await repo.listTemplates())[0]).toMatchObject({ params: ['world_label'], metaStatus: 'draft', isApproved: false });
  });
});

describe('SupabaseWhatsAppAdminRepository channel, overview and writes', () => {
  it('maps the channel and the overview, including the pending reviews', async () => {
    const { repo, rpc } = repoWith((name) => (name === 'api_whatsapp_admin_overview'
      ? { data: { channel_enabled: true, since: '2026-11-06T00:00:00Z', outbound_sent: 4, review_pending: 3, rate_hits_7d: 2 }, error: null }
      : { data: { is_enabled: true, phone_number_id: null, graph_api_version: 'v21.0', updated_at: null, updated_by: 'a1' }, error: null }));
    expect(await repo.setChannelEnabled(true)).toEqual({ isEnabled: true, phoneNumberId: null, graphApiVersion: 'v21.0', updatedAt: null, updatedBy: 'a1' });
    expect(rpc).toHaveBeenCalledWith('api_whatsapp_admin_set_channel_enabled', { p_enabled: true });
    expect(await repo.overview()).toMatchObject({ channelEnabled: true, outboundSent: 4, reviewPending: 3, rateHits7d: 2, outboundFailed: 0 });
  });

  it('resends, blocks and sets a template status with the RPC argument names', async () => {
    const { repo, rpc } = repoWith(ok('queued'));
    expect(await repo.resend('o1')).toBe('queued');
    await repo.blockUser('u1');
    await repo.setTemplateStatus({ templateName: 'match_found_v1', languageCode: 'en', metaStatus: 'approved' });
    expect(rpc.mock.calls.map((c) => c[1])).toEqual([
      { p_outbound_id: 'o1' },
      { p_user_id: 'u1' },
      { p_template_name: 'match_found_v1', p_language_code: 'en', p_meta_status: 'approved', p_meta_template_id: undefined },
    ]);
  });

  it('reads the current send limits', async () => {
    const row = { per_user_hour: 5, per_user_day: 20, reply_per_phone_hour: 30, global_per_minute: 60,
      global_template_recipients_day: 1000, inbound_per_phone_minute: 20, llm_per_phone_day: 30, llm_global_day: 2000,
      max_attempts: 5, backoff_base_seconds: 30, updated_by: null, updated_at: '2026-11-12T00:00:00Z' };
    const { repo, rpc } = repoWith(ok(row));
    await expect(repo.getSendLimits()).resolves.toMatchObject({ perUserHour: 5, llmGlobalDay: 2000, updatedBy: null });
    expect(rpc).toHaveBeenCalledWith('api_whatsapp_admin_get_send_limits');
  });

  it('sends only the given send limits, in column names, and maps the row back', async () => {
    const row = { per_user_hour: 6, per_user_day: 20, reply_per_phone_hour: 30, global_per_minute: 60,
      global_template_recipients_day: 1000, inbound_per_phone_minute: 20, llm_per_phone_day: 30, llm_global_day: 2000,
      max_attempts: 7, backoff_base_seconds: 30, updated_by: 'a1', updated_at: '2026-11-12T00:00:00Z' };
    const { repo, rpc } = repoWith(ok(row));
    const limits = await repo.setSendLimits({ perUserHour: 6, maxAttempts: 7 });
    expect(rpc).toHaveBeenCalledWith('api_whatsapp_admin_set_send_limits', { p_limits: { per_user_hour: 6, max_attempts: 7 } });
    expect(limits).toMatchObject({ perUserHour: 6, maxAttempts: 7, globalTemplateRecipientsDay: 1000, updatedBy: 'a1' });
  });
});

describe('SupabaseWhatsAppAdminRepository errors', () => {
  it.each([
    'forbidden', 'not_resendable', 'invalid_status', 'outbound_not_found', 'channel_missing', 'invalid_decision',
    'invalid_transition', 'offer_photo_required', 'invalid_limits', 'review_not_found', 'template_not_found',
  ])('maps %s to its domain code', async (message) => {
    const { repo } = repoWith(refuse(message));
    await expect(repo.resend('o1')).rejects.toMatchObject({ name: 'WhatsAppAdminError', code: message });
  });

  it('maps a 42501 refusal to forbidden and anything else to unknown', async () => {
    await expect(repoWith(refuse('forbidden', '42501')).repo.overview()).rejects.toMatchObject({ code: 'forbidden' });
    const error = await repoWith(refuse('enabled_required')).repo.setChannelEnabled(true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppAdminError);
    expect(error).toMatchObject({ code: 'unknown', message: 'enabled_required' });
  });

  it('reports a missing function as unavailable, not as a console error', async () => {
    const { repo } = repoWith(refuse('Could not find the function', 'PGRST202'));
    const error = await repo.listTemplates().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect(error).toMatchObject({ object: 'rpc:api_whatsapp_admin_list_templates' });
  });
});
