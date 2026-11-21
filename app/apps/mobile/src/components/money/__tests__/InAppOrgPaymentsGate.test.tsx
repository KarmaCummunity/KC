// @vitest-environment jsdom
// FR-DONATE-003 AC7 (#1800): the sandbox in-app nonprofit payment screens render only while
// `money_in_app_org_payments` is on; a direct link with the flag off lands on the Money hub.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const flags = vi.hoisted(() => ({ money_in_app_org_payments: false }));
vi.mock('../../../hooks/useFeatureFlag', () => ({
  useFeatureFlag: (key: keyof typeof flags) => flags[key],
}));
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <span data-testid="redirect">{href}</span>,
}));

import { InAppOrgPaymentsGate } from '../InAppOrgPaymentsGate';

afterEach(cleanup);

describe('InAppOrgPaymentsGate', () => {
  it('renders the screen while the flag is on', () => {
    flags.money_in_app_org_payments = true;
    render(<InAppOrgPaymentsGate><span>donate screen</span></InAppOrgPaymentsGate>);
    expect(screen.getByText('donate screen')).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
  });

  it('sends a direct link to the Money hub while the flag is off', () => {
    flags.money_in_app_org_payments = false;
    render(<InAppOrgPaymentsGate><span>donate screen</span></InAppOrgPaymentsGate>);
    expect(screen.queryByText('donate screen')).toBeNull();
    expect(screen.getByTestId('redirect').textContent).toBe('/(tabs)/donations/money');
  });
});
