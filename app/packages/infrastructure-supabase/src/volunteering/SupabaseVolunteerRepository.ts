// Volunteering over event posts (design Q3, G18): an opportunity is an event post with its
// `post_event_details` row, and one shift is one such post. A sign-up is a registration (a
// `post_handoffs` row of the `event_registration` machine); attendance is marked by the organizer.
// Places held and left per shift come from `post_seat_counts`, readable by everyone who can see the
// event (the registrations themselves stay visible to their two members only).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IVolunteerRepository } from '@kc/application';
import type {
  MyVolunteerOpportunityOrganizerRow,
  MyVolunteerSignupRow,
  ShiftVolunteerRow,
  VolunteerOpportunityBrowseRow,
  VolunteerOpportunityDetail,
} from '@kc/domain';
import type { Database } from '../database.types';
import { unwrapCall } from '../rpc/mapRpcError';
import { clampPageLimit } from '../posts/postCardPages';
import { sessionUserId } from '../users/userReads';
import {
  cancelEventRegistration,
  messageEventRegistrants,
  registerForEvent,
} from '../marketplace/eventRegistrations';
import { fetchCardsInOrder } from '../marketplace/listingMapping';
import { loadSeatCounts } from '../marketplace/postSeatCounts';

type Client = SupabaseClient<Database>;
type EventRow = Database['public']['Tables']['post_event_details']['Row'];

/** Registration states that hold a place or a place in line. */
const LIVE_STATUSES = ['waitlisted', 'reserved', 'confirmed'] as const;
const HOUR_MS = 3_600_000;

async function loadEventRows(client: Client, postIds: readonly string[]): Promise<Map<string, EventRow>> {
  if (postIds.length === 0) return new Map();
  const rows = unwrapCall('table:post_event_details', await client.from('post_event_details').select('*').in('post_id', [...postIds]));
  return new Map((rows ?? []).map((row) => [row.post_id, row]));
}

/** Hours between the start and the end of an event, to one decimal. */
function eventHours(event: EventRow): number {
  return Math.round(((Date.parse(event.ends_at) - Date.parse(event.starts_at)) / HOUR_MS) * 10) / 10;
}

export class SupabaseVolunteerRepository implements IVolunteerRepository {
  constructor(private readonly client: Client) {}

  /** The next volunteering events of the time world (event posts), as the world feed lists them. */
  async listOpportunities(limit = 30): Promise<VolunteerOpportunityBrowseRow[]> {
    const rows = unwrapCall(
      'rpc:feed_page',
      await this.client.rpc('feed_page', { p_limit: clampPageLimit(limit), p_filters: { world: 'time', sort: 'newest' } }),
    );
    const cards = (rows ?? []).map((row) => row.card).filter((card) => card.post_type === 'event' && card.id !== null);
    const ids = cards.map((card) => card.id as string);
    const [events, seats] = await Promise.all([loadEventRows(this.client, ids), loadSeatCounts(this.client, ids)]);
    return cards.flatMap((card) => {
      const event = events.get(card.id as string);
      if (!event) return [];
      return [
        {
          opportunityId: card.id as string,
          title: card.title ?? '',
          summary: card.description,
          locationLabel: event.address_label,
          cityId: card.city_id,
          nextShiftAt: event.starts_at,
          // An event without a capacity has no count of places left; it shows none.
          openSlots: seats.get(card.id as string)?.left ?? 0,
        },
      ];
    });
  }

  /** One opportunity is one event, with a single shift (itself). */
  async getOpportunityDetail(opportunityId: string): Promise<VolunteerOpportunityDetail | null> {
    const [[card], events, seats] = await Promise.all([
      fetchCardsInOrder(this.client, [opportunityId]),
      loadEventRows(this.client, [opportunityId]),
      loadSeatCounts(this.client, [opportunityId]),
    ]);
    const event = events.get(opportunityId);
    if (!card?.id || !event) return null;
    const seat = seats.get(opportunityId);
    const userId = await sessionUserId(this.client);
    const mine = userId ? await this.myRegistrationStatus(opportunityId, userId) : null;
    return {
      opportunityId,
      organizerId: card.owner_id ?? '',
      title: card.title ?? '',
      summary: card.description,
      locationLabel: event.address_label,
      cityId: card.city_id,
      status: card.status ?? '',
      shifts: [
        {
          shiftId: opportunityId,
          startsAt: event.starts_at,
          endsAt: event.ends_at,
          capacity: event.capacity ?? 0,
          filled: seat?.taken ?? 0,
          slotsOpen: seat?.left ?? 0,
          myStatus: mine,
        },
      ],
    };
  }

