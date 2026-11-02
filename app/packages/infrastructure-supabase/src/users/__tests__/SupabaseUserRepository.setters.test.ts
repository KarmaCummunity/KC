import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseUserRepository } from '../SupabaseUserRepository';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Covers the simple SupabaseUserRepository methods that don't delegate
// to already-covered helpers: direct UPDATE-on-users setters, dismissal
// flags, the notification-preferences RPC, and the NOT_IMPL throwers.
//
// deleteAccountViaEdgeFunction is covered in a sibling .delete.test.ts
// — its 4-branch HTTP-status error mapping needs richer setup.

interface FakeOpts {
  updateError?: { message: string } | null;
  updateData?: any;
  rpcData?: unknown;
  rpcError?: { message: string } | null;
}
interface Calls {
  updates: { row: any }[];
  rpcs: { fn: string; args: unknown }[];
}

function makeFakeClient(opts: FakeOpts = {}): { client: SupabaseClient<any>; calls: Calls } {
  const calls: Calls = { updates: [], rpcs: [] };
  const client = {
    from: () => ({
      update: (row: any) => {
        const result = async () => {
          calls.updates.push({ row });
          return { data: opts.updateData ?? null, error: opts.updateError ?? null };
        };
        return {
          eq: () =>
            Object.assign(result(), {
              select: () => ({ single: result }),
            }),
        };
      },
    }),
    rpc: async (fn: string, args: unknown) => {
      calls.rpcs.push({ fn, args });
      return { data: opts.rpcData ?? null, error: opts.rpcError ?? null };
    },
  } as unknown as SupabaseClient<any>;
  return { client, calls };
}

describe('SupabaseUserRepository — direct UPDATE-on-users setters', () => {
  it.each([
    ['setOnboardingState', (r: SupabaseUserRepository) => r.setOnboardingState('u_1', 'completed'), { onboarding_state: 'completed' }],
    ['setAvatar (string)', (r: SupabaseUserRepository) => r.setAvatar('u_1', 'a.jpg'), { avatar_url: 'a.jpg' }],
    ['setAvatar (null)', (r: SupabaseUserRepository) => r.setAvatar('u_1', null), { avatar_url: null }],
    ['setBiography (string)', (r: SupabaseUserRepository) => r.setBiography('u_1', 'bio'), { biography: 'bio' }],
    ['setBiography (null)', (r: SupabaseUserRepository) => r.setBiography('u_1', null), { biography: null }],
    ['dismissClosureExplainer', (r: SupabaseUserRepository) => r.dismissClosureExplainer('u_1'), { closure_explainer_dismissed: true }],
    ['dismissFirstPostNudge', (r: SupabaseUserRepository) => r.dismissFirstPostNudge('u_1'), { first_post_nudge_dismissed: true }],
  ])('%s writes the right row to users.update', async (_label, call, expectedRow) => {
    const { client, calls } = makeFakeClient({});
    await call(new SupabaseUserRepository(client));
    expect(calls.updates[0]?.row).toEqual(expectedRow);
  });

  it.each([
    ['setOnboardingState', (r: SupabaseUserRepository) => r.setOnboardingState('u_1', 'completed')],
    ['setAvatar', (r: SupabaseUserRepository) => r.setAvatar('u_1', null)],
    ['setBiography', (r: SupabaseUserRepository) => r.setBiography('u_1', null)],
    ['dismissClosureExplainer', (r: SupabaseUserRepository) => r.dismissClosureExplainer('u_1')],
    ['dismissFirstPostNudge', (r: SupabaseUserRepository) => r.dismissFirstPostNudge('u_1')],
  ])('%s throws with a prefixed error message on update failure', async (label, call) => {
    const { client } = makeFakeClient({ updateError: { message: 'rls denied' } });
    await expect(call(new SupabaseUserRepository(client))).rejects.toThrow(`${label}: rls denied`);
  });
});

