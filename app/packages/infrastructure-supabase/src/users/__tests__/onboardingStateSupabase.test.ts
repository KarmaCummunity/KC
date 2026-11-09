import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OnboardingError } from '@kc/application';
import { supabaseResetOnboardingForDev, supabaseSetOnboardingState } from '../onboardingSupabase';

// FSM wave 3b (0698) — the onboarding stage is written only through two RPCs, which act on the
// signed-in member; the server's refusals reach the use cases as typed OnboardingErrors.

function clientWith(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

describe('supabaseSetOnboardingState', () => {
  it('calls rpc_set_onboarding_state with the target stage', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await supabaseSetOnboardingState(clientWith(rpc), 'pending_avatar');
    expect(rpc).toHaveBeenCalledWith('rpc_set_onboarding_state', { p_state: 'pending_avatar' });
  });

  it.each([
    ['onboarding_basic_info_missing', 'basic_info_missing'],
    ['onboarding_transition_invalid', 'illegal_transition'],
  ])('maps the server error "%s" to OnboardingError %s', async (message, code) => {
    const rpc = vi.fn().mockResolvedValue({ error: { message } });
    const call = supabaseSetOnboardingState(clientWith(rpc), 'completed');
    await expect(call).rejects.toBeInstanceOf(OnboardingError);
    await expect(call).rejects.toMatchObject({ code });
  });

  it('rethrows any other failure as a plain error', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'connection reset' } });
    await expect(supabaseSetOnboardingState(clientWith(rpc), 'completed')).rejects.toThrow(
      'setOnboardingState: connection reset',
    );
  });
});

describe('supabaseResetOnboardingForDev', () => {
  it('calls rpc_dev_reset_onboarding', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await supabaseResetOnboardingForDev(clientWith(rpc));
    expect(rpc).toHaveBeenCalledWith('rpc_dev_reset_onboarding');
  });

  it('surfaces a refusal outside a dev database', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'onboarding_reset_dev_only' } });
    await expect(supabaseResetOnboardingForDev(clientWith(rpc))).rejects.toThrow(
      'resetOnboardingForDev: onboarding_reset_dev_only',
    );
  });
});
