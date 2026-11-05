// @vitest-environment jsdom
// FR-ADMIN-011 AC6: the home top bar shows an Admin Portal shortcut only to users with an admin role.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';

const router = { push: vi.fn() };
let roles: string[] = [];

vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'he' } }),
}));
vi.mock('../../hooks/useAdminRoles', () => ({
  useAdminRoles: () => ({ roles, isLoading: false }),
}));

import { AdminPortalIcon } from '../AdminPortalIcon';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  roles = [];
});

describe('AdminPortalIcon', () => {
  it('renders nothing for a user without an admin role', () => {
    const { queryByTestId } = render(<AdminPortalIcon />);
    expect(queryByTestId('topbar-admin-portal')).toBeNull();
  });

  it('opens the Admin Portal for a user with an admin role', () => {
    roles = ['moderator'];
    const { getByTestId } = render(<AdminPortalIcon />);
    fireEvent.click(getByTestId('topbar-admin-portal'));
    expect(router.push).toHaveBeenCalledWith('/(admin)');
  });
});
