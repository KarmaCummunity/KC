import { describe, expect, it, vi } from 'vitest';
import { ListGuestMapPinsUseCase } from '../ListGuestMapPinsUseCase';
import type { IGuestMapRepository } from '../../ports/IGuestMapRepository';

describe('ListGuestMapPinsUseCase', () => {
  it('forwards bounds filters and limit to the port', async () => {
    const listPins = vi.fn(async () => []);
    const uc = new ListGuestMapPinsUseCase({ listPins } as unknown as IGuestMapRepository);
    const bounds = { west: 1, south: 2, east: 3, north: 4 };
    await uc.execute({ bounds, filters: { world: 'food' }, limit: 40 });
    expect(listPins).toHaveBeenCalledWith(bounds, { world: 'food' }, 40);
  });
});
