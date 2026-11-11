// Audit C-01 / H-BE-01 — anon must not call the public-research submit RPC directly: the
// `public-research-submit` Edge Function (service role) is the only way in.
// (The old `has_admin_role` probes are gone with the function: the baseline exposes staff roles
// only through `get_my_admin_roles()` / `bootstrap_session()`, which answer about the caller alone.)

import { describe, expect, it } from 'vitest';
import { createIntegrationClient } from '../../__tests__/integrationSupabaseClient';

const URL = process.env['SUPABASE_URL'] ?? process.env['EXPO_PUBLIC_SUPABASE_URL'];
const ANON = process.env['SUPABASE_ANON_KEY'] ?? process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];

const skip = !URL || !ANON;
const d = skip ? describe.skip : describe;

d('public research RPC grants', () => {
  it('rejects anon direct rpc submit_public_research_response', async () => {
    const anon = createIntegrationClient(URL!, ANON!);
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
});
