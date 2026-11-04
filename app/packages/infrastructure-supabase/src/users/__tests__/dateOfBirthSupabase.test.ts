import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ProfileError } from '@kc/application';
import { supabaseSetDateOfBirth } from '../onboardingSupabase';
import { scrubUserForNonOwner } from '../scrubUserForViewer';
import { mapUserRow, type UserRow } from '../mapUserRow';

// FR-AUTH-010 AC2.d — the private date of birth: written through one RPC, never read for others.

function clientWith(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

describe('supabaseSetDateOfBirth', () => {
  it('calls rpc_set_date_of_birth with the ISO date', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await supabaseSetDateOfBirth(clientWith(rpc), '1990-05-15');
    expect(rpc).toHaveBeenCalledWith('rpc_set_date_of_birth', { p_date_of_birth: '1990-05-15' });
  });

  it.each([
    ['underage', 'underage'],
    ['invalid_date_of_birth', 'invalid_date_of_birth'],
  ])('maps the server error "%s" to a ProfileError with that code', async (message, code) => {
    const rpc = vi.fn().mockResolvedValue({ error: { message } });
    await expect(supabaseSetDateOfBirth(clientWith(rpc), '2015-01-01')).rejects.toMatchObject({
      name: 'ProfileError',
      code,
    });
    await expect(supabaseSetDateOfBirth(clientWith(rpc), '2015-01-01')).rejects.toBeInstanceOf(ProfileError);
  });

  it('rethrows any other failure as a plain error', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'connection reset' } });
    await expect(supabaseSetDateOfBirth(clientWith(rpc), '1990-05-15')).rejects.toThrow('setDateOfBirth: connection reset');
  });
});

describe('date of birth stays private', () => {
  const row = {
    user_id: 'u1', auth_provider: 'email', share_handle: 'h', display_name: 'N', city: '1', city_name: 'C',
    biography: null, avatar_url: null, privacy_mode: 'Public', privacy_changed_at: null, account_status: 'active',
    onboarding_state: 'completed', notification_preferences: {}, is_super_admin: false,
    closure_explainer_dismissed: false, first_post_nudge_dismissed: false, items_given_count: 0,
    items_received_count: 0, active_posts_count_internal: 0, followers_count: 0, following_count: 0,
    karma_points: 0, created_at: '2026-01-01', updated_at: '2026-01-01',
  } as unknown as UserRow;

  it('a row read from users has no date of birth (the column is not selectable)', () => {
    expect(mapUserRow(row).dateOfBirth).toBeNull();
  });

  it('a user object shown to someone else is scrubbed of it', () => {
    const own = { ...mapUserRow(row), dateOfBirth: '1990-05-15' };
    expect(scrubUserForNonOwner(own).dateOfBirth).toBeNull();
  });
});
