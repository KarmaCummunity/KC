import { describe, expect, it, vi } from 'vitest';
import { SupabaseRideHouseNumberRepository } from '../SupabaseRideHouseNumberRepository';

type AnyClient = ConstructorParameters<typeof SupabaseRideHouseNumberRepository>[0];

function repoWith(result: { data?: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, repo: new SupabaseRideHouseNumberRepository({ rpc } as unknown as AnyClient) };
}

describe('SupabaseRideHouseNumberRepository', () => {
  it('saves trimmed numbers and sends a blank end as cleared', async () => {
    const { rpc, repo } = repoWith({ error: null });
    await repo.save('L1', { origin: ' 12 ', dest: '  ' });
    expect(rpc).toHaveBeenCalledWith('set_ride_house_numbers', { p_listing_id: 'L1', p_origin: '12', p_dest: undefined });
  });

  it('maps the rows the caller may see and skips unknown ends', async () => {
    const { rpc, repo } = repoWith({
      data: [{ place_end: 'dest', house_number: '7א' }, { place_end: 'mp1', house_number: '3' }],
      error: null,
    });
    await expect(repo.get('L1')).resolves.toEqual({ dest: '7א' });
    expect(rpc).toHaveBeenCalledWith('get_ride_house_numbers', { p_listing_id: 'L1' });
  });

  it('surfaces a server error', async () => {
    const { repo } = repoWith({ error: { message: 'owner_only' } });
    await expect(repo.save('L1', { origin: '1' })).rejects.toThrow('owner_only');
  });
});
