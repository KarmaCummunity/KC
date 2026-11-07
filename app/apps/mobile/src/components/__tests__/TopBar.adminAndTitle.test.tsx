// @vitest-environment jsdom
// FR-ADMIN-011 AC6 — the Admin Portal shortcut is on every TopBar, for admins only.
// FR-FEED-020 AC2 — a stack screen's title sits in the TopBar in place of the logo.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

const mocks = vi.hoisted(() => ({ roles: [] as string[] }));

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../store/chatStore', () => ({ useChatStore: (sel: (s: { unreadTotal: number }) => unknown) => sel({ unreadTotal: 0 }) }));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: { session: { userId: string } }) => unknown) => sel({ session: { userId: 'u1' } }),
}));
vi.mock('../../hooks/useNotificationInboxBadge', () => ({ useNotificationInboxBadge: () => 0 }));
vi.mock('../../hooks/useAdminRoles', () => ({ useAdminRoles: () => ({ roles: mocks.roles }) }));
vi.mock('../../../assets/logo.png', () => ({ default: 1 }));

import { TopBar } from '../TopBar';

afterEach(() => {
  cleanup();
  mocks.roles = [];
});

const renderBar = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

describe('TopBar', () => {
  it('shows the admin portal icon only to a user with an admin role', () => {
    renderBar(<TopBar />);
    expect(screen.queryByTestId('topbar-admin-portal')).toBeNull();
    cleanup();
    mocks.roles = ['super_admin'];
    renderBar(<TopBar />);
    expect(screen.getByTestId('topbar-admin-portal')).toBeTruthy();
  });

  it('shows the screen title instead of the logo, with the back button at the start', () => {
    renderBar(<TopBar title="חפצים" startIcon={<button data-testid="back" />} />);
    expect(screen.getByText('חפצים')).toBeTruthy();
    expect(screen.getByTestId('back')).toBeTruthy();
  });
});
