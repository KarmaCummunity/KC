import { describe, expect, it, vi } from 'vitest';
import { SupabaseRideListingRepository } from '../SupabaseRideListingRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = ConstructorParameters<typeof SupabaseRideListingRepository>[0];

const RIDE_ROW = {
  ride_id: 'r_100',
  owner_id: 'u_owner',
  mode: 'offer',
  origin_city_id: '5000',
  dest_city_id: '4000',
  origin_street: 'Allenby',
  origin_street_number: '1',
  dest_street: 'Herzl',
  dest_street_number: null,
  departs_at: '2026-06-01T08:00:00Z',
  seats_available: 3,
  description: null,
  title: 'TLV to Haifa',
  status: 'open',
  visibility: 'Public',
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
  cargo_enabled: false,
  food_shipping_enabled: false,
  payment_model: 'free',
};

const RIDE_ROW_JOINED = {
  ...RIDE_ROW,
  origin_city: { name_he: 'Tel Aviv' },
  dest_city: { name_he: 'Haifa' },
};

describe('SupabaseRideListingRepository - advanced create & constraints', () => {
  it('maps advanced fields for cargo, food, and payment model', async () => {
    let insertedPayload: any;
    const single = vi.fn().mockResolvedValue({ data: RIDE_ROW_JOINED, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockImplementation((payload) => {
      insertedPayload = payload;
      return { select };
    });
    const from = vi.fn().mockReturnValue({ insert });
    const client = { from } as unknown as AnyClient;

    const repo = new SupabaseRideListingRepository(client);
    await repo.create({
      ownerId: 'u_owner',
      mode: 'offer',
      originCityId: '5000',
      destCityId: '4000',
      originStreet: 'A',
      originStreetNumber: null,
      destStreet: 'B',
      destStreetNumber: null,
      departsAt: '2026-06-01T08:00:00Z',
      seatsAvailable: 3,
      description: null,
      title: 'Title',
      visibility: 'Public',
      cargoEnabled: true,
      cargoMaxVolumeL: 50,
      cargoMaxWeightKg: 20,
      cargoAllowedTypes: ['small_packages', 'other'],
      foodShippingEnabled: false,
      paymentModel: 'expense_share',
      paymentAmountIls: 35,
      reqGender: 'women_only',
      reqSmokingAllowed: false,
      reqPetsAllowed: true,
      reqVerifiedOnly: true,
      linkedPostId: 'p_99',
    });

    expect(insertedPayload.cargo_enabled).toBe(true);
    expect(insertedPayload.cargo_max_volume_l).toBe(50);
    expect(insertedPayload.cargo_max_weight_kg).toBe(20);
    expect(insertedPayload.cargo_allowed_types).toEqual(['small_packages', 'other']);
    expect(insertedPayload.payment_model).toBe('expense_share');
    expect(insertedPayload.payment_amount_ils).toBe(35);
    expect(insertedPayload.req_gender).toBe('women_only');
    expect(insertedPayload.linked_post_id).toBe('p_99');
  });

  it.each([
    ['payment_cap_exceeded', 'payment_cap_exceeded'],
    ['ride_listings_cargo_consistency violation', 'cargo_invalid_bounds'],
    ['ride_listings_food_consistency violation', 'food_invalid_bounds'],
    ['ride_listings_cargo_xor_food violation', 'cargo_food_mutually_exclusive'],
    ['ride_listings_payment_consistency violation', 'payment_amount_required'],
    ['declaration_required violation', 'declaration_required'],
  ])('maps constraint error "%s" to typed RideError("%s")', async (errMsg, expectedCode) => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: errMsg } });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    const client = { from } as unknown as AnyClient;

    const repo = new SupabaseRideListingRepository(client);
    await expect(
      repo.create({
        ownerId: 'u_owner',
        mode: 'offer',
        originCityId: '5000',
        destCityId: '4000',
        originStreet: 'A',
        originStreetNumber: null,
        destStreet: 'B',
        destStreetNumber: null,
        departsAt: '2026-06-01T08:00:00Z',
        seatsAvailable: 3,
        description: null,
        title: 'Title',
        visibility: 'Public',
      }),
    ).rejects.toMatchObject({
      name: 'RideError',
      code: expectedCode,
    });
  });
});

