import { defineMachine } from '../machine';

/**
 * Ride booking: a seat on a ride (`post_handoffs.status`, world `rides`; spec
 * `docs/spec/05_giving_worlds.md` §5.3, D73 / D96).
 *
 * - The driver approves (`reserved → confirmed`) or declines; an unapproved booking lapses
 *   (`reserved → cancelled`, `ride_bookings_expire_sweep`).
 * - Completing the trip settles every live booking (`reserved | confirmed → handed_over`).
 * - The driver may reinstate a booking they declined or cancelled: `cancelled → reserved`
 *   (declined) and `cancelled → confirmed` (driver-cancelled), `reinstate_ride_booking`.
 *   Which cancelled booking qualifies is a predicate on `cancel_reason`, checked by the RPC.
 * - A ride has no no-show state; `handed_over` is terminal.
 *
 * SQL copy: `supabase/schemas/25_handoffs/010_post_handoffs.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const rideBookingMachine = defineMachine({
  id: 'ride_booking',
  states: ['reserved', 'confirmed', 'handed_over', 'cancelled'] as const,
  edges: [
    { from: 'reserved', to: 'confirmed', roles: ['owner'] },
    { from: 'reserved', to: 'handed_over', roles: ['owner'] },
    { from: 'reserved', to: 'cancelled', roles: ['owner', 'recipient', 'system'] },
    { from: 'confirmed', to: 'handed_over', roles: ['owner', 'recipient'] },
    { from: 'confirmed', to: 'cancelled', roles: ['owner', 'recipient', 'system'] },
    { from: 'cancelled', to: 'reserved', roles: ['owner'] },
    { from: 'cancelled', to: 'confirmed', roles: ['owner'] },
  ],
});
