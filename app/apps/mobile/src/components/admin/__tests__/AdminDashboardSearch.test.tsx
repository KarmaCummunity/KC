// @vitest-environment jsdom
// Mapped to spec: FR-ADMIN-011 / #2081 — the admin home search: finds screens/settings/actions in
// Hebrew and English, navigates on tap, shows an empty state, and never offers what roles cannot open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { AdminRole } from '@kc/domain';

const push = vi.hoisted(() => vi.fn());
const startReplay = vi.hoisted(() => vi.fn());
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../../store/onboardingReplayStore', () => ({
  useOnboardingReplayStore: { getState: () => ({ start: startReplay }) },
}));

import { AdminDashboardSearch } from '../AdminDashboardSearch';

afterEach(cleanup);
beforeEach(() => {
  push.mockClear();
  startReplay.mockClear();
});

function renderSearch(roles: readonly AdminRole[], isHidden?: (k: string) => boolean) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <AdminDashboardSearch roles={roles} isHidden={isHidden} />
    </ThemeProvider>,
  );
}
const type = (v: ReturnType<typeof renderSearch>, text: string) =>
  fireEvent.change(v.getByTestId('admin-dashboard-search-input'), { target: { value: text } });

describe('AdminDashboardSearch', () => {
  it('lists nothing until the admin types', () => {
    const v = renderSearch(['super_admin']);
    expect(v.queryByTestId('admin-search-result-reports')).toBeNull();
    expect(v.queryByTestId('admin-dashboard-search-empty')).toBeNull();
  });

  it('finds a screen by its Hebrew title and navigates to it on tap', () => {
    const v = renderSearch(['super_admin']);
    type(v, 'דיווחים');
    fireEvent.click(v.getByTestId('admin-search-result-reports'));
    expect(push).toHaveBeenCalledWith('/(admin)/reports');
  });

  it('finds a finance setting and navigates to it', () => {
    const v = renderSearch(['super_admin']);
    type(v, 'accounts');
    fireEvent.click(v.getByTestId('admin-search-result-moneyAccounts'));
    expect(push).toHaveBeenCalledWith('/(admin)/money/accounts');
  });

  it('starts onboarding replay before navigating to the action', () => {
    const v = renderSearch(['super_admin']);
    type(v, 'onboarding');
    fireEvent.click(v.getByTestId('admin-search-result-onboardingReplay'));
    expect(startReplay).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith('/(onboarding)/about-intro');
  });

  it('finds a screen by an English word', () => {
    const v = renderSearch(['super_admin']);
    type(v, 'payment');
    expect(v.getByTestId('admin-search-result-money')).toBeTruthy();
  });

  it('shows an empty state when nothing matches', () => {
    const v = renderSearch(['super_admin']);
    type(v, 'zzzzzz');
    expect(v.getByTestId('admin-dashboard-search-empty')).toBeTruthy();
  });

  it('does not offer a screen the roles lack the permission for', () => {
    const v = renderSearch([]);
    type(v, 'money');
    expect(v.queryByTestId('admin-search-result-money')).toBeNull();
    expect(v.getByTestId('admin-dashboard-search-empty')).toBeTruthy();
  });

  it('does not offer a screen the launch surface hides', () => {
    const v = renderSearch(['super_admin'], (k) => k === 'whatsapp');
    type(v, 'whatsapp');
    expect(v.queryByTestId('admin-search-result-whatsapp')).toBeNull();
  });
});
