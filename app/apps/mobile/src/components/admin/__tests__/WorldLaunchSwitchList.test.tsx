// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { WorldLaunchSwitchList } from '../WorldLaunchSwitchList';
import type { WorldLaunchRow } from '../../../hooks/useWorldLaunchAdmin';

const STRINGS = {
  active: 'ACTIVE', portal: 'PORTAL', makeActive: 'ACTIVATE', makePortal: 'TO-PORTAL',
  names: { animals: 'Animals', items: 'Items' },
};
const WORLDS: WorldLaunchRow[] = [
  { tileKey: 'items', flagKey: 'world_items_enabled', mode: 'active' },
  { tileKey: 'animals', flagKey: 'world_animals_enabled', mode: 'portal' },
];

function renderList(props: Partial<React.ComponentProps<typeof WorldLaunchSwitchList>> = {}) {
  const onSwitch = vi.fn();
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <WorldLaunchSwitchList worlds={WORLDS} canSwitch busyKey={null} onSwitch={onSwitch} strings={STRINGS} {...props} />
    </ThemeProvider>,
  );
  return onSwitch;
}

describe('WorldLaunchSwitchList (#2277)', () => {
  afterEach(cleanup);

  it('shows each world with its current mode', () => {
    renderList();
    expect(screen.getByTestId('world-launch-mode-items').textContent).toBe('ACTIVE');
    expect(screen.getByTestId('world-launch-mode-animals').textContent).toBe('PORTAL');
  });

  it('offers the other mode: a portal is activated and an active world goes back to portal', () => {
    const onSwitch = renderList();
    fireEvent.click(screen.getByTestId('world-launch-switch-animals'));
    fireEvent.click(screen.getByTestId('world-launch-switch-items'));
    expect(onSwitch.mock.calls).toEqual([['world_animals_enabled', 'active'], ['world_items_enabled', 'portal']]);
  });

  it('hides every switch from staff who are not the super admin', () => {
    renderList({ canSwitch: false });
    expect(screen.queryByTestId('world-launch-switch-animals')).toBeNull();
    expect(screen.getByTestId('world-launch-mode-animals').textContent).toBe('PORTAL');
  });

  it('blocks the other switches while one write runs', () => {
    const onSwitch = renderList({ busyKey: 'world_items_enabled' });
    fireEvent.click(screen.getByTestId('world-launch-switch-animals'));
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
