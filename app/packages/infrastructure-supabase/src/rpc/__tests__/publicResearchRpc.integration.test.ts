// Audit C-01 / H-BE-01 — anon must not call research submit or has_admin_role directly.

import { afterAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.legacy.types';
import { createIntegrationClient } from '../../__tests__/integrationSupabaseClient';

const URL = process.env['SUPABASE_URL'] ?? process.env['EXPO_PUBLIC_SUPABASE_URL'];
const ANON = process.env['SUPABASE_ANON_KEY'] ?? process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];
const SERVICE = process.env['SUPABASE_SERVICE_ROLE_KEY'];

const skip = !URL || !ANON;
const d = skip ? describe.skip : describe;

function anonClient(): SupabaseClient<Database> {
  return createIntegrationClient(URL!, ANON!);
}

d('public research + admin RPC grants (Wave 1)', () => {
  let admin: SupabaseClient<Database>;
  const cleanup: Array<() => Promise<void>> = [];

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  it('rejects anon direct rpc submit_public_research_response', async () => {
    const anon = anonClient();
    const { error } = await anon.rpc('submit_public_research_response', {
      p_slug: 'nonexistent-survey',
      p_version: 1,
      p_source: 'direct',
      p_ip_hash: 'fake',
      p_user_agent_hash: 'fake',
      p_answers: {},
      p_honeypot: '',
    });
    expect(error).not.toBeNull();
    expect(error?.code).toMatch(/42501|PGRST301/);
  });

  it('rejects anon direct rpc has_admin_role', async () => {
    if (!SERVICE) return;
    admin = createIntegrationClient(URL!, SERVICE!);
    const email = `wave1-anon-${Date.now()}@kc.test`;
    const { data, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: 'p4ssword!!',
      email_confirm: true,
    });
    if (createErr || !data.user) throw createErr ?? new Error('no user');
    const uid = data.user.id;
    cleanup.push(async () => {
      await admin.auth.admin.deleteUser(uid);
    });

    const anon = anonClient();
    const { error } = await anon.rpc('has_admin_role', { uid, role_name: 'super_admin' });
    expect(error).not.toBeNull();
    expect(error?.code).toMatch(/42501|PGRST301/);
  });

  it('authenticated service path still allows has_admin_role via service role', async () => {
    if (!SERVICE) return;
    const adminClient = createIntegrationClient(URL!, SERVICE!);
    const email = `wave1-svc-${Date.now()}@kc.test`;
    const { data, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password: 'p4ssword!!',
      email_confirm: true,
    });
    if (createErr || !data.user) throw createErr ?? new Error('no user');
    const uid = data.user.id;
    cleanup.push(async () => {
      await adminClient.auth.admin.deleteUser(uid);
    });

    const { data: roleData, error } = await adminClient.rpc('has_admin_role', {
      uid,
      role_name: 'support',
    });
    expect(error).toBeNull();
    expect(roleData).toBe(false);
  });
});
