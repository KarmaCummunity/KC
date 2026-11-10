import type { FsmMachine } from '../machine';
import { eventRegistrationMachine } from './eventRegistration';
import { givingHandoffMachine } from './givingHandoff';
import { housingBookingMachine } from './housingBooking';
import { rideBookingMachine } from './rideBooking';

/**
 * `post_handoffs` holds every world's handoffs in one status column; the machine that rules a
 * row is chosen by its `world_slug`. Worlds with a booking flow of their own have a machine;
 * every other world (items, food, animals, knowledge, and any world added later) uses the
 * giving handoff.
 *
 * SQL copy: `kc_private.handoff_machine_of` in `supabase/migrations/0694_fsm_handoffs.sql`.
 */
export function handoffMachineFor(worldSlug: string): FsmMachine<string, string> {
  switch (worldSlug) {
    case 'rides':
      return rideBookingMachine;
    case 'housing':
      return housingBookingMachine;
    case 'time':
      return eventRegistrationMachine;
    default:
      return givingHandoffMachine;
  }
}
