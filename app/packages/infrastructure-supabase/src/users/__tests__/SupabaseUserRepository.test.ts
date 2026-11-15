import { describe, it, expect } from 'vitest';
import { DeleteAccountError, FollowError } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient, type FakeResult } from '../../__tests__/fakeBaselineClient';
import { SupabaseUserRepository } from '../SupabaseUserRepository';

const ok = (data: unknown = null): FakeResult => ({ data, error: null });
const refusal = (message: string, code = 'P0001'): FakeResult => ({ data: null, error: { code, message } });

describe('SupabaseUserRepository — public profile setters', () => {
  it('setAvatar updates users.avatar_url of the caller', async () => {
    const { client, calls } = createFakeClient();

    await new SupabaseUserRepository(client).setAvatar('u1', 'https://cdn/a.jpg');

    expect(calls[0]).toMatchObject({ kind: 'update', table: 'users', payload: { avatar_url: 'https://cdn/a.jpg' } });
    expect(calls[0]?.filters).toContainEqual(['eq', 'id', 'u1']);
  });

  it('setBiography updates users.biography, null clears it', async () => {
    const { client, calls } = createFakeClient();

    await new SupabaseUserRepository(client).setBiography('u1', null);

    expect(calls[0]).toMatchObject({ table: 'users', payload: { biography: null } });
  });

  it('a refused update surfaces as an error', async () => {
    const { client } = createFakeClient({
      tables: { users: { data: null, error: { code: '23514', message: 'violates check users_biography_check' } } },
    });

    await expect(new SupabaseUserRepository(client).setBiography('u1', 'x')).rejects.toThrow('users_biography_check');
  });
});

describe('SupabaseUserRepository — private flags on user_private', () => {
  it('dismissClosureExplainer sets closure_explainer_dismissed', async () => {
    const { client, calls } = createFakeClient();

    await new SupabaseUserRepository(client).dismissClosureExplainer('u1');

    expect(calls[0]).toMatchObject({ table: 'user_private', payload: { closure_explainer_dismissed: true } });
    expect(calls[0]?.filters).toContainEqual(['eq', 'user_id', 'u1']);
  });

  it('dismissFirstPostNudge sets first_post_nudge_dismissed', async () => {
    const { client, calls } = createFakeClient();

    await new SupabaseUserRepository(client).dismissFirstPostNudge('u1');

    expect(calls[0]).toMatchObject({ table: 'user_private', payload: { first_post_nudge_dismissed: true } });
  });

  it('a refused update surfaces as an error', async () => {
    const { client } = createFakeClient({ tables: { user_private: { data: null, error: { message: 'rls' } } } });

    await expect(new SupabaseUserRepository(client).dismissFirstPostNudge('u1')).rejects.toThrow('rls');
  });
});

describe('SupabaseUserRepository.setPrivacyMode', () => {
  const USER_ROW = {
    id: 'u1',
    share_handle: 'dana',
    display_name: 'Dana',
    biography: null,
    avatar_url: null,
    city_id: null,
    privacy_mode: 'Private',
    privacy_changed_at: '2026-06-01T00:00:00Z',
    verification_level: 0,
    preferred_language: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  };
  const SESSION = { user_id: 'u1', account: { status: 'active', onboarding_state: 'completed' }, private_profile: {} };

  it('calls set_privacy_mode with p_mode and returns the re-read profile', async () => {
    const { client, calls } = createFakeClient({
      rpc: { set_privacy_mode: ok(), bootstrap_session: ok(SESSION) },
      tables: { users: ok(USER_ROW), user_stats: ok([]), cities: ok([]) },
      userId: 'u1',
    });

    const user = await new SupabaseUserRepository(client).setPrivacyMode('u1', 'Private');

    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'set_privacy_mode', args: { p_mode: 'Private' } });
    expect(user).toMatchObject({ userId: 'u1', privacyMode: 'Private', privacyChangedAt: '2026-06-01T00:00:00Z' });
    expect(callsTo(calls, 'users')[0]?.kind).toBe('select');
  });

  it.each([
    ['account_not_active', 'account_not_active'],
    ['invalid_privacy_mode', 'unknown'],
  ])('maps the refusal %s to FollowError(%s)', async (reason, code) => {
    const { client } = createFakeClient({ rpc: { set_privacy_mode: refusal(reason) } });

    const error = await new SupabaseUserRepository(client).setPrivacyMode('u1', 'Private').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FollowError);
    expect(error).toMatchObject({ code });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { set_privacy_mode: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });

    await expect(new SupabaseUserRepository(client).setPrivacyMode('u1', 'Public')).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});

describe('SupabaseUserRepository.updateNotificationPreferences', () => {
  const stored = (prefs: unknown) => ({ user_private: (call: { kind: string }): FakeResult =>
    call.kind === 'select' ? ok({ notification_preferences: prefs }) : ok() });

  it('reads the stored document, merges the patch and writes the result back', async () => {
    const { client, calls } = createFakeClient({
      tables: stored({ critical: true, kinds: { chat_message: false } }),
    });

    const result = await new SupabaseUserRepository(client).updateNotificationPreferences('u1', {
      social: false,
      kinds: { follow_request: false },
    });

    expect(calls.map((c) => c.kind)).toEqual(['select', 'update']);
    expect(calls[1]?.payload).toEqual({
      notification_preferences: { critical: true, social: false, kinds: { chat_message: false, follow_request: false } },
    });
    expect(calls[1]?.filters).toContainEqual(['eq', 'user_id', 'u1']);
    expect(result).toEqual({
      critical: true,
      social: false,
      kinds: { chat_message: false, follow_request: false },
    });
  });

  it('starts from an empty document and returns the defaults for what the patch leaves out', async () => {
    const { client } = createFakeClient({ tables: stored({}) });

    expect(await new SupabaseUserRepository(client).updateNotificationPreferences('u1', {})).toEqual({
      critical: true,
      social: true,
    });
  });

  it('throws when the member has no user_private row', async () => {
    const { client } = createFakeClient({ tables: { user_private: ok(null) } });

    await expect(new SupabaseUserRepository(client).updateNotificationPreferences('u1', {})).rejects.toThrow(
      'no user_private row',
    );
  });
});

describe('SupabaseUserRepository.requestAccountDeletion (FR-SETTINGS-012)', () => {
  it('calls request_account_deletion without arguments', async () => {
    const { client, calls } = createFakeClient({ rpc: { request_account_deletion: ok('2026-07-01T00:00:00Z') } });

    await new SupabaseUserRepository(client).requestAccountDeletion();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'request_account_deletion' });
    expect(calls[0]?.args).toBeUndefined();
  });

  it.each([
    ['suspended', 'P0001', 'suspended'],
    ['unauthenticated', '42501', 'unauthenticated'],
    ['user_not_found', 'P0001', 'server_error'],
  ])('maps the refusal %s to DeleteAccountError(%s)', async (reason, sqlState, code) => {
    const { client } = createFakeClient({ rpc: { request_account_deletion: refusal(reason, sqlState) } });

    const error = await new SupabaseUserRepository(client).requestAccountDeletion().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DeleteAccountError);
    expect(error).toMatchObject({ code });
  });

  it('lets a missing function reach the degrade rule', async () => {
    const { client } = createFakeClient({
      rpc: { request_account_deletion: { data: null, error: { code: 'PGRST202', message: 'not found' } } },
    });

    await expect(new SupabaseUserRepository(client).requestAccountDeletion()).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});
