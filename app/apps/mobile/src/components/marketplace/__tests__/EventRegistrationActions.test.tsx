// @vitest-environment jsdom
// G1 step 5 (docs/spec/08_organizations.md Events, D31, S13) — an organization event's post page:
// a member registers (or asks to join a manual event), follows and cancels their registration or
// leaves the waitlist; the organizer approves, declines or removes registrations, sees the
// waitlist in promotion order and, from the start, marks attendance; a guest gets no section.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';

// vi.mock factories are hoisted above imports, so their spies must be hoisted too.
const uc = vi.hoisted(() => ({
  register: vi.fn(),
  decide: vi.fn(),
  cancel: vi.fn(),
  markAttendance: vi.fn(),
  listForEvent: vi.fn(),
  getMine: vi.fn(),
}));
let sessionUserId: string | null = 'u_member';

// The kit buttons pull in reanimated and haptics; their press feedback is not under test here.
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({ session: sessionUserId ? { userId: sessionUserId } : null }),
}));
vi.mock('../../../services/eventRegistrationComposition', () => ({
  myEventRegistrationQueryKey: (id: string) => ['event-registration', 'mine', id],
  eventRosterQueryKey: (id: string) => ['event-registration', 'roster', id],
  eventRegistrationUseCases: Object.fromEntries(Object.entries(uc).map(([name, fn]) => [name, () => ({ execute: fn })])),
}));
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => undefined, hapticSuccess: vi.fn() }));
vi.mock('../../../lib/observability/sentry', () => ({ getSentryIfInit: () => null }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { EventRegistrationActions } from '../events/EventRegistrationActions';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionUserId = 'u_member';
});

const FUTURE = { starts_at: '2099-01-01T10:00:00Z', ends_at: '2099-01-01T12:00:00Z' };
const PAST = { starts_at: '2000-01-01T10:00:00Z', ends_at: '2000-01-01T12:00:00Z' };

/** A roster row of `status`, registered at `reservedAt`. */
function registration(handoffId: string, status: string, reservedAt = '2026-11-01T10:00:00Z') {
  return { handoffId, recipientId: `u_${handoffId}`, displayName: handoffId, status, reservedAt, confirmedAt: null };
}

function event(policy: string, overrides: Partial<MarketplaceListingDetail> = {}): MarketplaceListingDetail {
  return {
    listingId: 'l_event',
    ownerId: 'u_org',
    worldSlug: 'time',
    kindSlug: 'org_event',
    direction: 'give',
    details: { ...FUTURE, registration_policy: policy },
    feedPostId: 'p_event',
    ...overrides,
  } as MarketplaceListingDetail;
}

