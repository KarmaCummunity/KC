// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent } from '@testing-library/react';

const start = vi.fn();

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (s: { session: { userId: string } }) => unknown) =>
    select({ session: { userId: 'u_owner' } }),
}));
vi.mock('../../../store/closureStore', () => ({
  useClosureStore: (select: (s: { start: typeof start }) => unknown) => select({ start }),
}));

import { OwnerAssignUserButton } from '../OwnerAssignUserButton';
import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';

beforeEach(() => start.mockReset());

describe('OwnerAssignUserButton', () => {
  it('opens the recipient picker for the offer', () => {
    const { getByRole } = renderInTheme(
      <OwnerAssignUserButton targetId="listing-1" worldSlug="rides" />,
    );
    fireEvent.click(getByRole('button', { name: 'closure.assignUserCta' }));
    expect(start).toHaveBeenCalledWith('listing-1', 'u_owner', 'Give', {
      initiator: 'owner-assign',
      startAt: 'pick',
      offerAssign: true,
      allowCloseWithout: false,
      worldSlug: 'rides',
    });
  });
});
