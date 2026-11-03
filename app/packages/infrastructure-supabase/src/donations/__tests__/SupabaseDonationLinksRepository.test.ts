import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DonationLinkError } from '@kc/application';
import { SupabaseDonationLinksRepository } from '../SupabaseDonationLinksRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeOpts {
  listData?: any[] | null;
  listError?: { message: string } | null;
  invokeData?: { ok: boolean; code?: string; link?: any } | null;
  invokeError?: { message: string } | null;
  updateError?: { message: string } | null;
  deleteError?: { message: string } | null;
  rpcError?: { message: string } | null;
  userId?: string | null;
}
interface Calls {
  invokes: { fn: string; body: unknown }[];
  rpcs: { fn: string; args: unknown }[];
  updates: { row: any }[];
}

function makeFakeClient(opts: FakeOpts = {}): { client: SupabaseClient<any>; calls: Calls } {
  const calls: Calls = { invokes: [], rpcs: [], updates: [] };
  const result = () => Promise.resolve({ data: opts.listData ?? [], error: opts.listError ?? null });
  const client = {
    auth: {
      getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }),
    },
    functions: {
      invoke: async (fn: string, params: { body: unknown }) => {
        calls.invokes.push({ fn, body: params.body });
        return { data: opts.invokeData ?? null, error: opts.invokeError ?? null };
      },
    },
    rpc: async (fn: string, args: unknown) => {
      calls.rpcs.push({ fn, args });
      return { data: null, error: opts.rpcError ?? null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () => ({
              limit: () => result(),
            }),
          }),
        }),
      }),
      update: (row: any) => ({
        eq: async () => {
          calls.updates.push({ row });
          return { error: opts.updateError ?? null };
        },
      }),
      delete: () => ({
        eq: async () => ({ error: opts.deleteError ?? null }),
      }),
    }),
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

const LINK_ROW = {
  id: 'l_1',
  category_slug: 'food',
  url: 'https://x.org',
  display_name: 'Food bank',
  description: null,
  submitted_by: 'u_me',
  validated_at: '2026-05-16T12:00:00.000Z',
  hidden_at: null,
  created_at: '2026-05-16T11:00:00.000Z',
};

describe('SupabaseDonationLinksRepository — listByCategory', () => {
  it('maps rows from snake_case to DonationLink', async () => {
    const { client } = makeFakeClient({ listData: [LINK_ROW] });
    const out = await new SupabaseDonationLinksRepository(client).listByCategory('food');
    expect(out[0]).toMatchObject({ id: 'l_1', categorySlug: 'food', url: 'https://x.org' });
  });

  it('returns [] when data is null', async () => {
    const { client } = makeFakeClient({ listData: null });
    expect(await new SupabaseDonationLinksRepository(client).listByCategory('food')).toEqual([]);
  });

  it('throws DonationLinkError("network") on query failure', async () => {
    const { client } = makeFakeClient({ listError: { message: 'transport' } });
    await expect(new SupabaseDonationLinksRepository(client).listByCategory('food')).rejects.toMatchObject({
      name: 'DonationLinkError',
      code: 'network',
    });
  });
});

