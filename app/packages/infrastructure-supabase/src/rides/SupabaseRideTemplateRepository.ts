// FR-RIDE-021 / FR-RIDE-022 — Supabase adapter for IRideTemplateRepository.
//
// Templates allow direct RLS-gated CRUD (owner-only on all five verbs), so
// no SECURITY DEFINER RPC layer is needed; we just hit `from('ride_templates')`
// with the standard supabase-js builder.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RideTemplate, RideTemplateStatus } from '@kc/domain';
import type {
  CreateRideTemplateInput,
  IRideTemplateRepository,
} from '@kc/application';
import type { Database } from '../database.legacy.types';
import { mapRideTemplateRow } from './mapRideTemplateRow';

type TemplateRow = Database['public']['Tables']['ride_templates']['Row'];

export class SupabaseRideTemplateRepository implements IRideTemplateRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async create(input: CreateRideTemplateInput): Promise<RideTemplate> {
    const { data, error } = await this.client
      .from('ride_templates')
      .insert({
        owner_id: input.ownerId,
        mode: input.mode,
        origin_city_id: input.originCityId,
        dest_city_id: input.destCityId,
        origin_street: input.originStreet,
        origin_street_number: input.originStreetNumber,
        dest_street: input.destStreet,
        dest_street_number: input.destStreetNumber,
        depart_time: input.departTime,
        weekday_mask: input.weekdayMask,
        seats_available: input.seatsAvailable,
        description: input.description,
        visibility: input.visibility,
        lookahead_days: input.lookaheadDays,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return mapRideTemplateRow(data as TemplateRow);
  }

  async getById(templateId: string): Promise<RideTemplate | null> {
    const { data, error } = await this.client
      .from('ride_templates')
      .select('*')
      .eq('template_id', templateId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return mapRideTemplateRow(data as TemplateRow);
  }

  async listForOwner(ownerId: string): Promise<readonly RideTemplate[]> {
    const { data, error } = await this.client
      .from('ride_templates')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRideTemplateRow);
  }

  async setStatus(templateId: string, status: RideTemplateStatus): Promise<RideTemplate> {
    const { data, error } = await this.client
      .from('ride_templates')
      .update({ status })
      .eq('template_id', templateId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return mapRideTemplateRow(data as TemplateRow);
  }

  async delete(templateId: string): Promise<void> {
    const { error } = await this.client
      .from('ride_templates')
      .delete()
      .eq('template_id', templateId);
    if (error) throw new Error(error.message);
  }
}
