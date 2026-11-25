// @vitest-environment jsdom
import React, { type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Text, ThemeProvider } from '@kc/ui';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { GuestWriteAction } from '../GuestWriteAction';

function wrap(node: ReactElement) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      {node}
    </ThemeProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

describe('GuestWriteAction', () => {
  it('runs the write when the visitor is signed in', () => {
    const onPress = vi.fn();
    wrap(
      <GuestWriteAction
        isAuthenticated
        onAuthenticatedPress={onPress}
        testID="guest-write"
      >
        <Text>Follow</Text>
      </GuestWriteAction>,
    );
    fireEvent.click(screen.getByTestId('guest-write'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('prompts sign-up on tap for a guest instead of running the write', () => {
    const onPress = vi.fn();
    wrap(
      <GuestWriteAction
        isAuthenticated={false}
        policy="prompt"
        onAuthenticatedPress={onPress}
        testID="guest-write"
      >
        <Text>Follow</Text>
      </GuestWriteAction>,
    );
    expect(screen.getByText('Follow')).toBeTruthy();
    fireEvent.click(screen.getByTestId('guest-write'));
    expect(onPress).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/(auth)');
  });

  it('hides the write control entirely when policy is hide', () => {
    wrap(
      <GuestWriteAction
        isAuthenticated={false}
        policy="hide"
        onAuthenticatedPress={() => {}}
        testID="guest-write"
      >
        <Text>Chat</Text>
      </GuestWriteAction>,
    );
    expect(screen.queryByTestId('guest-write')).toBeNull();
    expect(screen.queryByText('Chat')).toBeNull();
  });
});
