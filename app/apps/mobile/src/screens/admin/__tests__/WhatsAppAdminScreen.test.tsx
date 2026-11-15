// @vitest-environment jsdom
// #939 — the admin WhatsApp console: staff (`whatsapp.manage`) see the panels and decide the
// review queue; only a super admin (`whatsapp.configure`) gets the send limits and template
// status controls; a member without the permission sees the refusal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';

const { roles, uc } = vi.hoisted(() => {
  const page = (rows: unknown[]) => Promise.resolve({ rows, nextCursor: null });
  return {
    roles: { current: [] as string[] },
    uc: {
      getWhatsAppAdminOverview: { execute: vi.fn(() => Promise.resolve({
        channelEnabled: false, since: new Date(), outboundQueued: 1, outboundSent: 2, outboundFailed: 3,
        outboundSkipped: 0, consentOptedIn: 4, consentOptedOut: 0, sessions7d: 0, matchesSent7d: 0,
        rateHits7d: 0, reviewPending: 7,
      })) },
      getWhatsAppChannel: { execute: vi.fn(() => Promise.resolve({ isEnabled: false, phoneNumberId: null, graphApiVersion: null, updatedAt: null, updatedBy: null })) },
      setWhatsAppChannelEnabled: { execute: vi.fn() },
      listWhatsAppOutbound: { execute: vi.fn(() => page([{
        outboundId: 'o1', userId: 'u1', waIdMasked: '•••1', kind: 'template', templateName: 'match_found_v1',
        language: 'he', status: 'failed', attempts: 1, lastError: null, createdAt: new Date(), sentAt: null, nextAttemptAt: null,
      }])) },
      listWhatsAppConsent: { execute: vi.fn(() => page([])) },
      listWhatsAppReviews: { execute: vi.fn(() => page([{
        reviewId: 'r1', sessionId: 's1', postId: 'p1', postTitle: 'ספה', postStatus: 'draft', ownerId: 'u1',
        reason: 'low_confidence_extraction', status: 'pending', confidence: 0.6, reviewerId: null,
        createdAt: new Date(), resolvedAt: null,
      }])) },
      resolveWhatsAppReview: { execute: vi.fn(() => Promise.resolve('approved')) },
      resendWhatsAppOutbound: { execute: vi.fn(() => Promise.resolve('queued')) },
      blockWhatsAppUser: { execute: vi.fn() },
      listWhatsAppRecentMatches: { execute: vi.fn(() => Promise.resolve([])) },
      listWhatsAppRateHits: { execute: vi.fn(() => Promise.resolve([])) },
      listWhatsAppConversations: { execute: vi.fn(() => Promise.resolve([])) },
      listWhatsAppTemplates: { execute: vi.fn(() => Promise.resolve([{
        templateName: 'match_found_v1', languageCode: 'he', category: 'utility', bodyPreview: 'x', params: [],
        registryVersion: 1, isApproved: false, metaStatus: 'draft', metaTemplateId: null, updatedAt: new Date(),
      }])) },
      setWhatsAppTemplateStatus: { execute: vi.fn(() => Promise.resolve()) },
      setWhatsAppSendLimits: { execute: vi.fn(() => Promise.resolve({
        perUserHour: 6, perUserDay: 20, replyPerPhoneHour: 30, globalPerMinute: 60, globalTemplateRecipientsDay: 1000,
        inboundPerPhoneMinute: 20, llmPerPhoneDay: 30, llmGlobalDay: 2000, maxAttempts: 5, backoffBaseSeconds: 30,
        updatedAt: null, updatedBy: null,
      })) },
    },
  };
});

vi.mock('../../../lib/container', () => ({ container: uc }));
vi.mock('../../../hooks/useAdminRoles', () => ({ useAdminRoles: () => ({ roles: roles.current, isLoading: false }) }));
vi.mock('../../../services/platformConfirm', () => ({ confirmAction: () => Promise.resolve(true) }));
vi.mock('../../../components/RouteErrorBoundary', () => ({ RouteErrorBoundary: () => null }));
vi.mock('../../../components/admin/AdminSearchFilterToolbar', () => ({ AdminFilterTopBarButton: () => null }));
vi.mock('../../../components/admin/AdminFormField', () => ({
  AdminFormField: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('react-native-reanimated', async () => (await import('../../../components/ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../../components/ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../../components/ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../i18n/useLocaleBundle', async () => {
  const he = (await import('../../../i18n/locales/he')).default;
  return { useLocaleBundle: () => he, localeBundle: () => he };
});

import { WhatsAppAdminScreen } from '../WhatsAppAdminScreen';
import { localeBundle } from '../../../i18n/useLocaleBundle';

const t = localeBundle().admin.whatsapp;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <WhatsAppAdminScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('WhatsAppAdminScreen', () => {
  it('refuses a member without whatsapp.manage', () => {
    roles.current = ['support'];
    const v = renderScreen();
    expect(v.getByText(t.forbiddenTitle)).toBeTruthy();
    expect(uc.getWhatsAppAdminOverview.execute).not.toHaveBeenCalled();
  });

  it('a moderator sees the review queue and approves a post, but no configuration controls', async () => {
    roles.current = ['moderator'];
    const v = renderScreen();
    expect(await v.findByText('ספה')).toBeTruthy();
    expect(await v.findByText(t.overview.reviewPending)).toBeTruthy();
    expect(v.getByText(t.templates.superAdminOnly)).toBeTruthy();
    expect(v.queryByText(t.sections.limits)).toBeNull();
    expect(v.queryByTestId('whatsapp-template-edit-match_found_v1:he')).toBeNull();
    fireEvent.click(v.getByTestId('whatsapp-review-approve-r1'));
    await waitFor(() => expect(uc.resolveWhatsAppReview.execute).toHaveBeenCalledWith('r1', 'approved'));
  });

  it('resends a failed outbound message', async () => {
    roles.current = ['moderator'];
    const v = renderScreen();
    fireEvent.click(await v.findByTestId('whatsapp-resend-o1'));
    await waitFor(() => expect(uc.resendWhatsAppOutbound.execute).toHaveBeenCalledWith('o1'));
  });

  it('a super admin changes a template status and saves only the filled send limits', async () => {
    roles.current = ['super_admin'];
    const v = renderScreen();
    fireEvent.click(await v.findByTestId('whatsapp-template-edit-match_found_v1:he'));
    fireEvent.click(v.getByTestId('whatsapp-template-status-match_found_v1:he-approved'));
    await waitFor(() => expect(uc.setWhatsAppTemplateStatus.execute).toHaveBeenCalledWith({
      templateName: 'match_found_v1', languageCode: 'he', metaStatus: 'approved',
    }));
    fireEvent.change(v.getByLabelText(t.limits.fields.perUserHour), { target: { value: '6' } });
    fireEvent.click(v.getByTestId('whatsapp-limits-save'));
    await waitFor(() => expect(uc.setWhatsAppSendLimits.execute).toHaveBeenCalledWith({ perUserHour: 6 }));
    expect(await v.findByText(t.limits.current(6))).toBeTruthy();
  });

  it('refuses an out-of-range limit before any call', async () => {
    roles.current = ['super_admin'];
    const v = renderScreen();
    fireEvent.change(await v.findByLabelText(t.limits.fields.maxAttempts), { target: { value: '99' } });
    fireEvent.click(v.getByTestId('whatsapp-limits-save'));
    expect(await v.findByText(t.limits.invalid(t.limits.fields.maxAttempts))).toBeTruthy();
    expect(uc.setWhatsAppSendLimits.execute).not.toHaveBeenCalled();
  });
});
