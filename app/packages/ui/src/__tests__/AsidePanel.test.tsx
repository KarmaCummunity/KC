// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Text } from '../components/BrandText';
import { AsideProvider, useAside } from '../components/AsideContext';
import { AsidePanel } from '../components/AsidePanel';

function Publisher() {
  useAside(() => <Text testID="aside">my aside</Text>, []);
  return null;
}

afterEach(() => {
  cleanup();
});

describe('AsidePanel', () => {
  it('renders nothing when no publisher is mounted', () => {
    render(
      <AsideProvider>
        <AsidePanel />
      </AsideProvider>
    );
    expect(screen.queryByTestId('aside')).toBeNull();
  });

  it('renders the published content when a publisher is mounted', () => {
    render(
      <AsideProvider>
        <Publisher />
        <AsidePanel />
      </AsideProvider>
    );
    expect(screen.getByTestId('aside').textContent).toBe('my aside');
  });
});
