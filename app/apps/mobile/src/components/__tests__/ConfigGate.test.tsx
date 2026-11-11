// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stubs keep the test about the gate's decision, not native view plumbing.
vi.mock('../ConfigErrorScreen', () => ({
  ConfigErrorScreen: () => <div data-testid="config-error" />,
}));
vi.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ConfigGate } from '../ConfigGate';

afterEach(cleanup);

describe('ConfigGate (#1944)', () => {
  it('renders the app when the public config is present', () => {
    render(
      <ConfigGate configured>
        <span>app tree</span>
      </ConfigGate>,
    );
    expect(screen.getByText('app tree')).toBeTruthy();
    expect(screen.queryByTestId('config-error')).toBeNull();
  });

  it('shows the config error screen and never mounts the app when config is missing', () => {
    const mounted = vi.fn();
    const App = () => {
      mounted();
      return <span>app tree</span>;
    };
    render(
      <ConfigGate configured={false}>
        <App />
      </ConfigGate>,
    );
    expect(screen.getByTestId('config-error')).toBeTruthy();
    expect(mounted).not.toHaveBeenCalled();
  });
});
