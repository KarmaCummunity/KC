// Event registrations on the shared `post_handoffs` table (machine `event_registration`, G18).
//
// A registration is a handoff of an event post: `waitlisted`, `reserved` (waiting for the
// organizer), `confirmed`, `handed_over` (attended) or `no_show`. Each change is an RPC that
// returns the updated row; a refusal is a stable reason (`BackendRuleError`). Split out of
// SupabaseMarketplaceRepository for the 300-line cap.

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
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { sessionUserId } from '../users/userReads';
import type { HandoffRow } from './givingHandoffs';
import { requireRpcRow } from './rpcRow';

type Client = SupabaseClient<Database>;

/** One membership row with its organization's name embedded (org_memberships → organizations). */
interface MembershipRow {
  readonly org_id: string;
  readonly organizations: { readonly name: string } | { readonly name: string }[] | null;
}

/** The caller's registration from a handoff row; null once it is no longer active. */
export function mapMyEventRegistration(
  row: Pick<HandoffRow, 'id' | 'status' | 'created_at' | 'confirmed_at'>,
): MyEventRegistration | null {
  if (!isActiveEventRegistrationStatus(row.status)) return null;
  return { handoffId: row.id, status: row.status, reservedAt: row.created_at, confirmedAt: row.confirmed_at };
}

/** One roster row; null for a state this app does not know (skipped rather than mislabelled). */
export function mapEventRegistration(row: HandoffRow, displayName: string | null): EventRegistration | null {
  if (!isEventRegistrationStatus(row.status)) return null;
  return {
    handoffId: row.id,
    recipientId: row.recipient_id,
    displayName,
    status: row.status,
    reservedAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

/** Distinct organizations (one row per membership) sorted by name for the picker. */
export function toMembershipOptions(rows: readonly MembershipRow[]): OrganizationMembershipOption[] {
  const byId = new Map<string, OrganizationMembershipOption>();
  for (const row of rows) {
    const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (organization && !byId.has(row.org_id)) byId.set(row.org_id, { orgId: row.org_id, name: organization.name });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Registers the caller; confirmed at once, waiting for the organizer, or on the waiting list of a full event. */
export async function registerForEvent(client: Client, target: string): Promise<MyEventRegistration> {
  const row = requireRpcRow(
    unwrapCall('rpc:register_for_event', await client.rpc('register_for_event', { p_post_id: target })),
    'register_for_event',
  );
  const registration = mapMyEventRegistration(row);
  if (!registration) throw new GivingHandoffError('listing_not_available', 'register_for_event returned no active registration');
  return registration;
}

/** The organizer approves or declines a registration waiting for approval. */
export async function decideEventRegistration(client: Client, handoffId: string, approve: boolean): Promise<void> {
  unwrapCall(
    'rpc:decide_event_registration',
    await client.rpc('decide_event_registration', { p_handoff_id: handoffId, p_approve: approve }),
  );
}

/** The member leaves the event or its waiting list, or the organizer removes a registration. */
export async function cancelEventRegistration(client: Client, handoffId: string): Promise<void> {
  unwrapCall('rpc:cancel_event_registration', await client.rpc('cancel_event_registration', { p_handoff_id: handoffId }));
}

/** Organizer only, once the event started: attended (karma once, S13) or absent (`event_not_started` before). */
export async function markEventAttendance(client: Client, handoffId: string, attended: boolean): Promise<void> {
  unwrapCall(
    'rpc:mark_event_attendance',
    await client.rpc('mark_event_attendance', { p_handoff_id: handoffId, p_attended: attended }),
  );
}

/** The organizer sends a short message to everyone registered; resolves to how many were told. */
export async function messageEventRegistrants(client: Client, postId: string, body: string): Promise<number> {
  return (
    unwrapCall(
      'rpc:message_event_registrants',
      await client.rpc('message_event_registrants', { p_post_id: postId, p_body: body }),
    ) ?? 0
  );
}

/**
 * The organizer's roster, every state included, oldest registration first (the waiting list is in
 * that order). The table shows the organizer all handoffs of their post and anyone else only their
 * own; the names come from `users`.
 */
export async function listEventRegistrations(client: Client, target: string): Promise<EventRegistration[]> {
  const rows =
    unwrapCall(
      'table:post_handoffs',
      await client.from('post_handoffs').select('*').eq('post_id', target).order('created_at', { ascending: true }),
    ) ?? [];
  if (rows.length === 0) return [];
  const users =
    unwrapCall(
      'table:users',
      await client.from('users').select('id, display_name').in('id', [...new Set(rows.map((row) => row.recipient_id))]),
    ) ?? [];
  const nameById = new Map(users.map((user) => [user.id, user.display_name]));
  return rows.flatMap((row) => {
    const registration = mapEventRegistration(row, nameById.get(row.recipient_id) ?? null);
    return registration ? [registration] : [];
  });
}

/** The caller's latest active (reserved, confirmed or waitlisted) registration to the post. */
export async function getMyEventRegistration(client: Client, postId: string): Promise<MyEventRegistration | null> {
  const userId = await sessionUserId(client);
  if (!userId) return null;
  const row = unwrapCall(
    'table:post_handoffs',
    await client
      .from('post_handoffs')
      .select('*')
      .eq('post_id', postId)
      .eq('recipient_id', userId)
      .in('status', [...ACTIVE_EVENT_REGISTRATION_STATUSES])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row ? mapMyEventRegistration(row) : null;
}

/** The organizations the caller belongs to, for the event form's picker. */
export async function listMyOrganizations(client: Client): Promise<OrganizationMembershipOption[]> {
  const userId = await sessionUserId(client);
  if (!userId) return [];
  const rows = unwrapCall(
    'table:org_memberships',
    await client.from('org_memberships').select('org_id, organizations(name)').eq('user_id', userId),
  );
  return toMembershipOptions(rows ?? []);
}