  private async myRegistrationStatus(postId: string, userId: string): Promise<string | null> {
    const row = unwrapCall(
      'table:post_handoffs',
      await this.client
        .from('post_handoffs')
        .select('status')
        .eq('post_id', postId)
        .eq('recipient_id', userId)
        .in('status', [...LIVE_STATUSES])
        .maybeSingle(),
    );
    return row?.status ?? null;
  }

  async signUpForShift(shiftId: string) {
    const registration = await registerForEvent(this.client, shiftId);
    return { signupId: registration.handoffId, status: registration.status };
  }

  cancelSignup = (signupId: string) => cancelEventRegistration(this.client, signupId);

  /** The caller's live and attended registrations to events, newest first; attended ones carry the hours they logged. */
  async listMySignups(limit = 50): Promise<MyVolunteerSignupRow[]> {
    const userId = await sessionUserId(this.client);
    if (!userId) return [];
    const handoffs =
      unwrapCall(
        'table:post_handoffs',
        await this.client.from('post_handoffs').select('*').eq('recipient_id', userId).eq('machine_id', 'event_registration').in('status', [...LIVE_STATUSES, 'handed_over']).order('created_at', { ascending: false }).limit(limit),
      ) ?? [];
    const ids = handoffs.map((row) => row.post_id);
    const [events, posts] = await Promise.all([
      loadEventRows(this.client, ids),
      ids.length === 0 ? { data: [], error: null } : this.client.from('posts').select('id, title').in('id', ids),
    ]);
    const titles = new Map((unwrapCall('table:posts', posts) ?? []).map((post) => [post.id, post.title]));
    return handoffs.flatMap((row) => {
      const event = events.get(row.post_id);
      if (!event) return [];
      return [
        {
          signupId: row.id,
          shiftId: row.post_id,
          opportunityId: row.post_id,
          title: titles.get(row.post_id) ?? '',
          startsAt: event.starts_at,
          endsAt: event.ends_at,
          status: row.status,
          hoursLogged: row.status === 'handed_over' ? eventHours(event) : null,
        },
      ];
    });
  }

  /** The organizer closes the event without a recipient; a live registration refuses it. */
  async closeOpportunity(opportunityId: string): Promise<void> {
    unwrapCall('rpc:close_post_without_recipient', await this.client.rpc('close_post_without_recipient', { p_post_id: opportunityId }));
  }

  /** The organizer's own events, newest first. */
  async listMyOrganizerOpportunities(limit = 50): Promise<MyVolunteerOpportunityOrganizerRow[]> {
    const userId = await sessionUserId(this.client);
    if (!userId) return [];
    const posts =
      unwrapCall(
        'table:posts',
        await this.client
          .from('posts')
          .select('id, title, description, city_id, status, created_at, updated_at')
          .eq('owner_id', userId)
          .eq('post_type', 'event')
          .neq('status', 'draft')
          .order('created_at', { ascending: false })
          .limit(limit),
      ) ?? [];
    const events = await loadEventRows(this.client, posts.map((post) => post.id));
    return posts.map((post) => ({
      opportunityId: post.id,
      title: post.title,
      summary: post.description,
      locationLabel: events.get(post.id)?.address_label ?? null,
      cityId: post.city_id,
      status: post.status,
      createdAt: post.created_at,
      updatedAt: post.updated_at,
    }));
  }

  /** The organizer's roster of the event, oldest registration first; the waiting list is numbered in that order. */
  async listShiftVolunteers(shiftId: string): Promise<ShiftVolunteerRow[]> {
    const handoffs =
      unwrapCall('table:post_handoffs', await this.client.from('post_handoffs').select('*').eq('post_id', shiftId).order('created_at', { ascending: true })) ?? [];
    if (handoffs.length === 0) return [];
    const [users, events] = await Promise.all([
      this.client.from('users').select('id, display_name, share_handle').in('id', [...new Set(handoffs.map((row) => row.recipient_id))]),
      loadEventRows(this.client, [shiftId]),
    ]);
    const userById = new Map((unwrapCall('table:users', users) ?? []).map((user) => [user.id, user]));
    const event = events.get(shiftId);
    let waiting = 0;
    return handoffs.map((row) => {
      const position = row.status === 'waitlisted' ? ++waiting : null;
      const user = userById.get(row.recipient_id);
      return {
        signupId: row.id,
        userId: row.recipient_id,
        displayName: user?.display_name ?? null,
        shareHandle: user?.share_handle ?? null,
        status: row.status,
        waitlistPosition: position,
        hoursLogged: row.status === 'handed_over' && event ? eventHours(event) : null,
      };
    });
  }

  messageShiftVolunteers = (shiftId: string, message: string) => messageEventRegistrants(this.client, shiftId, message);
}
