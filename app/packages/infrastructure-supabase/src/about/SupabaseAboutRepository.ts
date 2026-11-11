// SupabaseAboutRepository — adapter for IAboutRepository (About team roster).
//
// M08: the `about_team_profiles` view is not carried over and staff grants are not readable by
// members, so the roster cannot be read. The adapter reports it as missing and the About screen
// shows no team section; the team ships as static content of the app or not at all. No call is made.

import type { IAboutRepository } from '@kc/application';
import { BackendUnavailableError, type AboutTeamMember } from '@kc/domain';

export class SupabaseAboutRepository implements IAboutRepository {
  listTeamMembers(): Promise<AboutTeamMember[]> {
    return Promise.reject(new BackendUnavailableError('table:about_team_profiles', 'relation'));
  }
}
