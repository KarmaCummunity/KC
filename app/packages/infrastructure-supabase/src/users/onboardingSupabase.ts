import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnboardingBootstrap } from '@kc/application';
import type { OnboardingState } from '@kc/domain';
import { OnboardingError, ProfileError } from '@kc/application';
import { fetchBootstrapSession } from '../auth/bootstrapSession';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { mapRuleErrors } from '../auth/ruleErrors';
import { updateUserPrivate } from './ownPrivateUpdate';
import { updateOwnUser } from './ownUserUpdate';

/** FR-AUTH-007 AC2 — the cold-start routing inputs, both from the `bootstrap_session()` payload. */
export async function supabaseGetOnboardingBootstrap(
  client: SupabaseClient<Database>,
): Promise<OnboardingBootstrap> {
  const { account, privateProfile } = await fetchBootstrapSession(client);
  if (!account.onboardingState) throw new Error('getOnboardingBootstrap: no onboarding state');
  return { state: account.onboardingState as OnboardingState, basicInfoSkipped: privateProfile.basicInfoSkipped };
}

export function supabaseMarkBasicInfoSkipped(client: SupabaseClient<Database>, userId: string): Promise<void> {
  return updateUserPrivate(client, userId, { basic_info_skipped: true });
}

export function supabaseClearBasicInfoSkipped(client: SupabaseClient<Database>, userId: string): Promise<void> {
  return updateUserPrivate(client, userId, { basic_info_skipped: false });
}

/**
 * FR-AUTH-010 — step-1 name and city on `users` (the city name is the `cities` row of `city_id`,
 * nothing is stored next to it), then the skip flag cleared on `user_private`: two statements,
 * name and city first so a failure never records a completed step without them.
 */
export async function supabaseSetBasicInfo(
  client: SupabaseClient<Database>,
  userId: string,
  params: { displayName: string; city: string },
): Promise<void> {
  await updateOwnUser(client, userId, { display_name: params.displayName, city_id: params.city });
  await updateUserPrivate(client, userId, { basic_info_skipped: false });
}

/** FR-AUTH-010 AC2.d — `set_date_of_birth`; the server re-checks the 18+ rule. */
export async function supabaseSetDateOfBirth(client: SupabaseClient<Database>, isoDate: string): Promise<void> {
  await mapRuleErrors(
    async () => unwrapCall('rpc:set_date_of_birth', await client.rpc('set_date_of_birth', { p_date: isoDate })),
    (reason, cause) => {
      if (reason === 'underage' || reason === 'invalid_date_of_birth') return new ProfileError(reason, reason, cause);
      return null;
    },
  );
}

/**
 * FR-AUTH-010 / 012 / 015 — `set_onboarding_state` moves the signed-in member's onboarding along
 * machine `onboarding`; the server's refusals map to `OnboardingError`.
 */
export async function supabaseSetOnboardingState(client: SupabaseClient<Database>, state: OnboardingState): Promise<void> {
  await mapRuleErrors(
    async () => unwrapCall('rpc:set_onboarding_state', await client.rpc('set_onboarding_state', { p_state: state })),
    (reason, cause) => {
      if (reason === 'onboarding_basic_info_missing') return new OnboardingError('basic_info_missing', reason, cause);
      if (reason === 'onboarding_transition_invalid') return new OnboardingError('illegal_transition', reason, cause);
      return null;
    },
  );
}
