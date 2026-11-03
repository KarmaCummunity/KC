// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { Text } from '@kc/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../hooks/useAdminRoles', () => ({ useAdminRoles: vi.fn() }));
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <Text>REDIRECT:{href}</Text>,
}));

import { AdminGate } from '../AdminGate';
import { useAdminRoles } from '../../../hooks/useAdminRoles';

const mockRoles = useAdminRoles as unknown as ReturnType<typeof vi.fn>;

describe('AdminGate', () => {
  // Vitest config sets `globals: false`, so @testing-library/react's
  // automatic cleanup is not wired. Call it explicitly to prevent DOM
  // bleed between tests.
  afterEach(() => {
    cleanup();
    mockRoles.mockReset();
  });

  it('renders children when the user has any admin role', () => {
    mockRoles.mockReturnValue({ roles: ['support'], isLoading: false });
    render(
      <AdminGate>
        <Text>inside</Text>
      </AdminGate>,
    );
    expect(screen.queryByText('inside')).toBeTruthy();
  });

  it('redirects when the user has no admin role', () => {
    mockRoles.mockReturnValue({ roles: [], isLoading: false });
    render(
      <AdminGate>
        <Text>inside</Text>
      </AdminGate>,
    );
    expect(screen.queryByText('inside')).toBeNull();
    expect(screen.queryByText('REDIRECT:/(tabs)')).toBeTruthy();
  });

  it('shows loading state without redirecting while the role query is pending', () => {
    // FR-ADMIN-011 — cold-start race: gate must not redirect before the role
    // query resolves, or legitimate admins flash off /(admin) on native.
    mockRoles.mockReturnValue({ roles: [], isLoading: true });
    render(
      <AdminGate>
        <Text>inside</Text>
      </AdminGate>,
    );
    expect(screen.queryByText('inside')).toBeNull();
    expect(screen.queryByText(/REDIRECT:/)).toBeNull();
  });

  it('redirects to /(admin) when anyOf does not match', () => {
    mockRoles.mockReturnValue({ roles: ['support'], isLoading: false });
    render(
      <AdminGate anyOf={['super_admin']}>
        <Text>inside</Text>
      </AdminGate>,
    );
    expect(screen.queryByText('inside')).toBeNull();
    expect(screen.queryByText('REDIRECT:/(admin)')).toBeTruthy();
  });
});
