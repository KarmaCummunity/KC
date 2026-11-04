import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnboardingBootstrap } from '@kc/application';
import type { OnboardingState } from '@kc/domain';
import { ProfileError } from '@kc/application';

export async function supabaseGetOnboardingBootstrap(
  client: SupabaseClient,
  userId: string,
): Promise<OnboardingBootstrap> {
  const { data, error } = await client
    .from('users')
    .select('onboarding_state, basic_info_skipped')
    .eq('user_id', userId)
    .single();
  if (error) throw new Error(`getOnboardingBootstrap: ${error.message}`);
  const row = data as {
    onboarding_state: OnboardingState;
    basic_info_skipped: boolean;
  } | null;
  const state = row?.onboarding_state;
  if (!state) throw new Error('getOnboardingBootstrap: no row');
  return { state, basicInfoSkipped: row.basic_info_skipped === true };
}

export async function supabaseMarkBasicInfoSkipped(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await client.from('users').update({ basic_info_skipped: true }).eq('user_id', userId);
  if (error) throw new Error(`markBasicInfoSkipped: ${error.message}`);
}

export async function supabaseClearBasicInfoSkipped(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await client.from('users').update({ basic_info_skipped: false }).eq('user_id', userId);
  if (error) throw new Error(`clearBasicInfoSkipped: ${error.message}`);
}

export async function supabaseSetBasicInfo(
  client: SupabaseClient,
  userId: string,
  params: { displayName: string; city: string; cityName: string },
): Promise<void> {
  const { error } = await client
    .from('users')
    .update({
      display_name: params.displayName,
      city: params.city,
      city_name: params.cityName,
      basic_info_skipped: false,
    })
    .eq('user_id', userId);
  if (error) throw new Error(`setBasicInfo: ${error.message}`);
}

/** FR-AUTH-010 AC2.d — `rpc_set_date_of_birth`; the server re-checks the 18+ rule. */
export async function supabaseSetDateOfBirth(client: SupabaseClient, isoDate: string): Promise<void> {
  const { error } = await client.rpc('rpc_set_date_of_birth', { p_date_of_birth: isoDate });
  if (!error) return;
  const message = error.message ?? '';
  if (message.includes('underage')) throw new ProfileError('underage', message, error);
  if (message.includes('invalid_date_of_birth')) throw new ProfileError('invalid_date_of_birth', message, error);
  throw new Error(`setDateOfBirth: ${message}`);
}
