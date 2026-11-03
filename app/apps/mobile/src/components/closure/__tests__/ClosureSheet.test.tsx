// @vitest-environment jsdom
// ClosureSheet on the kit `BottomSheet` (FR-CLOSURE-002 / 003 / 001, spec 17 §4.1.1, TD-243):
// each step titles the sheet, renders its pane and actions, and every dismissal resets the flow.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

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
vi.mock('expo-haptics', () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: 'light' } }));
vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../hooks/useModalHardwareBack', () => ({ useModalHardwareBack: () => {} }));
// The store reaches into the composition roots for its use cases; none run in these tests.
vi.mock('../../../services/postsComposition', () => ({
  getGetClosureCandidatesUseCase: () => ({ execute: () => Promise.resolve([]) }),
  getMarkAsDeliveredUseCase: () => ({ execute: () => Promise.resolve() }),
}));
vi.mock('../../../services/userComposition', () => ({
  getDismissClosureExplainerUseCase: () => ({ execute: () => Promise.resolve() }),
  getSearchUsersForClosureUseCase: () => ({ execute: () => Promise.resolve([]) }),
}));
vi.mock('../ClosureRecipientPanes', () => ({
  ModeTabs: () => <span data-testid="mode-tabs" />,
  ChatsPane: () => <span data-testid="chats-pane" />,
  SearchPane: () => <span data-testid="search-pane" />,
}));

import { ClosureSheet } from '../ClosureSheet';
import { useClosureStore } from '../../../store/closureStore';
import { useAuthStore } from '../../../store/authStore';

beforeEach(() => {
  useClosureStore.getState().reset();
  useAuthStore.setState({ session: { userId: 'u_owner' } } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAt(step: 'confirm' | 'pick' | 'error', extra: Record<string, unknown> = {}) {
  useClosureStore.setState({ postId: 'p_1', postType: 'Give', step, ...extra });
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <ClosureSheet />
    </ThemeProvider>,
  );
}

describe('ClosureSheet', () => {
  it('renders nothing while the flow is idle', () => {
    const { queryByRole } = render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <ClosureSheet />
      </ThemeProvider>,
    );
    expect(queryByRole('heading')).toBeNull();
  });

  it('titles step 1 by the post type and confirms from its primary action', () => {
    const confirmStep1 = vi.spyOn(useClosureStore.getState(), 'confirmStep1').mockImplementation(() => {});
    useClosureStore.setState({ confirmStep1 });
    const { getByRole, getByText } = renderAt('confirm');
    expect(getByRole('heading').textContent).toBe('closure.step1GiveTitle');
    expect(getByText('closure.step1GiveBody')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'closure.step1GiveCta' }));
    expect(confirmStep1).toHaveBeenCalledTimes(1);
  });

  it('titles step 2 and keeps marking disabled until a recipient is picked', () => {
    const { getByRole, getByTestId } = renderAt('pick');
    expect(getByRole('heading').textContent).toBe('closure.step2GiveTitle');
    expect(getByTestId('chats-pane')).toBeTruthy();
    expect(getByRole('button', { name: 'closure.step2MarkAndClose' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the error pane under the error title', () => {
    const { getByRole, getByText } = renderAt('error', { errorMessage: 'Blocked list failed' });
    expect(getByRole('heading').textContent).toBe('closure.errorTitle');
    expect(getByText('Blocked list failed')).toBeTruthy();
  });

  it.each(['confirm', 'pick', 'error'] as const)('resets the flow from the close control at step %s', (step) => {
    const { getAllByRole } = renderAt(step);
    // The header ✕ comes first; at the error step the pane's own Close shares its name.
    act(() => {
      fireEvent.click(getAllByRole('button', { name: 'general.close' })[0]);
    });
    expect(useClosureStore.getState().step).toBe('idle');
  });

  it('resets the flow from the step 1 cancel action', () => {
    const { getByRole } = renderAt('confirm');
    act(() => {
      fireEvent.click(getByRole('button', { name: 'general.cancel' }));
    });
    expect(useClosureStore.getState().step).toBe('idle');
  });
});
