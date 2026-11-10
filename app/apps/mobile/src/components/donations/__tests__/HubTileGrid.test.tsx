// @vitest-environment jsdom
// D100 / D60 — the Donations hub tiles: a portal world carries a "portal" tag, an active one does not.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// The entry animation and the press scale need the native worklets runtime; plain wrappers are enough here.
vi.mock('../../ui/MotionEntry', () => ({
  ENTRY_DELAY: { buttons: 0 },
  MotionEntry: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../animations/PressableScale', () => ({
  PressableScale: ({ children, onPress, testID }: { children: React.ReactNode; onPress: () => void; testID?: string }) => (
    <div data-testid={testID} onClick={onPress}>{children}</div>
  ),
}));

import { HubTileGrid, type HubGridTile } from '../HubTileGrid';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const tile = (key: string, portal?: boolean): HubGridTile => ({
  key, icon: 'gift-outline', titleKey: `t.${key}`, subtitleKey: `s.${key}`,
  href: `/(tabs)/donations/${key}` as HubGridTile['href'], testID: `donation-tile-${key}`, portal,
});

function renderGrid(tiles: HubGridTile[], onTilePress?: (key: string) => void) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <HubTileGrid heading="worlds" tiles={tiles} delay={0} onTilePress={onTilePress} />
    </ThemeProvider>,
  );
}

describe('HubTileGrid', () => {
  it('tags a portal world and leaves an active world untagged', () => {
    const view = renderGrid([tile('food'), tile('medical', true)]);
    expect(view.queryByTestId('donation-tile-medical-portal')).not.toBeNull();
    expect(view.queryByTestId('donation-tile-food-portal')).toBeNull();
  });

  it('opens the world on tap', () => {
    const view = renderGrid([tile('food'), tile('medical', true)]);
    fireEvent.click(view.getByTestId('donation-tile-medical'));
    expect(push).toHaveBeenCalledWith('/(tabs)/donations/medical');
  });

  it('reports the tapped world (FR-DONATE-001 AC8)', () => {
    const onTilePress = vi.fn();
    const view = renderGrid([tile('food'), tile('medical', true)], onTilePress);
    fireEvent.click(view.getByTestId('donation-tile-food'));
    expect(onTilePress).toHaveBeenCalledWith('food');
  });
});
