// @vitest-environment jsdom
// FR-ADMIN-030 — person screen team management: roles with authority-gated
// actions, the change-role and grant flows, and role-derived permissions.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { AdminGrant, OrgTreeMember, PositionedGrant } from '@kc/domain';

// vi.mock factories are hoisted above imports, so their spies must be hoisted too.
const { auth, grantMutate, changeMutate, setManagerMutate } = vi.hoisted(() => ({
  auth: {
    grants: [] as PositionedGrant[],
    managerOf: new Map<string, string | null>(),
    scopes: [] as { scopeOrgId: string | null; name: string }[],
  },
  setManagerMutate: vi.fn(async () => undefined),
  grantMutate: vi.fn(async () => 'g-new'),
  changeMutate: vi.fn(async () => 'g-changed'),
}));

vi.mock('../../../../hooks/useGrantAuthority', () => ({
  useGrantAuthority: () => ({
    authority: { userId: 'u-viewer', grants: auth.grants, managerOf: auth.managerOf },
    scopes: auth.scopes,
    isLoading: false,
  }),
}));
vi.mock('../../../../hooks/useHierarchyPyramid', () => ({
  useHierarchyPyramid: () => ({
    pyramid: {
      orgs: [
        { orgId: 'org-p', name: 'Karma', isPlatform: true },
        { orgId: 'org-a', name: 'Alpha', isPlatform: false },
      ],
    },
  }),
}));
vi.mock('../../../../hooks/useAdminRoleMutations', () => ({
  useGrantAdminRole: () => ({ mutateAsync: grantMutate, isPending: false }),
  useChangeAdminRole: () => ({ mutateAsync: changeMutate, isPending: false }),
  useRevokeAdminRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../../../hooks/useSetManager', () => ({
  useSetManager: () => ({ mutateAsync: setManagerMutate, isPending: false }),
}));
vi.mock('../../../../lib/container', () => ({ supabase: {} }));
// The virtualized list needs native globals; a plain map renders the same rows.
vi.mock('../../../lists/KcFlashList', () => ({
  KcFlashList: <T,>({ data, renderItem, keyExtractor }: {
    data: readonly T[];
    renderItem: (info: { item: T; index: number }) => React.ReactNode;
    keyExtractor: (item: T) => string;
  }) => <>{data.map((item, index) => <div key={keyExtractor(item)}>{renderItem({ item, index })}</div>)}</>,
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../../AvatarInitials', () => ({ AvatarInitials: () => null }));
// The role and manager dialogs are kit `Modal`s with kit buttons.
vi.mock('react-native-reanimated', async () => (await import('../../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
// Pin the Hebrew bundle; both accessors of the real module serve it.
vi.mock('../../../../i18n/useLocaleBundle', async () => {
  const he = (await import('../../../../i18n/locales/he')).default;
  return { useLocaleBundle: () => he, localeBundle: () => he };
});

import { PersonRolesSection } from '../PersonRolesSection';
import { RolePermissionsSection } from '../RolePermissionsSection';
import { GrantManagerSection } from '../GrantManagerSection';
import { localeBundle } from '../../../../i18n/useLocaleBundle';
import { finishModalAnimation } from '../../../ui/__tests__/kitDialogTestKit';

const L = localeBundle();
const team = L.admin.admins.team;

function grant(over: Partial<AdminGrant> & Pick<AdminGrant, 'grantId' | 'role'>): AdminGrant {
  return {
    userId: 'u-person',
    displayName: 'Dana',
    avatarUrl: null,
    scopeOrgId: 'org-a',
    grantedAt: new Date('2026-01-01T00:00:00Z'),
    grantedBy: null,
    grantedByDisplayName: null,
    revokedAt: null,
    revokedBy: null,
    lastSeenAt: null,
    ...over,
  };
}

const withTheme = (node: React.ReactNode) => (
  <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{node}</ThemeProvider>
);

/** The viewer's own grant, placed in the tree. */
function viewerGrant(grantId: string, role: PositionedGrant['role'], scopeOrgId: string | null = 'org-a'): PositionedGrant {
  return { grantId, userId: 'u-viewer', role, scopeOrgId };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  auth.grants = [];
  auth.managerOf = new Map();
  auth.scopes = [];
});

describe('PersonRolesSection', () => {
  it('offers change and revoke only on grants below the viewer and junior to them', () => {
    auth.grants = [viewerGrant('g-me', 'org_admin')];
    // g1 reports to the viewer; g2 is an org admin outside the viewer's subtree.
    auth.managerOf = new Map([['g-me', null], ['g1', 'g-me'], ['g2', null]]);
    auth.scopes = [{ scopeOrgId: 'org-a', name: 'Alpha' }];
    render(withTheme(
      <PersonRolesSection
        userId="u-person"
        personName="Dana"
        grants={[grant({ grantId: 'g1', role: 'org_volunteer' }), grant({ grantId: 'g2', role: 'org_admin' })]}
      />,
    ));
    expect(screen.getAllByText('Alpha')).toHaveLength(2);
    // Only the volunteer grant sits below the viewer, junior to them.
    expect(screen.getAllByRole('button', { name: team.changeRole })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: L.admin.admins.row.revokeShort })).toHaveLength(1);
    expect(screen.getByRole('button', { name: team.addRole })).toBeTruthy();
  });

  it('hides every action for a viewer without grant authority', () => {
    auth.grants = [viewerGrant('g-me', 'moderator', null)];
    auth.managerOf = new Map([['g-me', null], ['g1', 'g-me']]);
    render(withTheme(
      <PersonRolesSection userId="u-person" personName="Dana" grants={[grant({ grantId: 'g1', role: 'org_volunteer' })]} />,
    ));
    expect(screen.queryByRole('button', { name: team.changeRole })).toBeNull();
    expect(screen.queryByRole('button', { name: team.addRole })).toBeNull();
  });

  it('changes a role in place to one the viewer may grant', async () => {
    auth.grants = [viewerGrant('g-me', 'org_manager')];
    auth.managerOf = new Map([['g-me', null], ['g1', 'g-me']]);
    auth.scopes = [{ scopeOrgId: 'org-a', name: 'Alpha' }];
    render(withTheme(
      <PersonRolesSection userId="u-person" personName="Dana" grants={[grant({ grantId: 'g1', role: 'org_volunteer' })]} />,
    ));
    fireEvent.click(screen.getByRole('button', { name: team.changeRole }));
    // An org manager may move a volunteer up to a volunteer manager (strictly below them).
    fireEvent.click(screen.getByRole('checkbox', { name: L.admin.roles.volunteer_manager }));
    fireEvent.click(screen.getByRole('button', { name: team.changeModal.submit }));
    await vi.waitFor(() => expect(changeMutate).toHaveBeenCalledWith({ grantId: 'g1', newRole: 'volunteer_manager' }));
  });

  it('grants a new role to the person in the only org the viewer manages', async () => {
    auth.grants = [viewerGrant('g-me', 'org_admin')];
    auth.scopes = [{ scopeOrgId: 'org-a', name: 'Alpha' }];
    render(withTheme(<PersonRolesSection userId="u-person" personName="Dana" grants={[]} />));
    expect(screen.getByText(team.rolesNone)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: team.addRole }));
    fireEvent.click(screen.getByRole('checkbox', { name: L.admin.roles.org_manager }));
    fireEvent.click(screen.getByRole('button', { name: L.admin.admins.grantModal.submit }));
    await vi.waitFor(() => expect(grantMutate).toHaveBeenCalledWith({
      targetUserId: 'u-person', role: 'org_manager', scopeOrgId: 'org-a',
    }));
  });

  it('closes the change-role and grant dialogs from their cancel action without saving', () => {
    auth.grants = [viewerGrant('g-me', 'org_manager')];
    auth.managerOf = new Map([['g-me', null], ['g1', 'g-me']]);
    auth.scopes = [{ scopeOrgId: 'org-a', name: 'Alpha' }];
    render(withTheme(
      <PersonRolesSection userId="u-person" personName="Dana" grants={[grant({ grantId: 'g1', role: 'org_volunteer' })]} />,
    ));
    for (const [open, dialog] of [
      [team.changeRole, team.changeModal],
      [team.addRole, L.admin.admins.grantModal],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: open }));
      finishModalAnimation();
      expect(screen.getByRole('dialog', { name: dialog.title })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: dialog.cancel }));
      finishModalAnimation();
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    expect(changeMutate).not.toHaveBeenCalled();
    expect(grantMutate).not.toHaveBeenCalled();
  });
});

