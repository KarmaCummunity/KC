import { describe, it, expect } from 'vitest';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseAboutRepository } from '../SupabaseAboutRepository';

// M08 — migration 0031: the About roster is read through about_team_profiles().
describe('SupabaseAboutRepository — listTeamMembers', () => {
  it('maps the roster rows in the server order', async () => {
    const { client } = createFakeClient({
      rpc: {
        about_team_profiles: {
          data: [{ role_key: 'founder', sort_order: 1, display_name: 'Dana', avatar_url: null, share_handle: 'dana' }],
          error: null,
        },
      },
    });
    expect(await new SupabaseAboutRepository(client as never).listTeamMembers()).toEqual([
      { roleKey: 'founder', sortOrder: 1, displayName: 'Dana', avatarUrl: null, shareHandle: 'dana' },
    ]);
  });
});
