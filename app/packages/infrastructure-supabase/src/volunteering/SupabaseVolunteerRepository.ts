import type { SupabaseClient } from '@supabase/supabase-js';
import type { IVolunteerRepository } from '@kc/application';
import type {
  MyVolunteerOpportunityOrganizerRow,
  MyVolunteerSignupRow,
  ShiftVolunteerRow,
  VolunteerCheckInResult,
  VolunteerOpportunityBrowseRow,
  VolunteerOpportunityDetail,
  VolunteerShiftSlot,
} from '@kc/domain';
import type { Database } from '../database.legacy.types';

type BrowseRow = Database['public']['Functions']['list_volunteer_opportunities']['Returns'][number];
type SignupRow = Database['public']['Functions']['list_my_volunteer_signups']['Returns'][number];
type RosterRow = Database['public']['Functions']['list_shift_volunteers']['Returns'][number];
type OppRow = Database['public']['Tables']['volunteer_opportunities']['Row'];

function mapBrowse(row: BrowseRow): VolunteerOpportunityBrowseRow {
  return {
    opportunityId: row.opportunity_id,
    title: row.title,
    summary: row.summary,
    locationLabel: row.location_label,
    cityId: row.city_id,
    nextShiftAt: row.next_shift_at,
    openSlots: row.open_slots,
  };
}

function mapSignup(row: SignupRow): MyVolunteerSignupRow {
  return {
    signupId: row.signup_id,
    shiftId: row.shift_id,
    opportunityId: row.opportunity_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    hoursLogged: row.hours_logged != null ? Number(row.hours_logged) : null,
  };
}

function mapRoster(row: RosterRow): ShiftVolunteerRow {
  return {
    signupId: row.signup_id,
    userId: row.user_id,
    displayName: row.display_name,
    shareHandle: row.share_handle,
    status: row.status,
    waitlistPosition: row.waitlist_position,
    hoursLogged: row.hours_logged != null ? Number(row.hours_logged) : null,
  };
}

function mapOrganizerOpp(row: OppRow): MyVolunteerOpportunityOrganizerRow {
  return {
    opportunityId: row.opportunity_id,
    title: row.title,
    summary: row.summary,
    locationLabel: row.location_label,
    cityId: row.city_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseDetail(data: unknown): VolunteerOpportunityDetail | null {
  if (data == null || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const shiftsRaw = o.shifts;
  const shifts: VolunteerShiftSlot[] = [];
  if (Array.isArray(shiftsRaw)) {
    for (const raw of shiftsRaw) {
      if (!raw || typeof raw !== 'object') continue;
      const s = raw as Record<string, unknown>;
      shifts.push({
        shiftId: String(s.shift_id),
        startsAt: String(s.starts_at),
        endsAt: String(s.ends_at),
        capacity: Number(s.capacity ?? 0),
        filled: Number(s.filled ?? 0),
        slotsOpen: Number(s.slots_open ?? 0),
        myStatus: s.my_status != null ? String(s.my_status) : null,
      });
    }
  }
  return {
    opportunityId: String(o.opportunity_id),
    organizerId: String(o.organizer_id),
    title: String(o.title),
    summary: o.summary != null ? String(o.summary) : null,
    locationLabel: o.location_label != null ? String(o.location_label) : null,
    cityId: o.city_id != null ? String(o.city_id) : null,
    status: String(o.status),
    shifts,
  };
}

export class SupabaseVolunteerRepository implements IVolunteerRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async listOpportunities(limit = 30, offset = 0) {
    const { data, error } = await this.client.rpc('list_volunteer_opportunities', {
      p_limit: limit,
      p_offset: offset,
    });
    if (error || !data) return [];
    return data.map(mapBrowse);
  }

  async getOpportunityDetail(opportunityId: string) {
    const { data, error } = await this.client.rpc('get_volunteer_opportunity_detail', {
      p_opportunity_id: opportunityId,
    });
    if (error) return null;
    return parseDetail(data);
  }

  async signUpForShift(shiftId: string) {
    const { data, error } = await this.client.rpc('sign_up_volunteer_shift', {
      p_shift_id: shiftId,
    });
    if (error || !data) throw error ?? new Error('sign_up_volunteer_shift failed');
    const row = data as Database['public']['Tables']['volunteer_shift_signups']['Row'];
    return { signupId: row.signup_id, status: row.status };
  }

  async cancelSignup(signupId: string) {
    const { error } = await this.client.rpc('cancel_volunteer_signup', { p_signup_id: signupId });
    if (error) throw error;
  }

  async listMySignups(limit = 50) {
    const { data, error } = await this.client.rpc('list_my_volunteer_signups', { p_limit: limit });
    if (error || !data) return [];
    return data.map(mapSignup);
  }

  async checkIn(signupId: string): Promise<VolunteerCheckInResult> {
    const { data, error } = await this.client.rpc('check_in_volunteer_shift', {
      p_signup_id: signupId,
    });
    if (error || data == null || typeof data !== 'object') {
      throw error ?? new Error('check_in_volunteer_shift failed');
    }
    const o = data as Record<string, unknown>;
    return {
      hoursLogged: Number(o.hours_logged ?? 0),
      karmaPoints: Number(o.karma_points ?? 0),
    };
  }

  async getShiftIcs(shiftId: string) {
    const { data, error } = await this.client.rpc('get_volunteer_shift_ics', {
      p_shift_id: shiftId,
    });
    if (error) throw error;
    return data ?? null;
  }

  async closeOpportunity(opportunityId: string) {
    const { error } = await this.client.rpc('close_volunteer_opportunity', {
      p_opportunity_id: opportunityId,
    });
    if (error) throw error;
  }

  async listMyOrganizerOpportunities(limit = 50) {
    const { data, error } = await this.client.rpc('list_my_volunteer_opportunities', {
      p_limit: limit,
    });
    if (error || !data) return [];
    return data.map(mapOrganizerOpp);
  }

  async listShiftVolunteers(shiftId: string) {
    const { data, error } = await this.client.rpc('list_shift_volunteers', {
      p_shift_id: shiftId,
    });
    if (error || !data) return [];
    return data.map(mapRoster);
  }

  async messageShiftVolunteers(shiftId: string, message: string) {
    const { data, error } = await this.client.rpc('organizer_message_shift_volunteers', {
      p_shift_id: shiftId,
      p_message: message,
    });
    if (error) throw error;
    return Number(data ?? 0);
  }
}
