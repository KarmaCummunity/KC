// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Text } from '../components/BrandText';
import { AsideProvider, useAside, useAsideContent } from '../components/AsideContext';

function Publisher({ enabled }: { enabled?: boolean }) {
  useAside(() => <Text testID="aside-content">hello aside</Text>, [], enabled);
  return null;
}

function Consumer() {
  const render = useAsideContent();
  return <>{render?.()}</>;
}

afterEach(() => {
  cleanup();
});

describe('AsideContext', () => {
  it('publishes content from a child and exposes it via useAsideContent', () => {
    render(
      <AsideProvider>
        <Publisher />
        <Consumer />
      </AsideProvider>
    );
    expect(screen.getByTestId('aside-content').textContent).toBe('hello aside');
  });

  it('exposes undefined when no publisher is mounted', () => {
    render(
      <AsideProvider>
        <Consumer />
      </AsideProvider>
    );
    expect(screen.queryByTestId('aside-content')).toBeNull();
  });

  it('does not publish when enabled is false', () => {
    render(
      <AsideProvider>
        <Publisher enabled={false} />
        <Consumer />
      </AsideProvider>
    );
    expect(screen.queryByTestId('aside-content')).toBeNull();
  });

  it('withdraws content when a publisher flips from enabled to disabled', () => {
    const { rerender } = render(
      <AsideProvider>
        <Publisher enabled />
        <Consumer />
      </AsideProvider>
    );
    expect(screen.getByTestId('aside-content')).toBeTruthy();
    rerender(
      <AsideProvider>
        <Publisher enabled={false} />
        <Consumer />
      </AsideProvider>
    );
    expect(screen.queryByTestId('aside-content')).toBeNull();
  });
});
