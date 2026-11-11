import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BackendRuleError,
  type HousingGuestStay,
  type HousingHostBooking,
  type HousingPrivateDetails,
  type HousingStayRequestInput,
} from '@kc/domain';
import type { HousingPrivateDetailsInput, IHousingRepository } from '@kc/application';
import type { Database, Json } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { requireRpcRow } from '../marketplace/rpcRow';
import { foldAccessNotes, mapPrivateDetails, pointEwkt } from './housingMappers';
import { listGuestStays, listHostBookings } from './housingReads';

type Client = SupabaseClient<Database>;

const CONDUCT = 'housing_conduct';
/** The refusal of `get_post_private_location` for a caller the place is not open to. */
const PLACE_NOT_OPEN = 'post_not_found';

/** Optional RPC text argument: the generated types take `undefined`, never `null`. */
const opt = (value: string | null | undefined): string | undefined => value ?? undefined;

interface ConductState {
  readonly version: number;
  readonly accepted: boolean;
}

/** The code-of-conduct entry of the `consents` block of the `bootstrap_session()` document. */
export function parseConductState(payload: Json): ConductState | null {
  const consents = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload['consents'] : null;
  const entry = typeof consents === 'object' && consents !== null && !Array.isArray(consents) ? consents[CONDUCT] : null;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const version = entry['version'];
  return typeof version === 'number' ? { version, accepted: entry['accepted'] === true } : null;
}

/**
 * Housing stays on the baseline (docs/spec/requirements/21_housing.md FR-HOUSING-003, 012, 015–022;
 * supabase/schemas/70_worlds/100–110). A refusal is a `BackendRuleError` whose message is the
 * server's stable reason (e.g. `housing_pending_cap`), which the screens map to copy; a missing
 * backend object is a `BackendUnavailableError`. The server queues the push to the other side on
 * every booking change.
 */
export class SupabaseHousingRepository implements IHousingRepository {
  constructor(private readonly client: Client) {}

  private async conduct(): Promise<ConductState> {
    const state = parseConductState(unwrapCall('rpc:bootstrap_session', await this.client.rpc('bootstrap_session')));
    if (!state) throw new Error('bootstrap_session carries no housing conduct consent');
    return state;
  }

  async currentConductVersion(): Promise<number> {
    return (await this.conduct()).version;
  }

  async hasAcceptedConduct(): Promise<boolean> {
    return (await this.conduct()).accepted;
  }

  async acceptConduct(version: number): Promise<void> {
    unwrapCall(
      'rpc:accept_world_consent',
      await this.client.rpc('accept_world_consent', { p_kind: CONDUCT, p_version: version }),
    );
  }

  async requestStay(input: HousingStayRequestInput): Promise<string> {
    const row = unwrapCall(
      'rpc:request_housing_booking',
      await this.client.rpc('request_housing_booking', {
        p_post_id: input.listingId,
        p_check_in: input.checkInDate,
        p_check_out: input.checkOutDate,
        p_adults: input.adults,
        p_minors: input.minors,
        p_message: input.message,
        p_minors_guardian_ack: input.minorsGuardianAck,
      }),
    );
    return requireRpcRow(row, 'request_housing_booking').id;
  }

  async decide(handoffId: string, approve: boolean, note: string | null): Promise<void> {
    unwrapCall(
      'rpc:decide_housing_booking',
      await this.client.rpc('decide_housing_booking', { p_handoff_id: handoffId, p_approve: approve, p_note: opt(note) }),
    );
  }

  async cancel(handoffId: string, note: string | null): Promise<void> {
    unwrapCall(
      'rpc:cancel_housing_booking',
      await this.client.rpc('cancel_housing_booking', { p_handoff_id: handoffId, p_note: opt(note) }),
    );
  }

  complete(handoffId: string): Promise<void> {
    return this.close(handoffId, 'completed');
  }

  markNoShow(handoffId: string): Promise<void> {
    return this.close(handoffId, 'no_show');
  }

  private async close(handoffId: string, outcome: 'completed' | 'no_show'): Promise<void> {
    unwrapCall(
      'rpc:close_housing_booking',
      await this.client.rpc('close_housing_booking', { p_handoff_id: handoffId, p_outcome: outcome }),
    );
  }

  listForOffer(listingId: string): Promise<HousingHostBooking[]> {
    return listHostBookings(this.client, listingId);
  }

  listMyStays(limit?: number): Promise<HousingGuestStay[]> {
    return listGuestStays(this.client, limit);
  }

  /** Null when the place is not open to the caller, or the host has not written it yet. */
  async getPrivateDetails(listingId: string): Promise<HousingPrivateDetails | null> {
    let row: Database['public']['Tables']['post_private_locations']['Row'] | null;
    try {
      row = unwrapCall(
        'rpc:get_post_private_location',
        await this.client.rpc('get_post_private_location', { p_post_id: listingId }),
      );
    } catch (error) {
      if (error instanceof BackendRuleError && error.reason === PLACE_NOT_OPEN) return null;
      throw error;
    }
    if (!row?.post_id || !row.street) return null;
    return mapPrivateDetails(row, await this.cityOf(listingId));
  }

  /** The host writes the exact place; the street name comes from the official street list (D71). */
  async setPrivateDetails(input: HousingPrivateDetailsInput): Promise<void> {
    const cityId = await this.cityOf(input.listingId);
    const street = unwrapCall(
      'table:streets',
      await this.client.from('streets').select('name_he').eq('city_id', cityId).eq('street_id', input.streetId).maybeSingle(),
    );
    unwrapCall(
      'table:post_private_locations',
      await this.client.from('post_private_locations').upsert(
        {
          post_id: input.listingId,
          street: street?.name_he ?? null,
          street_number: input.houseNumber.trim() || null,
          access_notes: foldAccessNotes([input.apartment, input.floor, input.entranceNotes, input.accessInstructions]),
          exact_point: pointEwkt(input.lat, input.lng),
        },
        { onConflict: 'post_id' },
      ),
    );
  }

  private async cityOf(postId: string): Promise<string> {
    const post = unwrapCall(
      'table:posts',
      await this.client.from('posts').select('city_id').eq('id', postId).maybeSingle(),
    );
    return post?.city_id ?? '';
  }
}
