// FR-RIDE-011 / FR-RIDE-012 — Supabase adapter for the ride participants port.
//
// Each mutation routes through the matching RPC defined in 0139_ride_participants.sql
// so the seat-count / state-machine invariants run inside Postgres under
// SECURITY DEFINER. The adapter is responsible for translating PG error
// messages (which we authored as the canonical codes) back into typed
// `RideParticipantError`s.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RideParticipantError,
  type RideParticipant,
  type RideParticipantErrorCode,
} from '@kc/domain';
import type { IRideParticipantRepository } from '@kc/application';
import type { Database } from '../database.legacy.types';
import { mapRideParticipantRow } from './mapRideParticipantRow';

type ParticipantRow = Database['public']['Tables']['ride_participants']['Row'];

/** Error messages our RPCs raise. Anything else surfaces as a generic Error. */
const KNOWN_CODES: ReadonlySet<RideParticipantErrorCode> = new Set([
  'auth_required',
  'ride_not_found',
  'ride_not_joinable',
  'cannot_join_own_ride',
  'already_requested',
  'participant_not_found',
  'participant_not_pending',
  'not_ride_owner',
  'not_participant',
  'ride_not_open',
  'ride_full',
  'invalid_status',
  'cannot_cancel_rejected',
  'note_too_long',
]);

function rethrow(message: string | undefined): never {
  const code = (message ?? '').trim();
  if (KNOWN_CODES.has(code as RideParticipantErrorCode)) {
    throw new RideParticipantError(code as RideParticipantErrorCode);
  }
  throw new Error(message ?? 'unknown_error');
}

export class SupabaseRideParticipantRepository implements IRideParticipantRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async request(input: { rideId: string; note: string | null }): Promise<RideParticipant> {
    const { data, error } = await this.client.rpc('rpc_ride_participants_request', {
      p_ride_id: input.rideId,
      p_note: input.note ?? undefined,
    });
    if (error) rethrow(error.message);
    return mapRideParticipantRow(data as ParticipantRow);
  }

  async decide(input: {
    participantId: string;
    status: 'approved' | 'rejected';
  }): Promise<RideParticipant> {
    const { data, error } = await this.client.rpc('rpc_ride_participants_decide', {
      p_participant_id: input.participantId,
      p_status: input.status,
    });
    if (error) rethrow(error.message);
    return mapRideParticipantRow(data as ParticipantRow);
  }

  async cancel(input: { participantId: string }): Promise<RideParticipant> {
    const { data, error } = await this.client.rpc('rpc_ride_participants_cancel', {
      p_participant_id: input.participantId,
    });
    if (error) rethrow(error.message);
    return mapRideParticipantRow(data as ParticipantRow);
  }

  async listForRide(input: { rideId: string }): Promise<readonly RideParticipant[]> {
    const { data, error } = await this.client
      .from('ride_participants')
      .select('*')
      .eq('ride_id', input.rideId)
      .order('requested_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRideParticipantRow);
  }

  async listForUser(input: {
    userId: string;
    limit?: number;
  }): Promise<readonly RideParticipant[]> {
    const limit = input.limit ?? 30;
    const { data, error } = await this.client
      .from('ride_participants')
      .select('*')
      .eq('user_id', input.userId)
      .order('requested_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRideParticipantRow);
  }
}
