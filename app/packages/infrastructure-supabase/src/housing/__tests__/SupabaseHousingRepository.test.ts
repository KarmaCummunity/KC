// FR-HOUSING-003, 012, 015–022 — the housing adapter calls the 0600–0603 RPCs and maps their rows.
import { describe, expect, it, vi } from 'vitest';
import { SupabaseHousingRepository } from '../SupabaseHousingRepository';

type AnyClient = ConstructorParameters<typeof SupabaseHousingRepository>[0];
type Result = { data: unknown; error: { message: string } | null };

const HOST_ROW = {
  handoff_id: 'h1', recipient_id: 'g1', guest_name: 'Guest', avatar_url: null, guest_verified: true,
  guest_completed_stays: 3, guest_member_since: '2029-01-01T00:00:00Z',
  check_in_date: '2030-03-12', check_out_date: '2030-03-14',
  slot_starts_at: '2030-03-12T14:00:00Z', slot_ends_at: '2030-03-14T08:00:00Z',
  adults: 2, minors: 1, message: 'hi', status: 'reserved', reserved_at: '2030-03-10T10:00:00Z',
  confirm_by: '2030-03-11T10:00:00Z', rated_by_me: false,
};

function repoWith(result: Result, countResult?: { count: number | null; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockResolvedValue(countResult ?? { count: 0, error: null });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { rpc, from } as unknown as AnyClient;
  return { rpc, from, eq, repo: new SupabaseHousingRepository(client) };
}

describe('SupabaseHousingRepository', () => {
  it('requests a stay with the RPC argument names and returns the booking id', async () => {
    const { rpc, repo } = repoWith({ data: { handoff_id: 'h9' }, error: null });
    await expect(repo.requestStay({
      listingId: 'l1', checkInDate: '2030-03-12', checkOutDate: '2030-03-14', adults: 2, minors: 0,
      message: 'hi', minorsGuardianAck: false,
    })).resolves.toBe('h9');
    expect(rpc).toHaveBeenCalledWith('request_housing_booking', {
      p_listing_id: 'l1', p_check_in: '2030-03-12', p_check_out: '2030-03-14', p_adults: 2, p_minors: 0,
      p_message: 'hi', p_minors_guardian_ack: false,
    });
  });

  it('keeps the server error code as the message', async () => {
    const { repo } = repoWith({ data: null, error: { message: 'housing_pending_cap' } });
    await expect(repo.cancel('h1', null)).rejects.toThrow('housing_pending_cap');
  });

  it('sends an absent note as undefined, never null', async () => {
    const { rpc, repo } = repoWith({ data: {}, error: null });
    await repo.decide('h1', true, null);
    expect(rpc).toHaveBeenCalledWith('decide_housing_booking', { p_handoff_id: 'h1', p_approve: true, p_note: undefined });
  });

  it('maps the host list to camelCase and drops unknown statuses', async () => {
    const { repo } = repoWith({ data: [HOST_ROW, { ...HOST_ROW, handoff_id: 'h2', status: 'weird' }], error: null });
    const list = await repo.listForOffer('l1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      handoffId: 'h1', guestId: 'g1', guestCompletedStays: 3, startsAt: '2030-03-12T14:00:00Z',
      endsAt: '2030-03-14T08:00:00Z', adults: 2, minors: 1, status: 'reserved',
    });
  });

  it('returns null for the private details when the place is not open to the caller', async () => {
    const { repo } = repoWith({ data: null, error: { message: 'housing_private_details_hidden' } });
    await expect(repo.getPrivateDetails('l1')).resolves.toBeNull();
  });

  it('maps the private details when they are open', async () => {
    const { repo } = repoWith({ data: [{
      listing_id: 'l1', city_id: '4000', street_name: 'Herzl', house_number: '12', apartment: null, floor: '2',
      entrance_notes: null, access_instructions: 'Key box', lat: 32.79, lng: 34.99,
    }], error: null });
    await expect(repo.getPrivateDetails('l1')).resolves.toMatchObject({
      streetName: 'Herzl', houseNumber: '12', floor: '2', accessInstructions: 'Key box', lat: 32.79,
    });
  });

  it('reads the conduct acceptance of the current version through RLS', async () => {
    const { rpc, from, eq, repo } = repoWith({ data: 3, error: null }, { count: 1, error: null });
    await expect(repo.hasAcceptedConduct()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('housing_conduct_version');
    expect(from).toHaveBeenCalledWith('housing_conduct_acceptances');
    expect(eq).toHaveBeenCalledWith('version', 3);
  });
});
