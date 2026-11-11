// SupabaseAboutRepository — adapter for IAboutRepository (About team roster).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IAboutRepository } from '@kc/application';
import type { AboutTeamMember } from '@kc/domain';
import type { Database } from '../database.legacy.types';

type AboutTeamRow = {
  role_key: string;
  sort_order: number;
  display_name: string;
  avatar_url: string | null;
  share_handle: string;
};

function mapRow(row: AboutTeamRow): AboutTeamMember {
  return {
    roleKey: row.role_key,
    sortOrder: row.sort_order,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    shareHandle: row.share_handle,
  };
}

export class SupabaseAboutRepository implements IAboutRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listTeamMembers(): Promise<AboutTeamMember[]> {
    const { data, error } = await this.client
      .from('about_team_profiles')
      .select('role_key, sort_order, display_name, avatar_url, share_handle')
      .limit(100);

    if (error) throw new Error(`listTeamMembers: ${error.message}`);
    return (data ?? []).map((row) => mapRow(row as AboutTeamRow));
  }
}
