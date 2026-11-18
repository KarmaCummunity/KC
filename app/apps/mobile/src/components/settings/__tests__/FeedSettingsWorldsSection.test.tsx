// @vitest-environment jsdom
// Settings → feed: the muted giving worlds are one row of kit chips (FR-RESP-006 AC28);
// a tap mutes a world, a tap on a muted one unmutes it.
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@kc/ui';
import { FeedSettingsWorldsSection } from '../FeedSettingsWorldsSection';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

afterEach(cleanup);

function renderSection(onAdd = vi.fn(), onRemove = vi.fn()) {
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <FeedSettingsWorldsSection
        rows={[{ filterId: 'f-1', filterKind: 'world', filterValue: 'items' }]}
        onAdd={onAdd}
        onRemove={onRemove}
      />
    </ThemeProvider>,
  );
  return { onAdd, onRemove };
}

describe('FeedSettingsWorldsSection', () => {
  it('shows the muted world as selected and toggles worlds', () => {
    const { onAdd, onRemove } = renderSection();
    expect(screen.getByTestId('feed-settings-worlds')).toBeTruthy();
    expect(screen.getByTestId('feed-settings-world-items').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('feed-settings-world-rides').getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByTestId('feed-settings-world-rides'));
    expect(onAdd).toHaveBeenCalledWith('rides');
    fireEvent.click(screen.getByTestId('feed-settings-world-items'));
    expect(onRemove).toHaveBeenCalledWith('f-1');
  });
});
