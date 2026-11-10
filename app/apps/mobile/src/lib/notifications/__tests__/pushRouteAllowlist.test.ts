import { describe, it, expect } from 'vitest';
import { resolvePushRoute } from '../pushRouteAllowlist';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('resolvePushRoute', () => {
  it('routes chat_message to /chat/[id] when chat_id is a UUID', () => {
    expect(
      resolvePushRoute({
        category: 'social',
        kind: 'chat_message',
        notification_id: 'n1',
        chat_id: UUID,
      }),
    ).toEqual({ pathname: '/chat/[id]', params: { id: UUID } });
  });

  it('routes follow_request to /settings/follow-requests', () => {
    expect(
      resolvePushRoute({
        category: 'social',
        kind: 'follow_request',
        notification_id: 'n2',
      }),
    ).toEqual({ pathname: '/settings/follow-requests', params: {} });
  });

  it.each([
    'listing_expiring',
    'listing_expired',
    'ride_booking_requested',
    'ride_booking_confirmed',
    'ride_booking_declined',
    'ride_booking_expired',
    'ride_booking_cancelled',
    'ride_route_match',
    'ride_listing_emergency',
    'giving_handoff_requested',
    'giving_handoff_claimed',
    'giving_handoff_confirmed',
    'giving_handoff_declined',
    'giving_handoff_cancelled',
    'giving_handoff_expired',
    'giving_handoff_completed',
    'knowledge_booking_requested',
    'knowledge_booking_confirmed',
    'knowledge_booking_declined',
    'knowledge_booking_expired',
    'knowledge_booking_cancelled',
    'knowledge_session_completed',
  ] as const)('routes %s to the listing (KC#1316, D70, D73, D74, FR-NOTIF-018, FR-KNOW-004)', (kind) => {
    expect(
      resolvePushRoute({ category: 'critical', kind, notification_id: 'n9', params: { listingId: UUID } }),
    ).toEqual({ pathname: '/listing/[listingId]', params: { listingId: UUID } });
    expect(
      resolvePushRoute({ category: 'critical', kind, notification_id: 'n10', params: { listingId: 'not-a-uuid' } }),
    ).toBeNull();
  });

  it.each([
    'listing_expired',
    'ride_booking_requested',
    'ride_route_match',
    'giving_handoff_claimed',
    'housing_booking_requested',
    'event_registration_cancelled',
  ] as const)('opens the post of a listing notification (G1 step 4c, 0562): %s', (kind) => {
    const POST = '22222222-2222-4222-8222-222222222222';
    expect(
      resolvePushRoute({ category: 'critical', kind, notification_id: 'n11', params: { listingId: UUID, postId: POST } }),
    ).toEqual({ pathname: '/post/[id]', params: { id: POST } });
    // A malformed post id is ignored; the listing route still forwards to the post.
    expect(
      resolvePushRoute({ category: 'critical', kind, notification_id: 'n12', params: { listingId: UUID, postId: 'nope' } }),
    ).toEqual({ pathname: '/listing/[listingId]', params: { listingId: UUID } });
  });

  it('routes a post_relevance_check reminder (D59) to the post, and drops a bad id', () => {
    expect(
      resolvePushRoute({ category: 'critical', kind: 'post_relevance_check', notification_id: 'n9', params: { id: UUID } }),
    ).toEqual({ pathname: '/post/[id]', params: { id: UUID } });
    expect(
      resolvePushRoute({ category: 'critical', kind: 'post_relevance_check', notification_id: 'n10', params: { id: 'nope' } }),
    ).toBeNull();
  });

  it('rejects an unknown kind', () => {
    expect(
      resolvePushRoute({
        category: 'social',
        // @ts-expect-error — intentionally malformed
        kind: 'attacker_kind',
        notification_id: 'n3',
      }),
    ).toBeNull();
  });

  it('rejects chat_message when chat_id is not a UUID', () => {
    expect(
      resolvePushRoute({
        category: 'social',
        kind: 'chat_message',
        notification_id: 'n4',
        chat_id: '../../etc/passwd',
      }),
    ).toBeNull();
  });

  it('routes task_assigned to /(admin)/tasks/[taskId] when task_id is a UUID', () => {
    expect(
      resolvePushRoute({
        category: 'social',
        kind: 'task_assigned',
        notification_id: 'n6',
        params: { task_id: UUID },
      }),
    ).toEqual({ pathname: '/(admin)/tasks/[taskId]', params: { taskId: UUID } });
  });

  it('falls back to the tasks list when task_id is missing or malformed', () => {
    expect(
      resolvePushRoute({
        category: 'social',
        kind: 'task_assigned',
        notification_id: 'n7',
        params: { task_id: 'not-a-uuid' },
      }),
    ).toEqual({ pathname: '/(admin)/tasks', params: {} });
  });

  it('ignores attacker-supplied data.route', () => {
    expect(
      resolvePushRoute({
        category: 'social',
        kind: 'follow_request',
        notification_id: 'n5',
        // route is a valid field on PushData (kept for back-compat) but resolvePushRoute ignores it
        route: '/auth/callback',
        params: { code: 'stolen' },
      }),
    ).toEqual({ pathname: '/settings/follow-requests', params: {} });
  });

  // FR-RIDE-013, FR-RIDE-019 — rides notification routing.
  describe('rides notifications', () => {
    const RIDE_KINDS = [
      'ride_request',
      'ride_approved',
      'ride_rejected',
      'ride_participant_cancelled',
      'ride_participant_cancelled_by_owner',
      'ride_started',
      'ride_arrived',
      'ride_breakdown',
      'ride_emergency',
    ] as const;

    // ride_rate_prompt lives on a different path (/[id]/rate) — separate
    // assertion below.

    for (const kind of RIDE_KINDS) {
      it(`routes ${kind} to /(tabs)/donations/rides/[id] when params.id is a UUID`, () => {
        expect(
          resolvePushRoute({
            category: 'critical',
            kind,
            notification_id: `n-${kind}`,
            params: { id: UUID },
          }),
        ).toEqual({ pathname: '/(tabs)/donations/rides/[id]', params: { id: UUID } });
      });

      it(`rejects ${kind} when params.id is malformed`, () => {
        expect(
          resolvePushRoute({
            category: 'critical',
            kind,
            notification_id: `n-bad-${kind}`,
            params: { id: '../../etc/passwd' },
          }),
        ).toBeNull();
      });
    }

    it('routes ride_rate_prompt to /donations/rides/[id]/rate', () => {
      expect(
        resolvePushRoute({
          category: 'social',
          kind: 'ride_rate_prompt',
          notification_id: 'n-rate',
          params: { id: UUID },
        }),
      ).toEqual({
        pathname: '/(tabs)/donations/rides/[id]/rate',
        params: { id: UUID },
      });
    });
  });
  describe('matching v2', () => {
    for (const kind of ['match_suggested', 'match_interest', 'match_accepted'] as const) {
      it(`routes ${kind} to /matches and ignores data.route/params`, () => {
        expect(
          resolvePushRoute({
            category: 'social',
            kind,
            notification_id: `n-${kind}`,
            route: '/settings/delete-account',
            params: { id: '../../x' },
          }),
        ).toEqual({ pathname: '/matches', params: {} });
      });
    }
  });

  describe('chat and post lifecycle notifications', () => {
    it.each(['support_message', 'system_message'] as const)(
      'routes %s to /chat/[id] using chat_id or params.id',
      (kind) => {
        expect(
          resolvePushRoute({ category: 'social', kind, notification_id: 'n', chat_id: UUID }),
        ).toEqual({ pathname: '/chat/[id]', params: { id: UUID } });

        expect(
          resolvePushRoute({ category: 'social', kind, notification_id: 'n', params: { id: UUID } }),
        ).toEqual({ pathname: '/chat/[id]', params: { id: UUID } });
      },
    );

    it.each(['post_expiring', 'mark_recipient', 'unmark_recipient'] as const)(
      'routes %s to /post/[id] when id is a valid UUID',
      (kind) => {
        expect(
          resolvePushRoute({ category: 'critical', kind, notification_id: 'n', params: { id: UUID } }),
        ).toEqual({ pathname: '/post/[id]', params: { id: UUID } });

        expect(
          resolvePushRoute({ category: 'critical', kind, notification_id: 'n', params: { id: 'bad' } }),
        ).toBeNull();
      },
    );

    it('routes auto_removed to /settings/audit', () => {
      expect(
        resolvePushRoute({ category: 'critical', kind: 'auto_removed', notification_id: 'n' }),
      ).toEqual({ pathname: '/settings/audit', params: {} });
    });

    it.each(['follow_started', 'follow_approved'] as const)(
      'routes %s to /settings/follow-requests',
      (kind) => {
        expect(
          resolvePushRoute({ category: 'social', kind, notification_id: 'n' }),
        ).toEqual({ pathname: '/settings/follow-requests', params: {} });
      },
    );

    it('routes task_assigned using params.id when task_id is omitted', () => {
      expect(
        resolvePushRoute({
          category: 'social',
          kind: 'task_assigned',
          notification_id: 'n',
          params: { id: UUID },
        }),
      ).toEqual({ pathname: '/(admin)/tasks/[taskId]', params: { taskId: UUID } });
    });
  });
});
