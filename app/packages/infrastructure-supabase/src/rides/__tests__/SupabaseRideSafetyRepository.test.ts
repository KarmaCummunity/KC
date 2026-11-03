import { describe, expect, it, vi } from 'vitest';
import { SupabaseRideSafetyRepository } from '../SupabaseRideSafetyRepository';

type AnyClient = ConstructorParameters<typeof SupabaseRideSafetyRepository>[0];

function repoWith(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, repo: new SupabaseRideSafetyRepository({ rpc, from: vi.fn() } as unknown as AnyClient) };
}

describe('SupabaseRideSafetyRepository', () => {
  it('raises an emergency with its note', async () => {
    const { rpc, repo } = repoWith({ data: {}, error: null });
    await repo.raiseEmergency('l1', 'flat tyre');
    expect(rpc).toHaveBeenCalledWith('ride_listing_emergency', { p_listing_id: 'l1', p_note: 'flat tyre' });
  });

  it('omits an empty note', async () => {
    const { rpc, repo } = repoWith({ data: {}, error: null });
    await repo.raiseEmergency('l1', null);
    expect(rpc).toHaveBeenCalledWith('ride_listing_emergency', { p_listing_id: 'l1', p_note: undefined });
  });

  it('keeps the server refusal code', async () => {
    const { repo } = repoWith({ data: null, error: { message: 'ride_not_active' } });
    await expect(repo.raiseEmergency('l1', null)).rejects.toThrow('ride_not_active');
  });
});
