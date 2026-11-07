// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@kc/ui';
import { AdditionalWorldsPicker } from '../AdditionalWorldsPicker';

afterEach(() => {
  cleanup();
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
  }),
}));

function renderPicker(
  primaryWorldSlug: string,
  selectedWorlds: readonly string[] = [],
  onToggle = vi.fn(),
) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <AdditionalWorldsPicker
        primaryWorldSlug={primaryWorldSlug}
        selectedWorlds={selectedWorlds}
        onToggle={onToggle}
      />
    </ThemeProvider>,
  );
}

describe('AdditionalWorldsPicker (#1475)', () => {
  it('renders chips for giving worlds excluding the primary world and money', () => {
    renderPicker('time');

    // Primary world 'time' must NOT appear
    expect(screen.queryByTestId('additional-world-time')).toBeNull();
    // Money must NOT appear
    expect(screen.queryByTestId('additional-world-money')).toBeNull();

    // Other worlds must appear
    expect(screen.getByTestId('additional-world-knowledge')).toBeTruthy();
    expect(screen.getByTestId('additional-world-employment')).toBeTruthy();
    expect(screen.getByTestId('additional-world-food')).toBeTruthy();
  });

  it('triggers onToggle when a chip is clicked', () => {
    const onToggle = vi.fn();
    renderPicker('time', ['knowledge'], onToggle);

    fireEvent.click(screen.getByTestId('additional-world-employment'));
    expect(onToggle).toHaveBeenCalledWith('employment');

    fireEvent.click(screen.getByTestId('additional-world-knowledge'));
    expect(onToggle).toHaveBeenCalledWith('knowledge');
  });

  it('aligns label and hint to the reading-start edge', async () => {
    const { rtlTextAlignStart } = await import('../../../lib/rtlTextAlignStart');
    renderPicker('time');
    for (const key of [
      'post.unifiedCreate.additionalWorldsLabel',
      'post.unifiedCreate.additionalWorldsHint',
    ]) {
      const el = screen.getByText(key);
      expect(getComputedStyle(el).textAlign).toBe(rtlTextAlignStart);
    }
  });
});