describe('RolePermissionsSection', () => {
  it('lists the permissions each role carries', () => {
    render(withTheme(<RolePermissionsSection roles={['org_manager']} />));
    expect(screen.getByText(L.admin.admins.permissions['admins.grant_role'])).toBeTruthy();
    expect(screen.queryByText(L.admin.admins.permissions['reports.view'])).toBeNull();
  });

  it('marks a role with no portal permissions', () => {
    render(withTheme(<RolePermissionsSection roles={['org_volunteer']} />));
    expect(screen.getByText(team.permissions.none)).toBeTruthy();
  });
});

function member(over: Partial<OrgTreeMember> & Pick<OrgTreeMember, 'grantId' | 'role'>): OrgTreeMember {
  return {
    userId: `u-${over.grantId}`, displayName: over.grantId, avatarUrl: null,
    scopeOrgId: 'org-a', orgId: 'org-a', orgName: 'Alpha', isPlatform: false,
    managerGrantId: null, lastSeenAt: null, ...over,
  };
}

describe('GrantManagerSection', () => {
  // Org A: viewer (org_manager) ← volunteer manager ← volunteer; a side employee outside the subtree.
  const ME = member({ grantId: 'g-me', userId: 'u-viewer', role: 'org_manager', displayName: 'Me' });
  const VM = member({ grantId: 'g-vm', role: 'volunteer_manager', managerGrantId: 'g-me' });
  const VOL = member({ grantId: 'g-vol', role: 'org_volunteer', managerGrantId: 'g-vm' });
  const SIDE = member({ grantId: 'g-side', role: 'org_employee' });
  const MEMBERS = [ME, VM, VOL, SIDE];

  function asOrgManager() {
    auth.grants = [viewerGrant('g-me', 'org_manager')];
    auth.managerOf = new Map(MEMBERS.map((m) => [m.grantId, m.managerGrantId]));
  }

  it('moves a report only under the viewer or someone in their subtree, and never detaches', async () => {
    asOrgManager();
    render(withTheme(<GrantManagerSection member={VOL} members={MEMBERS} canManage />));
    expect(screen.queryByRole('button', { name: L.admin.admins.detail.clearManager })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: L.admin.admins.detail.changeManager }));
    expect(screen.queryByRole('button', { name: L.admin.admins.managerPicker.detach })).toBeNull();
    expect(screen.queryByText('g-side')).toBeNull();
    fireEvent.click(screen.getByText('Me'));
    await vi.waitFor(() => expect(setManagerMutate).toHaveBeenCalledWith({ grantId: 'g-vol', managerGrantId: 'g-me' }));
  });

  it('closes the manager picker from its cancel action without moving anyone', () => {
    asOrgManager();
    render(withTheme(<GrantManagerSection member={VOL} members={MEMBERS} canManage />));
    fireEvent.click(screen.getByRole('button', { name: L.admin.admins.detail.changeManager }));
    finishModalAnimation();
    expect(screen.getByRole('dialog', { name: L.admin.admins.managerPicker.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: L.admin.admins.managerPicker.cancel }));
    finishModalAnimation();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(setManagerMutate).not.toHaveBeenCalled();
  });

  it('offers no manager change for a grant outside the viewer\'s subtree', () => {
    asOrgManager();
    render(withTheme(<GrantManagerSection member={SIDE} members={MEMBERS} canManage />));
    expect(screen.queryByRole('button', { name: L.admin.admins.detail.assignManager })).toBeNull();
  });
});
