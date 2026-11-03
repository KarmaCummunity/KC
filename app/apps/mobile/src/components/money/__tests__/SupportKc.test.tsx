// @vitest-environment jsdom
// FR-DONATE-011 — "support KC directly" options + legal disclosure.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { KcSupportOptions } from '@kc/domain';

const cancelState = { canRequest: true, busy: false, failed: false, request: vi.fn(async () => {}) };
const optionsQuery: { data: KcSupportOptions | undefined; isLoading: boolean } = { data: undefined, isLoading: false };

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join('|')}` : key,
  }),
}));
// Buttons pull in reanimated + haptics; a plain button keeps the contract under test.
vi.mock('../../ui/Buttons', () => {
  const Button = (p: { label: string; onPress: () => void; testID?: string; accessibilityLabel?: string }) => (
    <button data-testid={p.testID} aria-label={p.accessibilityLabel} onClick={p.onPress}>
      {p.label}
    </button>
  );
  return { PrimaryButton: Button, SecondaryButton: Button };
});
vi.mock('../../../hooks/useKcStandingOrderCancelRequest', () => ({
  useKcStandingOrderCancelRequest: () => cancelState,
}));
vi.mock('../../../hooks/useKcSupportOptions', () => ({ useKcSupportOptions: () => optionsQuery }));

import { SupportKcOptions } from '../SupportKcOptions';
import { SupportKcDisclosure } from '../SupportKcDisclosure';
import { DonationSupportCard } from '../../DonationSupportCard';

afterEach(() => {
  cleanup();
  cancelState.canRequest = true;
  cancelState.failed = false;
  optionsQuery.data = undefined;
});

const withTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

const full: KcSupportOptions = {
  oneTime: [
    { kind: 'bit', url: 'https://bit.example/pay', providerLabel: 'Bit' },
    { kind: 'card_one_time', url: 'https://pay.grow.link/once', providerLabel: 'Grow' },
  ],
  standingOrder: { kind: 'card_standing_order', url: 'https://pay.grow.link/monthly', providerLabel: 'Grow' },
};

describe('SupportKcOptions', () => {
  it('renders one-time channels in order and the standing order with its provider', () => {
    const { getAllByRole, getByText } = withTheme(
      <SupportKcOptions options={full} loading={false} onOpen={() => {}} />,
    );
    expect(getAllByRole('button').map((b) => b.textContent)).toEqual([
      'supportKc.channel.bit',
      'supportKc.channel.card_one_time',
      'supportKc.channel.card_standing_order',
    ]);
    expect(getByText('supportKc.standingOrderBody:Grow')).toBeTruthy();
  });

  it('opens the exact configured URL of the tapped channel', () => {
    const onOpen = vi.fn();
    const { getByTestId } = withTheme(<SupportKcOptions options={full} loading={false} onOpen={onOpen} />);
    fireEvent.click(getByTestId('support-kc-card_standing_order'));
    expect(onOpen).toHaveBeenCalledWith('https://pay.grow.link/monthly');
  });

  it('labels each channel for screen readers with its provider', () => {
    const { getByTestId } = withTheme(<SupportKcOptions options={full} loading={false} onOpen={() => {}} />);
    expect(getByTestId('support-kc-bit').getAttribute('aria-label')).toBe(
      'supportKc.channelA11y:supportKc.channel.bit|Bit',
    );
  });

  it('shows the unavailable notice when there are no channels', () => {
    const { getByText, queryAllByRole } = withTheme(
      <SupportKcOptions options={{ oneTime: [], standingOrder: null }} loading={false} onOpen={() => {}} />,
    );
    expect(getByText('supportKc.unavailable')).toBeTruthy();
    expect(queryAllByRole('button')).toHaveLength(0);
  });

  it('renders no channel buttons while loading', () => {
    const { queryAllByRole } = withTheme(
      <SupportKcOptions options={undefined} loading onOpen={() => {}} />,
    );
    expect(queryAllByRole('button')).toHaveLength(0);
  });
});

describe('SupportKcDisclosure', () => {
  it('always states secure payment, recipient, tax status and voluntariness', () => {
    const { getByText, queryByText } = withTheme(<SupportKcDisclosure hasStandingOrder={false} />);
    for (const key of ['disclosureSecure', 'disclosureRecipient', 'disclosureTax', 'disclosureVoluntary']) {
      expect(getByText(`supportKc.${key}`)).toBeTruthy();
    }
    expect(queryByText('supportKc.disclosureCancel')).toBeNull();
    expect(queryByText('supportKc.cancelCta')).toBeNull();
  });

  it('explains cancellation and offers the request link when a standing order is offered', () => {
    const { getByText, getByTestId } = withTheme(<SupportKcDisclosure hasStandingOrder />);
    expect(getByText('supportKc.disclosureCancel')).toBeTruthy();
    fireEvent.click(getByTestId('support-kc-cancel-standing-order'));
    expect(cancelState.request).toHaveBeenCalledTimes(1);
  });

  it('hides the request link for signed-out viewers and surfaces send failures', () => {
    cancelState.canRequest = false;
    const signedOut = withTheme(<SupportKcDisclosure hasStandingOrder />);
    expect(signedOut.queryByTestId('support-kc-cancel-standing-order')).toBeNull();
    cleanup();
    cancelState.canRequest = true;
    cancelState.failed = true;
    const failed = withTheme(<SupportKcDisclosure hasStandingOrder />);
    expect(failed.getByText('supportKc.cancelError')).toBeTruthy();
  });
});

describe('DonationSupportCard (About + Settings, FR-DONATE-010)', () => {
  it('uses the warm wording with the same server channels and legal notice', () => {
    optionsQuery.data = full;
    const { getByText, getByTestId } = withTheme(<DonationSupportCard />);
    expect(getByTestId('donation-support-card')).toBeTruthy();
    expect(getByText('donations.supportUs.title')).toBeTruthy();
    expect(getByTestId('support-kc-card_standing_order')).toBeTruthy();
    expect(getByTestId('support-kc-disclosure')).toBeTruthy();
  });

  it('shows the unavailable notice instead of payment links when channels cannot load', () => {
    const { getByText, queryAllByRole } = withTheme(<DonationSupportCard />);
    expect(getByText('supportKc.unavailable')).toBeTruthy();
    expect(queryAllByRole('button')).toHaveLength(0);
  });
});
