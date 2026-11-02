// @vitest-environment jsdom
// CTAs 3 (spec 17 §4.1.1, TD-243): the root components' calls to action are kit buttons — the
// empty-state pair and the first-post nudge's share / remind / dismiss — named by their labels,
// keeping their testIDs and pressing through to their handlers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', async () => (await import('../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

import { EmptyStateActions } from '../EmptyState';
import { FirstPostNudge } from '../FirstPostNudge';

afterEach(cleanup);

const renderInTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

describe('EmptyStateActions', () => {
  it('renders the primary and the optional secondary as kit buttons with their testIDs', () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const { getByRole, getByTestId } = renderInTheme(
      <EmptyStateActions
        primary={{ label: 'Create', onPress: onPrimary, testID: 'empty-primary' }}
        secondary={{ label: 'Browse', onPress: onSecondary, testID: 'empty-secondary' }}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Create' }));
    fireEvent.click(getByRole('button', { name: 'Browse' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(getByTestId('empty-primary')).toBeTruthy();
    expect(getByTestId('empty-secondary')).toBeTruthy();
  });

  it('renders only the primary when no secondary is given', () => {
    const { getAllByRole } = renderInTheme(<EmptyStateActions primary={{ label: 'Create', onPress: () => {} }} />);
    expect(getAllByRole('button')).toHaveLength(1);
  });
});

describe('FirstPostNudge', () => {
  it('offers share, remind-me and the permanent dismiss as kit buttons', () => {
    const onShare = vi.fn();
    const onRemindLater = vi.fn();
    const onDismissForever = vi.fn();
    const { getByRole } = renderInTheme(
      <FirstPostNudge onShare={onShare} onRemindLater={onRemindLater} onDismissForever={onDismissForever} />,
    );
    fireEvent.click(getByRole('button', { name: 'feed.nudgeShare' }));
    fireEvent.click(getByRole('button', { name: 'feed.nudgeRemindMe' }));
    fireEvent.click(getByRole('button', { name: 'feed.nudgeDontShow' }));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onRemindLater).toHaveBeenCalledTimes(1);
    expect(onDismissForever).toHaveBeenCalledTimes(1);
  });
});
