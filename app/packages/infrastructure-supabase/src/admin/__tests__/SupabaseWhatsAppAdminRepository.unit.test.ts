import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isWhatsAppAdminError } from '@kc/domain';
import { SupabaseWhatsAppAdminRepository } from '../SupabaseWhatsAppAdminRepository';

function mockClient(rpcImpl: (name: string, args?: unknown) => unknown): SupabaseClient {
  return { rpc: vi.fn(rpcImpl as never) } as unknown as SupabaseClient;
}

describe('SupabaseWhatsAppAdminRepository', () => {
  it('overview maps counts and channel flag', async () => {
    const spy = vi.fn(() => ({
      data: {
        channel_enabled: true,
        since: '2026-10-10T00:00:00.000Z',
        outbound_queued: 1,
        outbound_sent: 2,
        outbound_failed: 3,
        outbound_skipped: 4,
        consent_opted_in: 5,
        consent_opted_out: 6,
        sessions_7d: 7,
        matches_sent_7d: 8,
        rate_hits_7d: 9,
      },
      error: null,
    }));
    const repo = new SupabaseWhatsAppAdminRepository(mockClient(spy as never));
    const o = await repo.overview();
    expect(spy).toHaveBeenCalledWith('api_whatsapp_admin_overview');
    expect(o.channelEnabled).toBe(true);
    expect(o.outboundQueued).toBe(1);
    expect(o.matchesSent7d).toBe(8);
    expect(o.since).toBeInstanceOf(Date);
  });

  it('listConsent maps masked rows and total', async () => {
    const spy = vi.fn(() => ({
      data: [{
        user_id: 'u1',
        wa_id_masked: '********2222',
        consent_status: 'opted_in',
        opted_in: true,
        opted_in_at: '2026-10-01T00:00:00.000Z',
        opted_out_at: null,
        preferred_language: 'he',
        last_inbound_at: null,
        updated_at: '2026-10-02T00:00:00.000Z',
        total_count: 1,
      }],
      error: null,
    }));
    const repo = new SupabaseWhatsAppAdminRepository(mockClient(spy as never));
    const page = await repo.listConsent(20, 0);
    expect(spy).toHaveBeenCalledWith('api_whatsapp_admin_list_consent', { p_limit: 20, p_offset: 0 });
    expect(page.totalCount).toBe(1);
    expect(page.rows[0]?.waIdMasked).toBe('********2222');
    expect(page.rows[0]?.optedIn).toBe(true);
  });

  it('setChannelEnabled / resend / block forward args', async () => {
    const spy = vi.fn((name: string) => {
      if (name === 'api_whatsapp_admin_set_channel_enabled') {
        return { data: { is_enabled: false, phone_number_id: null, graph_api_version: 'v21.0', updated_at: '2026-10-17T00:00:00.000Z' }, error: null };
      }
      if (name === 'api_whatsapp_admin_resend') return { data: 'queued', error: null };
      return { data: null, error: null };
    });
    const repo = new SupabaseWhatsAppAdminRepository(mockClient(spy as never));
    const ch = await repo.setChannelEnabled(false);
    expect(ch.isEnabled).toBe(false);
    expect(await repo.resend('o1')).toBe('queued');
    await repo.blockUser('u1');
    expect(spy).toHaveBeenCalledWith('api_whatsapp_admin_block_user', { p_user_id: 'u1' });
  });

  it('maps 42501 to forbidden', async () => {
    const repo = new SupabaseWhatsAppAdminRepository(
      mockClient(() => ({ data: null, error: { code: '42501', message: 'denied' } })),
    );
    await expect(repo.overview()).rejects.toSatisfy(
      (e) => isWhatsAppAdminError(e) && e.code === 'forbidden',
    );
  });

  it('listOutbound / rateHits / matches / conversations map rows', async () => {
    const repo = new SupabaseWhatsAppAdminRepository(mockClient((name) => {
      if (name === 'api_whatsapp_admin_list_outbound') {
        return {
          data: [{
            outbound_id: 'o1', user_id: 'u', wa_id_masked: '***1', kind: 'template',
            template_name: 'match_found_v1', language: 'he', status: 'failed', attempts: 2,
            last_error: 'boom', created_at: '2026-10-17T00:00:00.000Z', sent_at: null,
            next_attempt_at: '2026-10-17T00:01:00.000Z', total_count: 1,
          }],
          error: null,
        };
      }
      if (name === 'api_whatsapp_admin_list_rate_hits') {
        return { data: [{ bucket: 'inbound:x', window_start: '2026-10-17T00:00:00.000Z', hits: 3 }], error: null };
      }
      if (name === 'api_whatsapp_admin_list_recent_matches') {
        return {
          data: [{
            outbound_id: 'o2', user_id: 'u', wa_id_masked: '***2', language: 'en', status: 'sent',
            payload: { world_label: 'Items' }, created_at: '2026-10-17T00:00:00.000Z', sent_at: '2026-10-17T00:00:01.000Z',
          }],
          error: null,
        };
      }
      if (name === 'api_whatsapp_admin_list_conversations') {
        return {
          data: [{
            session_id: 's1', wa_id_masked: '***3', user_id: 'u', state: 'collecting',
            listing_id: null, updated_at: '2026-10-17T00:00:00.000Z', created_at: '2026-10-17T00:00:00.000Z',
          }],
          error: null,
        };
      }
      return { data: { is_enabled: true, phone_number_id: 'p', graph_api_version: 'v21.0', updated_at: null }, error: null };
    }));
    expect((await repo.listOutbound({ status: 'failed' })).rows[0]?.status).toBe('failed');
    expect((await repo.listRateHits(10))[0]?.hits).toBe(3);
    expect((await repo.listRecentMatches(10))[0]?.status).toBe('sent');
    expect((await repo.listConversations(10))[0]?.state).toBe('collecting');
    expect((await repo.getChannel()).isEnabled).toBe(true);
  });

  it('maps not_found / invalid_status / not_resendable / unknown', async () => {
    const cases: Array<{ err: { code?: string; message: string }; code: string }> = [
      { err: { code: 'P0002', message: 'missing row' }, code: 'not_found' },
      { err: { message: 'invalid_status' }, code: 'invalid_status' },
      { err: { message: 'not_resendable' }, code: 'not_resendable' },
      { err: { message: 'boom' }, code: 'unknown' },
    ];
    for (const c of cases) {
      const repo = new SupabaseWhatsAppAdminRepository(
        mockClient(() => ({ data: null, error: c.err })),
      );
      await expect(repo.overview()).rejects.toSatisfy(
        (e) => isWhatsAppAdminError(e) && e.code === c.code,
      );
    }
  });

  it('empty list responses yield zero totals', async () => {
    const repo = new SupabaseWhatsAppAdminRepository(
      mockClient(() => ({ data: [], error: null })),
    );
    expect(await repo.listConsent()).toEqual({ rows: [], totalCount: 0 });
    expect(await repo.listOutbound({})).toEqual({ rows: [], totalCount: 0 });
    expect(await repo.listRateHits()).toEqual([]);
    expect(await repo.listRecentMatches()).toEqual([]);
    expect(await repo.listConversations()).toEqual([]);
  });

  it('handles null data in all list methods and resend fallback', async () => {
    const repo = new SupabaseWhatsAppAdminRepository(
      mockClient(() => ({ data: null, error: null })),
    );
    expect(await repo.listConsent()).toEqual({ rows: [], totalCount: 0 });
    expect(await repo.listOutbound({})).toEqual({ rows: [], totalCount: 0 });
    expect(await repo.listRateHits()).toEqual([]);
    expect(await repo.listRecentMatches()).toEqual([]);
    expect(await repo.listConversations()).toEqual([]);
    expect(await repo.resend('o_1')).toBe('queued');
  });

  it('overview coalesces missing counts to 0', async () => {
    const repo = new SupabaseWhatsAppAdminRepository(
      mockClient(() => ({ data: { since: '2026-10-10T00:00:00.000Z' }, error: null })),
    );
    const o = await repo.overview();
    expect(o.outboundQueued).toBe(0);
    expect(o.outboundSent).toBe(0);
    expect(o.outboundFailed).toBe(0);
    expect(o.outboundSkipped).toBe(0);
    expect(o.consentOptedIn).toBe(0);
    expect(o.consentOptedOut).toBe(0);
    expect(o.sessions7d).toBe(0);
    expect(o.matchesSent7d).toBe(0);
    expect(o.rateHits7d).toBe(0);
  });

  it('toError maps forbidden message and not_found message', async () => {
    const repoForbidden = new SupabaseWhatsAppAdminRepository(
      mockClient(() => ({ data: null, error: { message: 'forbidden' } })),
    );
    await expect(repoForbidden.overview()).rejects.toSatisfy(
      (e) => isWhatsAppAdminError(e) && e.code === 'forbidden',
    );

    const repoNotFound = new SupabaseWhatsAppAdminRepository(
      mockClient(() => ({ data: null, error: { message: 'item_not_found' } })),
    );
    await expect(repoNotFound.overview()).rejects.toSatisfy(
      (e) => isWhatsAppAdminError(e) && e.code === 'not_found',
    );
  });

  it('maps non-string fields with defaults in listOutbound and listConsent', async () => {
    const repo = new SupabaseWhatsAppAdminRepository(
      mockClient((name) => {
        if (name === 'api_whatsapp_admin_list_outbound') {
          return {
            data: [{
              outbound_id: 'o_no_type',
              kind: null,
              language: null,
              status: 'queued',
              created_at: '2026-10-17T00:00:00.000Z',
              total_count: 1,
            }],
            error: null,
          };
        }
        if (name === 'api_whatsapp_admin_list_consent') {
          return {
            data: [{
              consent_status: null,
              updated_at: '2026-10-17T00:00:00.000Z',
              total_count: 1,
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    );
    const outbound = await repo.listOutbound({});
    expect(outbound.rows[0]?.kind).toBe('template');
    expect(outbound.rows[0]?.language).toBe('he');

    const consent = await repo.listConsent();
    expect(consent.rows[0]?.consentStatus).toBe('unknown');
  });

});
