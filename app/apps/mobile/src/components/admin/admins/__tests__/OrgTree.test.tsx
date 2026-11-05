// @vitest-environment jsdom
// FR-ADMIN-025 — the tree shows each person once per org, with all their roles,
// and a collapsed manager hides their reports.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import { buildOrgPeopleForest, groupPeopleByOrg, type OrgTreeMember } from '@kc/domain';
import { OrgTree } from '../OrgTree';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// Avatars load images; the cards under test only need the name next to them.
vi.mock('../../../AvatarInitials', () => ({ AvatarInitials: () => null }));
// Pin the Hebrew bundle; both accessors of the real module serve it.
vi.mock('../../../../i18n/useLocaleBundle', async () => {
  const he = (await import('../../../../i18n/locales/he')).default;
  return { useLocaleBundle: () => he, localeBundle: () => he };
});

function grant(over: Partial<OrgTreeMember> & { grantId: string }): OrgTreeMember {
  return {
    userId: `u-${over.grantId}`,
    displayName: over.grantId,
    avatarUrl: null,
    role: 'org_volunteer',
    scopeOrgId: 'org-1',
    orgId: 'org-1',
    orgName: 'Alpha',
    isPlatform: false,
    managerGrantId: null,
    lastSeenAt: null,
    ...over,
  };
}

const sections = groupPeopleByOrg(buildOrgPeopleForest([
  grant({ grantId: 'a1', userId: 'nave', displayName: 'Nave', role: 'org_admin' }),
  grant({ grantId: 'a2', userId: 'nave', displayName: 'Nave', role: 'moderator' }),
  grant({ grantId: 'a3', userId: 'nave', displayName: 'Nave', role: 'support' }),
  grant({ grantId: 'v1', userId: 'dana', displayName: 'Dana', role: 'org_volunteer', managerGrantId: 'a1' }),
]));

function renderTree(onSelect = vi.fn()) {
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}><OrgTree sections={sections} onSelect={onSelect} /></ThemeProvider>);
  return onSelect;
}

afterEach(cleanup);

describe('OrgTree', () => {
  it('renders a person with three roles as one card', () => {
    renderTree();
    expect(screen.getAllByText('Nave')).toHaveLength(1);
    expect(screen.getAllByText('Dana')).toHaveLength(1);
  });

  it('hides the reports of a collapsed manager', () => {
    renderTree();
    fireEvent.click(screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') !== null)!);
    expect(screen.queryByText('Dana')).toBeNull();
  });

  it('selects the person by user id', () => {
    const onSelect = renderTree();
    fireEvent.click(screen.getByText('Dana'));
    expect(onSelect).toHaveBeenCalledWith('dana');
  });

  it('shows the empty state without sections', () => {
    render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}><OrgTree sections={[]} /></ThemeProvider>);
    expect(screen.getByText(/היררכיה|hierarchy/i)).toBeTruthy();
  });
});
