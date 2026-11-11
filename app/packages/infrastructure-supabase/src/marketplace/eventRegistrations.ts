import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACTIVE_EVENT_REGISTRATION_STATUSES,
  GivingHandoffError,
  isActiveEventRegistrationStatus,
  isEventRegistrationStatus,
  type EventRegistration,
  type MyEventRegistration,
  type OrganizationMembershipOption,
} from '@kc/domain';
import type { Database } from '../database.legacy.types';

// Organization event RPCs and reads (G1 step 5, supabase/migrations/0563_event_posts.sql and
// 0564_event_attendance_waitlist.sql), split out of SupabaseMarketplaceRepository to keep that
// file under the 300-line architecture cap.
type Client = SupabaseClient<Database>;
type HandoffRow = Pick<
  Database['public']['Tables']['post_handoffs']['Row'],
  'handoff_id' | 'status' | 'reserved_at' | 'confirmed_at'
>;
type RosterRow = Database['public']['Functions']['list_event_registrations']['Returns'][number];
/** One membership row with its organization's name embedded (org_memberships → organizations). */
interface MembershipRow {
  readonly org_id: string;
  readonly organizations: { readonly name: string } | null;
}

/** The caller's registration from a post handoff row; null once it is no longer active. */
export function mapMyEventRegistration(row: HandoffRow): MyEventRegistration | null {
  if (!isActiveEventRegistrationStatus(row.status)) return null;
  return { handoffId: row.handoff_id, status: row.status, reservedAt: row.reserved_at, confirmedAt: row.confirmed_at };
}

/** One roster row; null for a state this app does not know (skipped rather than mislabelled). */
export function mapEventRegistration(row: RosterRow): EventRegistration | null {
  if (!isEventRegistrationStatus(row.status)) return null;
  return {
    handoffId: row.handoff_id,
    recipientId: row.recipient_id,
    displayName: row.display_name,
    status: row.status,
    reservedAt: row.reserved_at,
    confirmedAt: row.confirmed_at,
  };
}

/** Distinct organizations (one row per membership role) sorted by name for the picker. */
export function toMembershipOptions(rows: readonly MembershipRow[]): OrganizationMembershipOption[] {
  const byId = new Map<string, OrganizationMembershipOption>();
  for (const row of rows) {
    if (row.organizations && !byId.has(row.org_id)) byId.set(row.org_id, { orgId: row.org_id, name: row.organizations.name });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The signed-in member's id from the cached session; null for a guest. */
async function currentUserId(client: Client): Promise<string | null> {
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function registerForEvent(client: Client, target: string): Promise<MyEventRegistration> {
  const { data, error } = await client.rpc('register_for_event', { p_target: target });
  if (error) throw error;
  const registration = data ? mapMyEventRegistration(data) : null;
  if (!registration) throw new GivingHandoffError('listing_not_available', 'register_for_event returned no registration');
  return registration;
}

export async function decideEventRegistration(client: Client, handoffId: string, approve: boolean): Promise<void> {
  const { error } = await client.rpc('decide_event_registration', { p_handoff_id: handoffId, p_approve: approve });
  if (error) throw error;
}

export async function cancelEventRegistration(client: Client, handoffId: string): Promise<void> {
  const { error } = await client.rpc('cancel_event_registration', { p_handoff_id: handoffId });
  if (error) throw error;
}

/** Organizer only, after the event starts: attended (karma once, S13) or absent; errors rethrown. */
export async function markEventAttendance(client: Client, handoffId: string, attended: boolean): Promise<void> {
  const { error } = await client.rpc('mark_event_attendance', { p_handoff_id: handoffId, p_attended: attended });
  if (error) throw error;
}

/** The organizer's roster, every state included; the RPC refuses anyone else (`not_owner`), which is rethrown. */
export async function listEventRegistrations(client: Client, target: string): Promise<EventRegistration[]> {
  const { data, error } = await client.rpc('list_event_registrations', { p_target: target });
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const registration = mapEventRegistration(row);
    return registration ? [registration] : [];
  });
}

/** The caller's latest active (reserved, confirmed or waitlisted) registration to the post (RLS lets participants read their rows). */
export async function getMyEventRegistration(client: Client, postId: string): Promise<MyEventRegistration | null> {
  const userId = await currentUserId(client);
  if (!userId) return null;
  const { data, error } = await client
    .from('post_handoffs')
    .select('handoff_id, status, reserved_at, confirmed_at')
    .eq('post_id', postId)
    .eq('recipient_id', userId)
    .in('status', [...ACTIVE_EVENT_REGISTRATION_STATUSES])
    .order('reserved_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapMyEventRegistration(data) : null;
}

export async function listMyOrganizations(client: Client): Promise<OrganizationMembershipOption[]> {
  const userId = await currentUserId(client);
  if (!userId) return [];
  const { data, error } = await client
    .from('org_memberships')
    .select('org_id, organizations(name)')
    .eq('user_id', userId);
  if (error) throw error;
  return toMembershipOptions(data ?? []);
}