describe('SupabaseRideListingRepository - lifecycle (updateVisibility, start, arrive)', () => {
  function makeLifecycleClient(rpcResult: { data: any; error: any }, getByIdResult = RIDE_ROW_JOINED) {
    const rpc = vi.fn().mockResolvedValue(rpcResult);
    const maybeSingle = vi.fn().mockResolvedValue({ data: getByIdResult, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    return { client: { rpc, from } as unknown as AnyClient, rpc };
  }

  describe('updateVisibility', () => {
    it('calls rpc_ride_update_visibility and returns refetched joined row', async () => {
      const { client, rpc } = makeLifecycleClient({ data: { ride_id: 'r_100' }, error: null });
      const repo = new SupabaseRideListingRepository(client);

      const row = await repo.updateVisibility({ rideId: 'r_100', visibility: 'FollowersOnly' });

      expect(rpc).toHaveBeenCalledWith('rpc_ride_update_visibility', {
        p_ride_id: 'r_100',
        p_visibility: 'FollowersOnly',
      });
      expect(row.rideId).toBe('r_100');
    });

    it.each(['auth_required', 'invalid_visibility', 'ride_not_found', 'not_ride_owner', 'ride_not_open'])(
      'maps error code "%s" to RideError',
      async (code) => {
        const { client } = makeLifecycleClient({ data: null, error: { message: code } });
        const repo = new SupabaseRideListingRepository(client);

        await expect(
          repo.updateVisibility({ rideId: 'r_100', visibility: 'Public' }),
        ).rejects.toMatchObject({ name: 'RideError', code });
      },
    );

    it('throws generic error when RPC returns unexpected error', async () => {
      const { client } = makeLifecycleClient({ data: null, error: { message: 'db crashed' } });
      const repo = new SupabaseRideListingRepository(client);

      await expect(
        repo.updateVisibility({ rideId: 'r_100', visibility: 'Public' }),
      ).rejects.toThrow('db crashed');
    });

    it('throws when RPC returns empty response', async () => {
      const { client } = makeLifecycleClient({ data: null, error: null });
      const repo = new SupabaseRideListingRepository(client);

      await expect(
        repo.updateVisibility({ rideId: 'r_100', visibility: 'Public' }),
      ).rejects.toThrow('updateVisibility: empty response');
    });
  });

  describe('start', () => {
    it('calls rpc_ride_start and refetches joined row', async () => {
      const { client, rpc } = makeLifecycleClient({ data: null, error: null });
      const repo = new SupabaseRideListingRepository(client);

      const row = await repo.start('r_100');
      expect(rpc).toHaveBeenCalledWith('rpc_ride_start', { p_ride_id: 'r_100' });
      expect(row.rideId).toBe('r_100');
    });

    it.each(['auth_required', 'ride_not_found', 'not_ride_owner', 'invalid_status_transition', 'start_window_not_open'])(
      'maps error code "%s" to RideError',
      async (code) => {
        const { client } = makeLifecycleClient({ data: null, error: { message: code } });
        const repo = new SupabaseRideListingRepository(client);

        await expect(repo.start('r_100')).rejects.toMatchObject({ name: 'RideError', code });
      },
    );
  });

  describe('arrive', () => {
    it('calls rpc_ride_arrive and refetches joined row', async () => {
      const { client, rpc } = makeLifecycleClient({ data: null, error: null });
      const repo = new SupabaseRideListingRepository(client);

      const row = await repo.arrive('r_100', 'arrived');
      expect(rpc).toHaveBeenCalledWith('rpc_ride_arrive', {
        p_ride_id: 'r_100',
        p_reason: 'arrived',
      });
      expect(row.rideId).toBe('r_100');
    });

    it.each(['auth_required', 'ride_not_found', 'not_ride_owner', 'ride_not_in_transit', 'invalid_status_transition'])(
      'maps error code "%s" to RideError',
      async (code) => {
        const { client } = makeLifecycleClient({ data: null, error: { message: code } });
        const repo = new SupabaseRideListingRepository(client);

        await expect(repo.arrive('r_100', 'breakdown')).rejects.toMatchObject({
          name: 'RideError',
          code,
        });
      },
    );
  });
});

describe('SupabaseRideListingRepository - listMyRides', () => {
  it('applies default statuses and 30-day since window when omitted', async () => {
    const builder: any = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      then: (resolve: any, reject: any) =>
        Promise.resolve({ data: [RIDE_ROW_JOINED], error: null }).then(resolve, reject),
    };
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(builder) });
    const client = { from } as unknown as AnyClient;

    const repo = new SupabaseRideListingRepository(client);
    const rows = await repo.listMyRides({ ownerId: 'u_owner' });

    expect(builder.eq).toHaveBeenCalledWith('owner_id', 'u_owner');
    expect(builder.in).toHaveBeenCalledWith('status', ['open', 'closed', 'cancelled', 'expired']);
    expect(builder.limit).toHaveBeenCalledWith(50);
    expect(builder.gte).toHaveBeenCalledWith('departs_at', expect.any(String));
    expect(rows).toHaveLength(1);
  });

  it('does not filter by since when since is explicitly null', async () => {
    const builder: any = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      then: (resolve: any, reject: any) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(builder) });
    const client = { from } as unknown as AnyClient;

    const repo = new SupabaseRideListingRepository(client);
    await repo.listMyRides({ ownerId: 'u_owner', since: null });

    expect(builder.gte).not.toHaveBeenCalled();
  });

  it('throws when listMyRides query returns an error', async () => {
    const builder: any = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      then: (resolve: any, reject: any) =>
        Promise.resolve({ data: null, error: { message: 'db error' } }).then(resolve, reject),
    };
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(builder) });
    const client = { from } as unknown as AnyClient;

    const repo = new SupabaseRideListingRepository(client);
    await expect(repo.listMyRides({ ownerId: 'u_owner' })).rejects.toThrow('db error');
  });
});
