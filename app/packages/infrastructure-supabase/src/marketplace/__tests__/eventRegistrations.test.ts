import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import * as events from '../eventRegistrations';

const ROW = {
  id: 'h1', post_id: 'p1', owner_id: 'o', recipient_id: 'r', machine_id: 'event_registration', status: 'confirmed', pickup_mode: 'pickup',
  pickup_window_start: null, pickup_window_end: null, confirm_by: null, created_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T01:00:00Z',
};

describe('event registrations', () => {
  it('registers and returns the active registration', async () => {
    const { client, calls } = createFakeClient({ rpc: { register_for_event: ok(ROW) } });
    expect(await events.registerForEvent(client, 'p1')).toEqual({
      handoffId: 'h1', status: 'confirmed', reservedAt: '2026-01-01T00:00:00Z', confirmedAt: '2026-01-01T01:00:00Z',
    });
    expect(callsTo(calls, 'register_for_event')[0]?.args).toEqual({ p_post_id: 'p1' });
  });

  it('fails when the answer is not an active registration', async () => {
    const { client } = createFakeClient({ rpc: { register_for_event: ok({ ...ROW, status: 'cancelled' }) } });
    await expect(events.registerForEvent(client, 'p1')).rejects.toMatchObject({ code: 'listing_not_available' });
  });

  it('decides, cancels, marks attendance and messages through their RPCs', async () => {
    const { client, calls } = createFakeClient({
      rpc: { decide_event_registration: ok(ROW), cancel_event_registration: ok(ROW), mark_event_attendance: ok(ROW), message_event_registrants: ok(4) },
    });
    await events.decideEventRegistration(client, 'h1', true);
    await events.cancelEventRegistration(client, 'h1');
    await events.markEventAttendance(client, 'h1', false);
    expect(await events.messageEventRegistrants(client, 'p1', 'hello')).toBe(4);
    expect(callsTo(calls, 'decide_event_registration')[0]?.args).toEqual({ p_handoff_id: 'h1', p_approve: true });
    expect(callsTo(calls, 'mark_event_attendance')[0]?.args).toEqual({ p_handoff_id: 'h1', p_attended: false });
    expect(callsTo(calls, 'message_event_registrants')[0]?.args).toEqual({ p_post_id: 'p1', p_body: 'hello' });
  });

  it('lists the roster oldest first with names and skips unknown states', async () => {
    const { client } = createFakeClient({
      tables: { post_handoffs: ok([ROW, { ...ROW, id: 'h2', status: 'odd' }]), users: ok([{ id: 'r', display_name: 'Dana' }]) },
    });
    expect(await events.listEventRegistrations(client, 'p1')).toEqual([
      { handoffId: 'h1', recipientId: 'r', displayName: 'Dana', status: 'confirmed', reservedAt: '2026-01-01T00:00:00Z', confirmedAt: '2026-01-01T01:00:00Z' },
    ]);
  });

  it('reads the caller\'s active registration, none for a guest', async () => {
    const { client } = createFakeClient({ userId: 'r', tables: { post_handoffs: ok(ROW) } });
    expect((await events.getMyEventRegistration(client, 'p1'))?.handoffId).toBe('h1');
    expect(await events.getMyEventRegistration(createFakeClient({ userId: null }).client, 'p1')).toBeNull();
  });

  it('lists the caller\'s organizations once each, by name', async () => {
    const { client } = createFakeClient({
      userId: 'r',
      tables: {
        org_memberships: ok([
          { org_id: 'b', organizations: { name: 'Beta' } },
          { org_id: 'a', organizations: [{ name: 'Alpha' }] },
          { org_id: 'a', organizations: { name: 'Alpha' } },
          { org_id: 'z', organizations: null },
        ]),
      },
    });
    expect(await events.listMyOrganizations(client)).toEqual([{ orgId: 'a', name: 'Alpha' }, { orgId: 'b', name: 'Beta' }]);
  });

  it('keeps refusal reasons and reports a missing function', async () => {
    const refused = createFakeClient({ rpc: { mark_event_attendance: fail('P0001', 'event_not_started') } });
    await expect(events.markEventAttendance(refused.client, 'h1', true)).rejects.toMatchObject({ constructor: BackendRuleError, reason: 'event_not_started' });
    const missing = createFakeClient({ rpc: { register_for_event: fail('PGRST202', 'nope') } });
    await expect(events.registerForEvent(missing.client, 'p1')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