describe('SupabaseUserRepository — setPrivacyMode', () => {
  const FAKE_USER_ROW = {
    user_id: 'u_1', auth_provider: 'google', share_handle: 'a', display_name: 'A',
    city: 'IL-001', city_name: 'TLV', profile_street: null, profile_street_number: null,
    biography: null, avatar_url: null, privacy_mode: 'Private',
    privacy_changed_at: '2026-05-16T12:00:00.000Z', account_status: 'active',
    onboarding_state: 'completed', notification_preferences: {}, is_super_admin: false,
    closure_explainer_dismissed: false, first_post_nudge_dismissed: false,
    items_given_count: 0, items_received_count: 0, active_posts_count_internal: 0,
    followers_count: 0, following_count: 0,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-05-16T00:00:00.000Z',
  };

  it('updates privacy_mode and stamps privacy_changed_at, returns the mapped User', async () => {
    const { client, calls } = makeFakeClient({ updateData: FAKE_USER_ROW });
    const before = Date.now();
    const out = await new SupabaseUserRepository(client).setPrivacyMode('u_1', 'Private');
    const after = Date.now();

    expect(calls.updates[0]?.row.privacy_mode).toBe('Private');
    const stamped = new Date(calls.updates[0]?.row.privacy_changed_at).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
    expect(out.userId).toBe('u_1');
    expect(out.privacyMode).toBe('Private');
  });

  it('throws with a prefixed message on update error', async () => {
    const { client } = makeFakeClient({ updateError: { message: 'check failed' } });
    await expect(
      new SupabaseUserRepository(client).setPrivacyMode('u_1', 'Public'),
    ).rejects.toThrow('setPrivacyMode: check failed');
  });
});

describe('SupabaseUserRepository — updateNotificationPreferences', () => {
  it('passes only the supplied flags as p_merge to users_merge_notification_preferences', async () => {
    const { client, calls } = makeFakeClient({ rpcData: { critical: true, social: false } });
    await new SupabaseUserRepository(client).updateNotificationPreferences('u_1', { critical: true });
    expect(calls.rpcs).toEqual([
      { fn: 'users_merge_notification_preferences', args: { p_user_id: 'u_1', p_merge: { critical: true } } },
    ]);
  });

  it('passes both flags when both are provided', async () => {
    const { client, calls } = makeFakeClient({ rpcData: { critical: false, social: true } });
    await new SupabaseUserRepository(client).updateNotificationPreferences('u_1', { critical: false, social: true });
    expect((calls.rpcs[0]?.args as { p_merge: unknown }).p_merge).toEqual({ critical: false, social: true });
  });

  it('passes an empty merge object when neither flag is provided (caller already validated)', async () => {
    const { client, calls } = makeFakeClient({ rpcData: { critical: false, social: false } });
    await new SupabaseUserRepository(client).updateNotificationPreferences('u_1', {});
    expect((calls.rpcs[0]?.args as { p_merge: unknown }).p_merge).toEqual({});
  });

  it('throws with prefixed "updateNotificationPreferences: " message on RPC error', async () => {
    const { client } = makeFakeClient({ rpcError: { message: 'rpc error' } });
    await expect(
      new SupabaseUserRepository(client).updateNotificationPreferences('u_1', { critical: true }),
    ).rejects.toThrow('updateNotificationPreferences: rpc error');
  });
});

describe('SupabaseUserRepository — NOT_IMPL throwers', () => {
  const { client } = makeFakeClient({});
  const repo = new SupabaseUserRepository(client);

  it.each([
    ['create', () => repo.create()],
    ['update', () => repo.update()],
    ['delete', () => repo.delete('u_1')],
    ['findByAuthIdentity', () => repo.findByAuthIdentity('google', 'sub')],
    ['createAuthIdentity', () => repo.createAuthIdentity()],
  ])('%s throws "not_implemented" sentinel', async (label, call) => {
    await expect(call()).rejects.toThrow(`SupabaseUserRepository.${label}: not_implemented`);
  });
});
