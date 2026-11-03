// G49 / D75 — a new ride starts from "publish again" (once), else the remembered last route.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  },
}));

import { queueRideRepublish, rememberRideRoute, takeRideStartDetails } from '../rideStartDetails';

const RIDE = { origin_place_kind: 'city', origin_place_id: '5000', seats_available: 2, departs_at: '2026-11-01T08:00:00Z' };

beforeEach(() => store.clear());

describe('rideStartDetails', () => {
  it('starts empty when nothing was published or queued', async () => {
    await expect(takeRideStartDetails()).resolves.toBeNull();
  });

  it('remembers the last route without its times', async () => {
    await rememberRideRoute(RIDE);
    await expect(takeRideStartDetails()).resolves.toEqual({ origin_place_kind: 'city', origin_place_id: '5000', seats_available: 2 });
  });

  it('prefers a queued "publish again" ride, and uses it only once', async () => {
    await rememberRideRoute({ origin_place_kind: 'city', origin_place_id: '3000' });
    queueRideRepublish(RIDE);
    await expect(takeRideStartDetails()).resolves.toMatchObject({ origin_place_id: '5000' });
    await expect(takeRideStartDetails()).resolves.toMatchObject({ origin_place_id: '3000' });
  });

  it('treats a corrupt memory as an empty form', async () => {
    store.set('kc.rides.lastRoute.v1', '{not json');
    await expect(takeRideStartDetails()).resolves.toBeNull();
  });
});
