import { describe, expect, it, vi } from 'vitest';
import { SupabaseRideLegacyLinkRepository } from '../SupabaseRideLegacyLinkRepository';

type AnyClient = ConstructorParameters<typeof SupabaseRideLegacyLinkRepository>[0];

function clientWith(result: { data: unknown; error: { message: string } | null }) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls[m] = args;
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => result);
  const from = vi.fn(() => chain);
  return { calls, from, repo: new SupabaseRideLegacyLinkRepository({ from, rpc: vi.fn() } as unknown as AnyClient) };
}

describe('SupabaseRideLegacyLinkRepository', () => {
  it('finds the listing by its legacy ride id', async () => {
    const { calls, from, repo } = clientWith({ data: { listing_id: 'l1' }, error: null });
    await expect(repo.listingIdForLegacyRide('r1')).resolves.toBe('l1');
    expect(from).toHaveBeenCalledWith('listings');
    expect(calls.eq).toEqual(['legacy_ride_id', 'r1']);
  });

  it('returns null when no listing is visible', async () => {
    await expect(clientWith({ data: null, error: null }).repo.listingIdForLegacyRide('r1')).resolves.toBeNull();
  });

  it('throws the server error', async () => {
    await expect(clientWith({ data: null, error: { message: 'boom' } }).repo.listingIdForLegacyRide('r1')).rejects.toThrow('boom');
  });
});
