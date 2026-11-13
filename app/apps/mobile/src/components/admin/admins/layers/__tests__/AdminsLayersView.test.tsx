// @vitest-environment jsdom
// FR-ADMIN-028 — layered hierarchy view: data/error states, depth, org focus, a11y.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import {
  buildHierarchyPyramid,
  type HierarchySnapshot,
  type OrgTreeMember,
} from '@kc/domain';

// The hook is replaced by an in-memory fold of a fixed snapshot so each test
// controls the loaded data and the error independently.
const state: { snapshot: HierarchySnapshot | null; error: unknown } = { snapshot: null, error: null };

vi.mock('../../../../../hooks/useHierarchyPyramid', () => ({
  useHierarchyPyramid: (focusOrgId: string | null) => ({
    pyramid: state.snapshot ? buildHierarchyPyramid(state.snapshot, focusOrgId) : null,
    isRefetching: false,
    refetch: vi.fn(),
    error: state.error,
  }),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// The retry is a kit button, which pulls in reanimated and haptics; its press feedback is not under test here.
vi.mock('react-native-reanimated', async () => (await import('../../../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
// Entry animation pulls in reanimated; the layout under test does not depend on it.
vi.mock('../../../../ui/MotionEntry', () => ({
  MotionEntry: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../AvatarInitials', () => ({ AvatarInitials: () => null }));
// The slug change goes through the app container; the card's own flow is not under test here.
const setSlug = vi.fn(async () => 'beta-new');
vi.mock('../../../../../hooks/useSetOrgSlug', () => ({
  useSetOrgSlug: () => ({ mutateAsync: setSlug, isPending: false }),
}));
// Pin the Hebrew bundle; both accessors of the real module serve it.
vi.mock('../../../../../i18n/useLocaleBundle', async () => {
  const he = (await import('../../../../../i18n/locales/he')).default;
  return { useLocaleBundle: () => he, localeBundle: () => he };
});

import { AdminsLayersView } from '../AdminsLayersView';
import { localeBundle } from '../../../../../i18n/useLocaleBundle';

const L = localeBundle();

const PLATFORM = 'org-platform';

function member(over: Partial<OrgTreeMember> & { grantId: string }): OrgTreeMember {
  return {
    userId: `u-${over.grantId}`,
    displayName: over.grantId,
    avatarUrl: null,
    role: 'org_admin',
    scopeOrgId: 'org-a',
    orgId: 'org-a',
    orgName: 'Alpha',
    isPlatform: false,
    managerGrantId: null,
    lastSeenAt: null,
    ...over,
  };
}

const SNAPSHOT: HierarchySnapshot = {
  members: [
    member({ grantId: 'root', role: 'super_admin', scopeOrgId: null, orgId: PLATFORM, orgName: 'Karma', isPlatform: true }),
    member({ grantId: 'alice' }),
    member({ grantId: 'bob', orgId: 'org-b', scopeOrgId: 'org-b', orgName: 'Beta' }),
    member({ grantId: 'multi', userId: 'u-multi', role: 'org_employee' }),
    member({ grantId: 'multi-2', userId: 'u-multi', displayName: 'multi', role: 'volunteer_manager' }),
  ],
  census: {
    communityTotal: 50,
    roleHolderTotal: 5,
    orgs: [
      { orgId: PLATFORM, slug: 'kc', name: 'Karma', isPlatform: true, isVerified: true, affiliatedCount: 0 },
      { orgId: 'org-a', slug: 'alpha', name: 'Alpha', isPlatform: false, isVerified: true, affiliatedCount: 3 },
      { orgId: 'org-b', slug: 'beta', name: 'Beta', isPlatform: false, isVerified: false, affiliatedCount: 0 },
    ],
  },
};

const renderView = (canChangeSlug = false) =>
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <AdminsLayersView isWide={false} onSelect={() => {}} canChangeSlug={canChangeSlug} />
    </ThemeProvider>,
  );

afterEach(() => {
  cleanup();
  state.snapshot = null;
  state.error = null;
});

describe('AdminsLayersView', () => {
  it('keeps showing loaded levels when a background refetch fails', () => {
    state.snapshot = SNAPSHOT;
    state.error = new Error('network');
    renderView();
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.queryByText(L.admin.admins.layers.loadError)).toBeNull();
  });

  it('shows the load error with a retry action when nothing has loaded', () => {
    state.error = new Error('forbidden');
    renderView();
    expect(screen.getByText(L.admin.admins.layers.loadError)).toBeTruthy();
    expect(screen.getByRole('button', { name: L.admin.admins.layers.retry })).toBeTruthy();
  });

  it('focusing an org chip narrows the levels to that org', () => {
    state.snapshot = SNAPSHOT;
    renderView();
    expect(screen.getByText('alice')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.queryByText('alice')).toBeNull();
  });

  it('shows the focused organization\'s page address to the super admin only, and saves a new one', async () => {
    state.snapshot = SNAPSHOT;
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(screen.queryByTestId('org-slug-card')).toBeNull();
    cleanup();
    renderView(true);
    expect(screen.queryByTestId('org-slug-card')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(screen.getByText(L.admin.admins.orgSlug.current('beta'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: L.admin.admins.orgSlug.change }));
    fireEvent.change(screen.getByTestId('org-slug-input'), { target: { value: 'beta-new' } });
    fireEvent.click(screen.getByRole('button', { name: L.admin.admins.orgSlug.save }));
    await waitFor(() => expect(setSlug).toHaveBeenCalledWith({ orgId: 'org-b', slug: 'beta-new' }));
  });

  it('renders one band per reporting level, deeper than any fixed tier set', () => {
    // super_admin → org_admin → six chained managers → volunteer manager → volunteer.
    const chain = ['admin', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'vm', 'vol'];
    const roles = ['org_admin', 'org_manager', 'org_manager', 'org_manager', 'org_manager',
      'org_manager', 'org_manager', 'volunteer_manager', 'org_volunteer'] as const;
    state.snapshot = {
      ...SNAPSHOT,
      members: [
        member({ grantId: 'root', role: 'super_admin', scopeOrgId: null, orgId: PLATFORM, orgName: 'Karma', isPlatform: true }),
        ...chain.map((grantId, i) =>
          member({ grantId, role: roles[i], managerGrantId: i === 0 ? 'root' : chain[i - 1] })),
      ],
    };
    renderView();
    expect(screen.getByText(L.admin.admins.layers.apexTitle)).toBeTruthy();
    expect(screen.getByText(L.admin.admins.layers.levelTitle(9))).toBeTruthy();
    expect(screen.getByText('vol')).toBeTruthy();
  });

  it('announces extra roles in the person chip accessibility label', () => {
    state.snapshot = SNAPSHOT;
    renderView();
    const roles = L.admin.roles;
    const label = L.admin.admins.layers.personA11y('multi', roles.volunteer_manager, 'Alpha', 1);
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
  });

  it('collapses a layer band and hides its people until expanded again', () => {
    state.snapshot = SNAPSHOT;
    renderView();
    expect(screen.getByText('alice')).toBeTruthy();
    fireEvent.click(screen.getByTestId('hierarchy-layer-toggle-1'));
    expect(screen.queryByText('alice')).toBeNull();
    fireEvent.click(screen.getByTestId('hierarchy-layer-toggle-1'));
    expect(screen.getByText('alice')).toBeTruthy();
  });
});
