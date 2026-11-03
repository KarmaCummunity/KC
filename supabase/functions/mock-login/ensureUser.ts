// Local mock-login only — ensures auth.users + public.users (+ optional admin grant).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const MOCK_DEV_PASSWORD = 'KcLocal!2026';
export const DEFAULT_MOCK_EMAIL = 'test-user@local.dev';
export const DEFAULT_MOCK_NAME = 'Local Test User';

export type MockLoginInput = {
  userId?: string;
  email?: string;
  role?: string;
  displayName?: string;
};

export type EnsureUserResult = {
  userId: string;
  email: string;
  displayName: string;
};

function normalizeRole(role?: string): 'user' | 'admin' {
  return role === 'admin' ? 'admin' : 'user';
}

async function findUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const users = data?.users ?? [];
  const match = users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
  return match?.id ?? null;
}

async function ensureAuthUser(
  admin: SupabaseClient,
  email: string,
  displayName: string,
  preferredUserId?: string,
): Promise<string> {
  if (preferredUserId) {
    const { data, error } = await admin.auth.admin.getUserById(preferredUserId);
    if (!error && data?.user) {
      await admin.auth.admin.updateUserById(preferredUserId, {
        email,
        password: MOCK_DEV_PASSWORD,
        email_confirm: true,
        user_metadata: { name: displayName, full_name: displayName },
      });
      return preferredUserId;
    }
  }

  const existingId = await findUserIdByEmail(admin, email);
  if (existingId) {
    await admin.auth.admin.updateUserById(existingId, {
      password: MOCK_DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { name: displayName, full_name: displayName },
    });
    return existingId;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: MOCK_DEV_PASSWORD,
    email_confirm: true,
    user_metadata: { name: displayName, full_name: displayName },
    ...(preferredUserId ? { user_metadata: { name: displayName, full_name: displayName } } : {}),
  });
  if (error || !data.user) throw error ?? new Error('create_user_failed');
  return data.user.id;
}

async function ensurePublicUserRow(
  admin: SupabaseClient,
  userId: string,
  displayName: string,
): Promise<void> {
  await admin.from('users').upsert({
    user_id: userId,
    display_name: displayName,
    account_status: 'active',
  }, { onConflict: 'user_id' });
}

async function ensureAdminGrant(admin: SupabaseClient, userId: string): Promise<void> {
  const { data: existing } = await admin
    .from('admin_role_grants')
    .select('grant_id')
    .eq('user_id', userId)
    .eq('role', 'super_admin')
    .is('revoked_at', null)
    .maybeSingle();
  if (existing) return;
  await admin.from('admin_role_grants').insert({
    user_id: userId,
    role: 'super_admin',
    granted_by: userId,
  });
}

export async function ensureMockUser(
  admin: SupabaseClient,
  input: MockLoginInput,
): Promise<EnsureUserResult> {
  const email = (input.email ?? DEFAULT_MOCK_EMAIL).trim().toLowerCase();
  const displayName = (input.displayName ?? '').trim()
    || (email === DEFAULT_MOCK_EMAIL ? DEFAULT_MOCK_NAME : email.split('@')[0]);
  const userId = await ensureAuthUser(admin, email, displayName, input.userId);
  await ensurePublicUserRow(admin, userId, displayName);
  if (normalizeRole(input.role) === 'admin') {
    await ensureAdminGrant(admin, userId);
  }
  return { userId, email, displayName };
}
