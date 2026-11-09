import type { FsmMachine } from './machine';
import { adminTaskMachine } from './machines/adminTask';
import { postMachine } from './machines/post';

/**
 * The only registry of kernel machines. Every machine listed here must have the same
 * rows in the Postgres catalog (`fsm_state` / `fsm_edge`); the infrastructure contract
 * test replays `supabase/migrations` and fails when the two differ.
 *
 * To register a machine: add its module under `machines/`, list it here, and ship the
 * matching catalog insert in a migration (design spec §4.1).
 */
export const FSM_MACHINES: readonly FsmMachine<string, string>[] = [adminTaskMachine, postMachine];
