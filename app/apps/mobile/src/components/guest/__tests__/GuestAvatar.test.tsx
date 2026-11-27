// @vitest-environment jsdom
import React, { type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

const imageMocks = vi.hoisted(() => ({ onError: null as null | (() => void) }));
vi.mock('../../ui/KCImage', () => ({
  KCImage: ({ onError }: { onError?: () => void }) => {
    imageMocks.onError = onError ?? null;
    return <span data-testid="guest-avatar-image" />;
  },
}));

import { GuestAvatar } from '../GuestAvatar';

function wrap(node: ReactElement) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      {node}
    </ThemeProvider>,
  );
}

afterEach(cleanup);

describe('GuestAvatar', () => {
  it('shows the image when an avatar url is present', () => {
    wrap(<GuestAvatar name="Alice" avatarUrl="https://cdn.example/a.jpg" />);
    expect(screen.getByTestId('guest-avatar-image')).toBeTruthy();
    expect(screen.queryByTestId('guest-avatar-fallback')).toBeNull();
  });

  it('falls back to initials when the avatar fails to load', () => {
    wrap(<GuestAvatar name="Alice Bob" avatarUrl="https://cdn.example/a.jpg" />);
    expect(imageMocks.onError).toBeTypeOf('function');
    act(() => {
      imageMocks.onError?.();
    });
    expect(screen.getByTestId('guest-avatar-fallback')).toBeTruthy();
    expect(screen.getByText('AB')).toBeTruthy();
  });

  it('uses initials when there is no avatar url', () => {
    wrap(<GuestAvatar name="Carol" avatarUrl={null} />);
    expect(screen.getByTestId('guest-avatar-fallback')).toBeTruthy();
    expect(screen.queryByTestId('guest-avatar-image')).toBeNull();
  });
});
