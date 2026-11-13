// #1090 — the member's WhatsApp link adapter: RPC names and arguments, status mapping and
// error mapping by stable message.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BackendUnavailableError } from '@kc/domain';
import type { Database } from '../../database.types';
import { SupabaseWhatsAppLinkRepository } from '../SupabaseWhatsAppLinkRepository';

type Rpc = (name: string, args?: unknown) => unknown;

function repoWith(rpc: Rpc) {
  const spy = vi.fn(async (name: string, args?: unknown) => rpc(name, args));
  const client = { rpc: spy } as unknown as SupabaseClient<Database>;
  return { repo: new SupabaseWhatsAppLinkRepository(client), rpc: spy };
}

const STATUS = { linked: true, wa_id_masked: '•••1234', is_pro: true, consent_opted_in: true, phone_opted_out: false };

describe('SupabaseWhatsAppLinkRepository', () => {
  it('maps the link status', async () => {
    const { repo, rpc } = repoWith(() => ({ data: STATUS, error: null }));
    expect(await repo.getMyStatus()).toEqual({
      linked: true, waIdMasked: '•••1234', isPro: true, consentOptedIn: true, phoneOptedOut: false,
    });
    expect(rpc.mock.calls[0]?.[0]).toBe('api_whatsapp_my_link_status');
  });

  it('never shows a masked number for an unlinked member', async () => {
    const { repo } = repoWith(() => ({ data: { ...STATUS, linked: false }, error: null }));
    expect((await repo.getMyStatus()).waIdMasked).toBeNull();
  });

  it('reads a link code with its expiry', async () => {
    const { repo } = repoWith(() => ({ data: { code: '012345', expires_at: '2026-11-13T10:10:00Z' }, error: null }));
    expect(await repo.createLinkCode()).toEqual({ code: '012345', expiresAt: new Date('2026-11-13T10:10:00Z') });
  });

  it('refuses a malformed link code instead of showing it', async () => {
    const { repo } = repoWith(() => ({ data: { code: '12', expires_at: 'x' }, error: null }));
    await expect(repo.createLinkCode()).rejects.toMatchObject({ name: 'WhatsAppLinkError', code: 'unknown' });
  });

  it('maps pro_required and rate_limited from the code RPC', async () => {
    for (const message of ['pro_required', 'rate_limited', 'account_not_active']) {
      const { repo } = repoWith(() => ({ data: null, error: { code: 'P0001', message } }));
      await expect(repo.createLinkCode()).rejects.toMatchObject({ code: message });
    }
    const { repo } = repoWith(() => ({ data: null, error: { code: '42501', message: 'unauthenticated' } }));
    await expect(repo.unlink()).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('sets the consent and returns the new status', async () => {
    const { repo, rpc } = repoWith(() => ({ data: { ...STATUS, consent_opted_in: false }, error: null }));
    expect((await repo.setMatchConsent(false)).consentOptedIn).toBe(false);
    expect(rpc).toHaveBeenCalledWith('api_whatsapp_set_match_consent', { p_opted_in: false });
  });

  it('reports a missing function as unavailable', async () => {
    const { repo } = repoWith(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
    await expect(repo.getMyStatus()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
