import { describe, it, expect } from 'vitest';
import { OnboardingError, ProfileError } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeResult } from '../../__tests__/fakeBaselineClient';
import {
  supabaseClearBasicInfoSkipped,
  supabaseGetOnboardingBootstrap,
  supabaseMarkBasicInfoSkipped,
  supabaseSetBasicInfo,
  supabaseSetDateOfBirth,
  supabaseSetOnboardingState,
} from '../onboardingSupabase';

const ok = (data: unknown = null): FakeResult => ({ data, error: null });
const refusal = (message: string): FakeResult => ({ data: null, error: { code: 'P0001', message } });

const session = (onboarding_state: string, basic_info_skipped: unknown) => ({
  user_id: 'u1',
  account: { status: 'active', onboarding_state },
  private_profile: { basic_info_skipped },
});

describe('supabaseGetOnboardingBootstrap', () => {
  it('reads the state and the skip flag from bootstrap_session', async () => {
    const { client, calls } = createFakeClient({ rpc: { bootstrap_session: ok(session('pending_avatar', true)) } });

    expect(await supabaseGetOnboardingBootstrap(client)).toEqual({ state: 'pending_avatar', basicInfoSkipped: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe('bootstrap_session');
  });

  it('reports a skip flag that is not strictly true as false', async () => {
    const { client } = createFakeClient({ rpc: { bootstrap_session: ok(session('completed', 'yes')) } });

    expect((await supabaseGetOnboardingBootstrap(client)).basicInfoSkipped).toBe(false);
  });

  it('throws when the payload carries no onboarding state', async () => {
    const { client } = createFakeClient({ rpc: { bootstrap_session: ok({ user_id: 'u1' }) } });

    await expect(supabaseGetOnboardingBootstrap(client)).rejects.toThrow('no onboarding state');
  });

  it('reports a missing bootstrap_session as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { bootstrap_session: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });

    await expect(supabaseGetOnboardingBootstrap(client)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('basic-info skip flag', () => {
  it('marks the skip on the caller\'s user_private row', async () => {
    const { client, calls } = createFakeClient();

    await supabaseMarkBasicInfoSkipped(client, 'u1');

    expect(calls[0]).toMatchObject({ kind: 'update', table: 'user_private', payload: { basic_info_skipped: true } });
    expect(calls[0]?.filters).toContainEqual(['eq', 'user_id', 'u1']);
  });

  it('clears it', async () => {
    const { client, calls } = createFakeClient();

    await supabaseClearBasicInfoSkipped(client, 'u1');

    expect(calls[0]).toMatchObject({ table: 'user_private', payload: { basic_info_skipped: false } });
  });

  it('surfaces an update failure', async () => {
    const { client } = createFakeClient({ tables: { user_private: { data: null, error: { message: 'rls' } } } });

    await expect(supabaseMarkBasicInfoSkipped(client, 'u1')).rejects.toThrow('rls');
  });
});

describe('supabaseSetBasicInfo', () => {
  it('writes name and city id on users, then clears the skip flag on user_private', async () => {
    const { client, calls } = createFakeClient();

    await supabaseSetBasicInfo(client, 'u1', { displayName: 'Dana', city: '5000' });

    expect(calls.map((c) => [c.table, c.kind, c.payload])).toEqual([
      ['users', 'update', { display_name: 'Dana', city_id: '5000' }],
      ['user_private', 'update', { basic_info_skipped: false }],
    ]);
    expect(calls[0]?.filters).toContainEqual(['eq', 'id', 'u1']);
  });

  it('does not touch user_private when the profile update fails (an unknown city)', async () => {
    const { client, calls } = createFakeClient({
      tables: { users: { data: null, error: { code: '23503', message: 'violates foreign key users_city_id_fkey' } } },
    });

    await expect(supabaseSetBasicInfo(client, 'u1', { displayName: 'Dana', city: 'nowhere' })).rejects.toThrow('foreign key');
    expect(callsTo(calls, 'user_private')).toHaveLength(0);
  });
});

describe('supabaseSetDateOfBirth', () => {
  it('calls set_date_of_birth with p_date', async () => {
    const { client, calls } = createFakeClient();

    await supabaseSetDateOfBirth(client, '1990-05-15');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'set_date_of_birth', args: { p_date: '1990-05-15' } });
  });

  it.each(['underage', 'invalid_date_of_birth'])('maps the refusal %s to ProfileError', async (reason) => {
    const { client } = createFakeClient({ rpc: { set_date_of_birth: refusal(reason) } });

    await expect(supabaseSetDateOfBirth(client, '2015-01-01')).rejects.toBeInstanceOf(ProfileError);
    await expect(supabaseSetDateOfBirth(client, '2015-01-01')).rejects.toMatchObject({ code: reason });
  });

  it('leaves other refusals as the rule error (user_not_found)', async () => {
    const { client } = createFakeClient({ rpc: { set_date_of_birth: refusal('user_not_found') } });

    await expect(supabaseSetDateOfBirth(client, '1990-05-15')).rejects.toMatchObject({ reason: 'user_not_found' });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { set_date_of_birth: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });

    await expect(supabaseSetDateOfBirth(client, '1990-05-15')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('supabaseSetOnboardingState', () => {
  it('calls set_onboarding_state with p_state', async () => {
    const { client, calls } = createFakeClient();

    await supabaseSetOnboardingState(client, 'pending_avatar');

    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'set_onboarding_state', args: { p_state: 'pending_avatar' } });
  });

  it.each([
    ['onboarding_basic_info_missing', 'basic_info_missing'],
    ['onboarding_transition_invalid', 'illegal_transition'],
  ])('maps the refusal %s to OnboardingError(%s)', async (reason, code) => {
    const { client } = createFakeClient({ rpc: { set_onboarding_state: refusal(reason) } });

    await expect(supabaseSetOnboardingState(client, 'completed')).rejects.toBeInstanceOf(OnboardingError);
    await expect(supabaseSetOnboardingState(client, 'completed')).rejects.toMatchObject({ code });
  });

  it('rethrows any other failure unchanged', async () => {
    const { client } = createFakeClient({ rpc: { set_onboarding_state: { data: null, error: { message: 'boom' } } } });

    await expect(supabaseSetOnboardingState(client, 'completed')).rejects.toThrow('boom');
  });
});
