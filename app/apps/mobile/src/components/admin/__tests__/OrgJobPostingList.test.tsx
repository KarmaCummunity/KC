// @vitest-environment jsdom
// §5.11 (#1476) — the admin list of organizations and whether each may publish job offers.
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrgJobPostingRow } from '@kc/application';

// Reanimated does not transform under Vitest; the buttons' press animation is not under test here.
vi.mock('react-native-reanimated', async () => {
  const { View } = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    default: { View },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: () => ({}),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});
vi.mock('../../../lib/haptics', () => ({ hapticLightImpact: () => {} }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

import { OrgJobPostingList } from '../OrgJobPostingList';

const STRINGS = {
  allowed: 'ALLOWED', notAllowed: 'NOT-ALLOWED', platform: 'PLATFORM', suspended: 'SUSPENDED', allow: 'ALLOW', stop: 'STOP',
};
const ORGS: OrgJobPostingRow[] = [
  { orgId: 'kc', name: 'Karma Community', isPlatform: true, isActive: true, mayPostJobs: false },
  { orgId: 'emp', name: 'Employer', isPlatform: false, isActive: true, mayPostJobs: true },
  { orgId: 'club', name: 'Club', isPlatform: false, isActive: true, mayPostJobs: false },
  { orgId: 'old', name: 'Old', isPlatform: false, isActive: false, mayPostJobs: true },
];

function renderList(props: Partial<React.ComponentProps<typeof OrgJobPostingList>> = {}) {
  const onSwitch = vi.fn();
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <OrgJobPostingList organizations={ORGS} canSwitch busyOrgId={null} onSwitch={onSwitch} strings={STRINGS} {...props} />
    </ThemeProvider>,
  );
  return { onSwitch };
}

afterEach(() => cleanup());

describe('OrgJobPostingList (§5.11, #1476)', () => {
  it('says which organizations may post jobs: KC always, a suspended one never', () => {
    renderList();
    expect(screen.getByTestId('org-jobs-status-kc').textContent).toBe('PLATFORM');
    expect(screen.getByTestId('org-jobs-status-emp').textContent).toBe('ALLOWED');
    expect(screen.getByTestId('org-jobs-status-club').textContent).toBe('NOT-ALLOWED');
    expect(screen.getByTestId('org-jobs-status-old').textContent).toBe('SUSPENDED');
  });

  it('offers the other state as the button, and none for KC or a suspended organization', () => {
    const { onSwitch } = renderList();
    expect(screen.queryByTestId('org-jobs-switch-kc')).toBeNull();
    expect(screen.queryByTestId('org-jobs-switch-old')).toBeNull();
    expect(screen.getByTestId('org-jobs-switch-emp').textContent).toContain('STOP');
    fireEvent.click(screen.getByTestId('org-jobs-switch-club'));
    expect(onSwitch).toHaveBeenCalledWith('club', true);
    fireEvent.click(screen.getByTestId('org-jobs-switch-emp'));
    expect(onSwitch).toHaveBeenLastCalledWith('emp', false);
  });

  it('shows no switch to staff who may not change it', () => {
    renderList({ canSwitch: false });
    expect(screen.queryByTestId('org-jobs-switch-club')).toBeNull();
    expect(screen.getByTestId('org-jobs-status-club').textContent).toBe('NOT-ALLOWED');
  });
});
