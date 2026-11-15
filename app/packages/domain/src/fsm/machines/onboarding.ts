import { defineMachine } from '../machine';

/**
 * Onboarding stage (`users.onboarding_state`; spec `docs/spec/requirements/01_auth_and_onboarding.md`
 * FR-AUTH-010 step 1, FR-AUTH-011 / 012 photo and finish, FR-AUTH-015 deferred basic info).
 *
 * - A member moves forward only: basic info → photo → completed. The photo may be skipped,
 *   so `pending_avatar → completed` needs nothing more.
 * - `pending_basic_info → completed` is the deferred path: a member who skipped step 1 and
 *   later filled a complete profile is reconciled straight to the end (FR-AUTH-015).
 * - Leaving step 1 needs its fields on file (display name, city, date of birth). That rule
 *   reads the row, so `rpc_set_onboarding_state` checks it before the kernel call.
 * - There is no way back to step 1: the baseline has no developer reset.
 *
 * SQL copy: `supabase/schemas/10_identity/030_user_account.sql` (`kc_private.fsm_state` / `fsm_edge` seeds).
 */
export const onboardingMachine = defineMachine({
  id: 'onboarding',
  states: ['pending_basic_info', 'pending_avatar', 'completed'] as const,
  edges: [
    { from: 'pending_basic_info', to: 'pending_avatar' },
    { from: 'pending_basic_info', to: 'completed' },
    { from: 'pending_avatar', to: 'completed' },
  ],
});