describe('SupabaseDonationLinksRepository — addViaEdgeFunction', () => {
  it('invokes validate-donation-link with snake_case body and maps the returned link', async () => {
    const { client, calls } = makeFakeClient({ invokeData: { ok: true, link: LINK_ROW } });
    const out = await new SupabaseDonationLinksRepository(client).addViaEdgeFunction({
      categorySlug: 'food',
      url: 'https://x.org',
      displayName: 'Food bank',
      description: null,
    });
    expect(calls.invokes[0]).toEqual({
      fn: 'validate-donation-link',
      body: { category_slug: 'food', url: 'https://x.org', display_name: 'Food bank', description: null },
    });
    expect(out.id).toBe('l_1');
  });

  it('throws DonationLinkError("network") when the invoke errors', async () => {
    const { client } = makeFakeClient({ invokeError: { message: 'fetch failed' } });
    await expect(
      new SupabaseDonationLinksRepository(client).addViaEdgeFunction({
        categorySlug: 'food', url: 'https://x.org', displayName: 'F',
      }),
    ).rejects.toMatchObject({ name: 'DonationLinkError', code: 'network' });
  });

  it.each([
    ['invalid_input'],
    ['invalid_url'],
    ['unreachable'],
    ['rate_limited'],
    ['unauthorized'],
    ['forbidden'],
  ])('routes ok=false with code=%s → DonationLinkError(%s)', async (code) => {
    const { client } = makeFakeClient({ invokeData: { ok: false, code } });
    await expect(
      new SupabaseDonationLinksRepository(client).addViaEdgeFunction({
        categorySlug: 'food', url: 'https://x.org', displayName: 'F',
      }),
    ).rejects.toMatchObject({ name: 'DonationLinkError', code });
  });

  it('falls back to "unknown" code when ok=false carries no code', async () => {
    const { client } = makeFakeClient({ invokeData: { ok: false } });
    await expect(
      new SupabaseDonationLinksRepository(client).addViaEdgeFunction({
        categorySlug: 'food', url: 'https://x.org', displayName: 'F',
      }),
    ).rejects.toMatchObject({ name: 'DonationLinkError', code: 'unknown' });
  });
});

describe('SupabaseDonationLinksRepository — updateViaEdgeFunction', () => {
  it('invokes validate-donation-link with link_id + snake_case body', async () => {
    const { client, calls } = makeFakeClient({ invokeData: { ok: true, link: LINK_ROW } });
    await new SupabaseDonationLinksRepository(client).updateViaEdgeFunction({
      linkId: 'l_1', categorySlug: 'food', url: 'https://x.org', displayName: 'F',
    });
    expect(calls.invokes[0]?.body).toMatchObject({ link_id: 'l_1', category_slug: 'food' });
  });
});

describe('SupabaseDonationLinksRepository — softHide / deleteById / report', () => {
  it('softHide stamps hidden_at + hidden_by from auth.getUser()', async () => {
    const { client, calls } = makeFakeClient({ userId: 'u_admin' });
    await new SupabaseDonationLinksRepository(client).softHide('l_1');
    expect(calls.updates[0]?.row.hidden_by).toBe('u_admin');
    expect(typeof calls.updates[0]?.row.hidden_at).toBe('string');
  });

  it('softHide forwards null hidden_by when no user is signed in (defensive)', async () => {
    const { client, calls } = makeFakeClient({ userId: null });
    await new SupabaseDonationLinksRepository(client).softHide('l_1');
    expect(calls.updates[0]?.row.hidden_by).toBeNull();
  });

  it('softHide throws DonationLinkError("network") on update error', async () => {
    const { client } = makeFakeClient({ updateError: { message: 'rls denied' } });
    await expect(new SupabaseDonationLinksRepository(client).softHide('l_1')).rejects.toMatchObject({
      name: 'DonationLinkError', code: 'network',
    });
  });

  it('deleteById throws DonationLinkError("network") on delete error', async () => {
    const { client } = makeFakeClient({ deleteError: { message: 'rls denied' } });
    await expect(new SupabaseDonationLinksRepository(client).deleteById('l_1')).rejects.toMatchObject({
      name: 'DonationLinkError', code: 'network',
    });
  });

  it('report calls report_donation_link RPC with { p_link_id }', async () => {
    const { client, calls } = makeFakeClient({});
    await new SupabaseDonationLinksRepository(client).report('l_1');
    expect(calls.rpcs).toEqual([{ fn: 'report_donation_link', args: { p_link_id: 'l_1' } }]);
  });

  it('report throws DonationLinkError("network") on RPC error', async () => {
    const { client } = makeFakeClient({ rpcError: { message: 'transport' } });
    await expect(new SupabaseDonationLinksRepository(client).report('l_1')).rejects.toBeInstanceOf(DonationLinkError);
  });
});