function renderActions(detail: MarketplaceListingDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <EventRegistrationActions detail={detail} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('EventRegistrationActions — member', () => {
  it('registers to an automatic event by post id', async () => {
    uc.getMine.mockResolvedValue(null);
    uc.register.mockResolvedValue({ handoffId: 'h1', status: 'confirmed' });
    const { findByTestId } = renderActions(event('automatic'));
    const button = await findByTestId('event-register');
    expect(button.textContent).toBe('eventPost.registration.register');
    fireEvent.click(button);
    await waitFor(() => expect(uc.register).toHaveBeenCalledWith('p_event'));
  });

  it('asks to join a manual event, then shows the pending status with a cancel action', async () => {
    uc.getMine.mockResolvedValue(null);
    const first = renderActions(event('manual'));
    expect((await first.findByTestId('event-register')).textContent).toBe('eventPost.registration.requestToJoin');
    cleanup();

    uc.getMine.mockResolvedValue({ handoffId: 'h1', status: 'reserved', reservedAt: 'a', confirmedAt: null });
    const { findByTestId, queryByTestId } = renderActions(event('manual'));
    expect(await findByTestId('event-status-pending')).toBeTruthy();
    expect(queryByTestId('event-register')).toBeNull();
    fireEvent.click(await findByTestId('event-cancel'));
    await waitFor(() => expect(uc.cancel).toHaveBeenCalledWith('h1'));
  });

  it('closes registration once the event has started', async () => {
    uc.getMine.mockResolvedValue(null);
    const started = event('automatic', { details: { starts_at: '2000-01-01T10:00:00Z', ends_at: '2000-01-01T12:00:00Z', registration_policy: 'automatic' } });
    const { findByTestId, queryByTestId } = renderActions(started);
    expect(await findByTestId('event-started')).toBeTruthy();
    expect(queryByTestId('event-register')).toBeNull();
  });

  it('shows the server\'s refusal copy when registration fails', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    uc.getMine.mockResolvedValue(null);
    uc.register.mockRejectedValue({ message: 'verification_required' });
    const { findByTestId } = renderActions(event('verified_only'));
    fireEvent.click(await findByTestId('event-register'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('marketplace.errors.verification_required'));
  });
});

describe('EventRegistrationActions — organizer and guests', () => {
  it('lets the organizer approve, decline and remove registrations', async () => {
    sessionUserId = 'u_org';
    uc.listForEvent.mockResolvedValue([
      { handoffId: 'h_wait', recipientId: 'u2', displayName: 'Dana', status: 'reserved', reservedAt: 'a', confirmedAt: null },
      { handoffId: 'h_in', recipientId: 'u3', displayName: null, status: 'confirmed', reservedAt: 'a', confirmedAt: 'b' },
    ]);
    const { findByTestId } = renderActions(event('manual'));
    expect(await findByTestId('event-roster')).toBeTruthy();
    fireEvent.click(await findByTestId('event-roster-approve-h_wait'));
    await waitFor(() => expect(uc.decide).toHaveBeenCalledWith('h_wait', true));
    fireEvent.click(await findByTestId('event-roster-decline-h_wait'));
    await waitFor(() => expect(uc.decide).toHaveBeenCalledWith('h_wait', false));
    fireEvent.click(await findByTestId('event-roster-remove-h_in'));
    await waitFor(() => expect(uc.cancel).toHaveBeenCalledWith('h_in'));
    expect(uc.listForEvent).toHaveBeenCalledWith('p_event');
  });

  it('shows nothing to a guest, on an unpublished event or on another kind', () => {
    sessionUserId = null;
    expect(renderActions(event('automatic')).container.innerHTML).toBe('');
    cleanup();
    sessionUserId = 'u_member';
    expect(renderActions(event('automatic', { feedPostId: null })).container.innerHTML).toBe('');
    cleanup();
    expect(renderActions(event('automatic', { kindSlug: 'volunteer_shift' })).container.innerHTML).toBe('');
    expect(uc.getMine).not.toHaveBeenCalled();
  });
});

describe('EventRegistrationActions — waitlist (0564)', () => {
  it('a waitlisted member sees the waitlist status and can leave it', async () => {
    uc.getMine.mockResolvedValue({ handoffId: 'h_w', status: 'waitlisted', reservedAt: 'a', confirmedAt: null });
    const { findByTestId, queryByTestId } = renderActions(event('automatic'));
    expect(await findByTestId('event-status-waitlisted')).toBeTruthy();
    expect(queryByTestId('event-register')).toBeNull();
    const leave = await findByTestId('event-cancel');
    expect(leave.textContent).toBe('eventPost.registration.leaveWaitlist');
    fireEvent.click(leave);
    await waitFor(() => expect(uc.cancel).toHaveBeenCalledWith('h_w'));
  });

  it('lists the waitlist earliest first with its places, and the organizer can remove from it', async () => {
    sessionUserId = 'u_org';
    uc.listForEvent.mockResolvedValue([
      registration('h_late', 'waitlisted', '2026-11-02T10:00:00Z'),
      registration('h_in', 'confirmed'),
      registration('h_early', 'waitlisted', '2026-11-01T09:00:00Z'),
    ]);
    const { findByTestId, getByTestId, queryByTestId } = renderActions(event('automatic'));
    const waitlist = await findByTestId('event-roster-waitlist');
    const order = Array.from(waitlist.querySelectorAll('[data-testid^="event-roster-row-"]')).map((n) => n.getAttribute('data-testid'));
    expect(order).toEqual(['event-roster-row-h_early', 'event-roster-row-h_late']);
    expect(getByTestId('event-roster-status-h_early').textContent).toBe('eventPost.roster.waitlistPosition');
    // Before the start: no attendance marks.
    expect(queryByTestId('event-roster-attended-h_in')).toBeNull();
    fireEvent.click(getByTestId('event-roster-remove-h_late'));
    await waitFor(() => expect(uc.cancel).toHaveBeenCalledWith('h_late'));
  });
});

describe('EventRegistrationActions — attendance after the start (S13)', () => {
  const started = event('automatic', { details: { ...PAST, registration_policy: 'automatic' } });

  it('marks a confirmed registrant attended or absent, and corrects an absence', async () => {
    sessionUserId = 'u_org';
    uc.listForEvent.mockResolvedValue([
      registration('h_in', 'confirmed'),
      registration('h_away', 'no_show'),
      registration('h_came', 'handed_over'),
    ]);
    const { findByTestId, getByTestId, queryByTestId } = renderActions(started);
    // Every roster action is blocked while one runs, so each press waits for the previous one.
    const pressWhenEnabled = async (testId: string) => {
      const button = await findByTestId(testId);
      await waitFor(() => expect(button.getAttribute('aria-disabled')).not.toBe('true'));
      fireEvent.click(button);
    };
    await pressWhenEnabled('event-roster-attended-h_in');
    await waitFor(() => expect(uc.markAttendance).toHaveBeenCalledWith('h_in', true));
    await pressWhenEnabled('event-roster-noshow-h_in');
    await waitFor(() => expect(uc.markAttendance).toHaveBeenCalledWith('h_in', false));
    expect(queryByTestId('event-roster-remove-h_in')).toBeNull();
    // An absence can be corrected to attended, never marked absent again.
    expect(queryByTestId('event-roster-noshow-h_away')).toBeNull();
    await pressWhenEnabled('event-roster-attended-h_away');
    await waitFor(() => expect(uc.markAttendance).toHaveBeenCalledWith('h_away', true));
    // Marked attendance is final: its label, no actions.
    expect(getByTestId('event-roster-status-h_came').textContent).toBe('eventPost.roster.statusLabel.handed_over');
    expect(queryByTestId('event-roster-attended-h_came')).toBeNull();
  });

  it('shows the server\'s copy when attendance is refused', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    sessionUserId = 'u_org';
    uc.listForEvent.mockResolvedValue([registration('h_in', 'confirmed')]);
    uc.markAttendance.mockRejectedValue({ message: 'event_not_started' });
    const { findByTestId } = renderActions(started);
    fireEvent.click(await findByTestId('event-roster-attended-h_in'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('marketplace.errors.event_not_started'));
  });
});
