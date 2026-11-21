// @vitest-environment jsdom
// FR-FOLLOW-002 AC1: the unfollow confirmation names the person ("Stop following [name]?"),
// and only its confirm unfollows.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
// Reduced motion opens the dialog without the fade, which never finishes under jsdom.
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
// The translation double echoes the key with its `name` option, so the test sees what is interpolated.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { name?: string }) => (opts?.name ? `${key}:${opts.name}` : key) }),
}));

import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { FollowButton } from '../FollowButton';

afterEach(cleanup);

describe('FollowButton — unfollow confirmation', () => {
  it('asks "Stop following <name>?" and unfollows only on confirm', () => {
    const onPress = vi.fn();
    renderInTheme(<FollowButton state="following" displayName="Dana Levi" onPress={onPress} />);
    fireEvent.click(screen.getByText('profile.followingActive'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'profile.unfollowConfirmTitleNamed:Dana Levi' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'profile.unfollowConfirmCta' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic question when the name is unknown', () => {
    renderInTheme(<FollowButton state="following" onPress={vi.fn()} />);
    fireEvent.click(screen.getByText('profile.followingActive'));
    expect(screen.getByRole('dialog', { name: 'profile.unfollowConfirmTitle' })).toBeTruthy();
  });
});
