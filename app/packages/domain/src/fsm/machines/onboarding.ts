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
 * - The moves back to step 1 carry role `dev_reset`: only the Settings developer tool takes
 *   them, and only on a dev database (`rpc_dev_reset_onboarding`).
 *
 * SQL copy: `supabase/migrations/0698_fsm_onboarding.sql`.
 */
export const onboardingMachine = defineMachine({
  id: 'onboarding',
  states: ['pending_basic_info', 'pending_avatar', 'completed'] as const,
  edges: [
    { from: 'pending_basic_info', to: 'pending_avatar' },
    { from: 'pending_basic_info', to: 'completed' },
    { from: 'pending_avatar', to: 'completed' },
    { from: 'pending_avatar', to: 'pending_basic_info', roles: ['dev_reset'] as const },
    { from: 'completed', to: 'pending_basic_info', roles: ['dev_reset'] as const },
  ],
});
