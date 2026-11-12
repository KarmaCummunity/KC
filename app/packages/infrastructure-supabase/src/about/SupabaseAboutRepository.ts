// SupabaseAboutRepository — adapter for IAboutRepository (About team roster, M08, FR-ADMIN-026).
//
// The roster is the curated `about_team_members` table, read through `about_team_profiles()`
// (migration 0031): the role key the About copy describes and the linked member's public
// profile fields, active members only.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IAboutRepository } from '@kc/application';
import type { AboutTeamMember } from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';

export class SupabaseAboutRepository implements IAboutRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listTeamMembers(): Promise<AboutTeamMember[]> {
    const rows = unwrapCall('rpc:about_team_profiles', await this.client.rpc('about_team_profiles'));
    return (rows ?? []).map((row) => ({
      roleKey: row.role_key,
      sortOrder: row.sort_order,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      shareHandle: row.share_handle,
    }));
  }
}
