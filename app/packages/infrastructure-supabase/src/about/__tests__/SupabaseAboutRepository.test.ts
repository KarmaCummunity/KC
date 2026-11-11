import { describe, it, expect } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseAboutRepository } from '../SupabaseAboutRepository';

// M08: the baseline does not carry `about_team_profiles` over, so the roster is reported as
// missing without a call and the About screen shows no team section.
describe('SupabaseAboutRepository — listTeamMembers (capability missing from the baseline)', () => {
  it('reports the team roster as unavailable', async () => {
    const error = await new SupabaseAboutRepository().listTeamMembers().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect(error).toMatchObject({ object: 'table:about_team_profiles', kind: 'relation' });
  });
});
