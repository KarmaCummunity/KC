import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseGuestMapRepository } from '../SupabaseGuestMapRepository';

const id = '40000000-0000-4000-8000-000000000001';
const bounds = { west: 34.7, south: 32.0, east: 34.9, north: 32.2 };
const row = {
  post_id: id, lat: 32.05, lng: 34.8, world_slug: 'items', direction: 'give',
  owner_id: 'never-copy',
};

describe('guest map pins adapter', () => {
  it('calls guest_map_post_pins and projects the guest pin shape only', async () => {
    const { client, calls } = createFakeClient({
      rpc: { guest_map_post_pins: { data: [row], error: null } },
    });
    const repo = new SupabaseGuestMapRepository(client);
    expect(await repo.listPins(bounds, { world: 'items' }, 50)).toEqual([
      { postId: id, lat: 32.05, lng: 34.8, worldSlug: 'items', direction: 'give' },
    ]);
    expect(calls[0]).toMatchObject({
      kind: 'rpc',
      fn: 'guest_map_post_pins',
      args: { p_bounds: bounds, p_filters: { world: 'items' }, p_limit: 50 },
    });
  });

  it('surfaces backend failure rather than an empty map', async () => {
    const { client } = createFakeClient({
      rpc: {
        guest_map_post_pins: {
          data: null,
          error: { code: 'P0001', message: 'invalid_bounds' },
        },
      },
    });
    await expect(new SupabaseGuestMapRepository(client).listPins(bounds)).rejects.toThrow();
  });
});
