// @vitest-environment jsdom
// #1090 — Settings → WhatsApp through the link use cases (no direct RPCs): a Pro member gets a
// code with its expiry, unlinks after confirming and switches match alerts; a member without
// Pro sees the note and no code button; the alert switch needs a linked number.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import { WhatsAppLinkError, type WhatsAppLinkStatus } from '@kc/domain';

const { state, uc } = vi.hoisted(() => {
  const state: { status: WhatsAppLinkStatus } = {
    status: { linked: true, waIdMasked: '•••1234', isPro: true, consentOptedIn: false, phoneOptedOut: false },
  };
  return {
    state,
    uc: {
      getWhatsAppLinkStatus: { execute: vi.fn(() => Promise.resolve(state.status)) },
      createWhatsAppLinkCode: { execute: vi.fn(() => Promise.resolve({ code: '123456', expiresAt: new Date('2026-11-13T10:10:00Z') })) },
      unlinkWhatsApp: { execute: vi.fn(() => Promise.resolve()) },
      setWhatsAppMatchConsent: { execute: vi.fn((on: boolean) => Promise.resolve({ ...state.status, consentOptedIn: on })) },
    },
  };
});

vi.mock('../../lib/container', () => ({ container: uc }));
vi.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../navigation/shellStackScreenOptions', () => ({ useShellStackScreenOptions: () => ({}) }));
vi.mock('../../components/LaunchSurfaceGate', () => ({ LaunchSurfaceGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/RouteErrorBoundary', () => ({ RouteErrorBoundary: () => null }));
vi.mock('../../components/ParkedFeatureNotice', () => ({ ParkedFeatureNotice: () => <span data-testid="parked" /> }));
vi.mock('../../services/platformConfirm', () => ({ confirmAction: () => Promise.resolve(true) }));
vi.mock('../../components/NotificationToggleRow', () => ({
  NotificationToggleRow: ({ value, disabled, onValueChange, caption }: {
    value: boolean; disabled?: boolean; onValueChange: (v: boolean) => void; caption: string;
  }) => (
    <button data-testid="alerts-toggle" data-caption={caption} disabled={disabled} onClick={() => onValueChange(!value)}>
      {String(value)}
    </button>
  ),
}));

import WhatsAppLinkScreen from '../../../app/settings/whatsapp';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <WhatsAppLinkScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.status = { linked: true, waIdMasked: '•••1234', isPro: true, consentOptedIn: false, phoneOptedOut: false };
});
afterEach(cleanup);

describe('Settings → WhatsApp', () => {
  it('shows the link code after asking for one', async () => {
    const v = renderScreen();
    fireEvent.click(await v.findByTestId('settings-whatsapp-get-code'));
    expect(await v.findByTestId('settings-whatsapp-code')).toHaveProperty('textContent', '123456');
    expect(uc.createWhatsAppLinkCode.execute).toHaveBeenCalledWith(state.status);
    expect(v.getByText('settings.whatsapp.codeExpires')).toBeTruthy();
  });

  it('unlinks after confirmation', async () => {
    const v = renderScreen();
    fireEvent.click(await v.findByTestId('settings-whatsapp-unlink'));
    await waitFor(() => expect(uc.unlinkWhatsApp.execute).toHaveBeenCalledTimes(1));
  });

  it('switches match alerts on through the consent use case', async () => {
    const v = renderScreen();
    fireEvent.click(await v.findByTestId('alerts-toggle'));
    await waitFor(() => expect(uc.setWhatsAppMatchConsent.execute).toHaveBeenCalledWith(true));
    await waitFor(() => expect(v.getByTestId('alerts-toggle').textContent).toBe('true'));
  });

  it('a member without Pro sees the note and no code button', async () => {
    state.status = { ...state.status, linked: false, waIdMasked: null, isPro: false };
    const v = renderScreen();
    expect(await v.findByText('settings.whatsapp.notPro')).toBeTruthy();
    expect(v.queryByTestId('settings-whatsapp-get-code')).toBeNull();
    expect(v.getByTestId('alerts-toggle')).toHaveProperty('disabled', true);
  });

  it('says why a code was refused', async () => {
    uc.createWhatsAppLinkCode.execute.mockImplementationOnce(() => Promise.reject(new WhatsAppLinkError('rate_limited')));
    const v = renderScreen();
    fireEvent.click(await v.findByTestId('settings-whatsapp-get-code'));
    expect((await v.findByTestId('settings-whatsapp-error')).textContent).toBe('settings.whatsapp.rateLimited');
  });
});
